import type { APIRoute } from "astro";
import path from "node:path";
import AdmZip from "adm-zip";
import { getIsAuthenticated } from "../../../../lib/locals";
import { getSession } from "../../../../lib/session";
import { validateCsrfRequest } from "../../../../lib/csrf";
import { adminAuditEvent, importYomitanDictionaryFromBuffer } from "@grkd-jisho/db";

const MAX_COMPRESSED_SIZE = 300 * 1024 * 1024;
const MAX_UNCOMPRESSED_PER_ENTRY = 300 * 1024 * 1024;
const MAX_TOTAL_UNCOMPRESSED = 1536 * 1024 * 1024;

export const POST: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!validateCsrfRequest(session.discordUserId, context.request)) {
    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get("file");
    const dictionaryNameRaw = formData.get("dictionaryName");
    const priorityRaw = formData.get("priority");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No file uploaded" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!file.name.endsWith(".zip") && file.type !== "application/zip") {
      return new Response(JSON.stringify({ error: "Only .zip files are accepted" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (file.size > MAX_COMPRESSED_SIZE) {
      return new Response(JSON.stringify({ error: "File too large (max 300MB)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const priority = typeof priorityRaw === "string" ? Number.parseInt(priorityRaw, 10) : Number.NaN;
    if (!Number.isInteger(priority) || priority < 0 || priority > 9999) {
      return new Response(JSON.stringify({ error: "Invalid priority (0-9999 required)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const dictionaryName = typeof dictionaryNameRaw === "string" && dictionaryNameRaw.trim().length > 0
      ? dictionaryNameRaw.trim()
      : undefined;

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = new AdmZip(buffer);
    const zipEntries = zip.getEntries();

    let totalUncompressed = 0;
    for (const entry of zipEntries) {
      const entryName = entry.entryName;

      if (entryName.includes("..")) {
        return new Response(JSON.stringify({ error: "Path traversal detected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      if (
        path.win32.isAbsolute(entryName) ||
        path.posix.isAbsolute(entryName) ||
        entryName.startsWith("/") ||
        entryName.startsWith("\\")
      ) {
        return new Response(JSON.stringify({ error: "Absolute path detected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      const uncompressedSize = entry.header.size;
      if (uncompressedSize > MAX_UNCOMPRESSED_PER_ENTRY) {
        return new Response(JSON.stringify({ error: "Entry too large (max 300MB uncompressed)" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      totalUncompressed += uncompressedSize;
      if (totalUncompressed > MAX_TOTAL_UNCOMPRESSED) {
        return new Response(JSON.stringify({ error: "Total uncompressed data exceeds 1.5GB limit" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    const importOptions = dictionaryName
      ? { dictionaryName, priority }
      : { priority };

    const result = await importYomitanDictionaryFromBuffer(buffer, importOptions);

    await adminAuditEvent("admin.dictionary_imported", {
      dictionaryId: result.dictionaryId,
      dictionaryName: result.dictionaryName,
      revision: result.revision,
      format: result.format,
      importedEntries: result.importedEntries,
      skippedMalformed: result.skippedMalformed,
      operator: session.discordUserId,
    });

    return new Response(JSON.stringify({
      success: true,
      result,
    }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ImportAPI] Import failed: ${reason} → Check ZIP structure, import constraints, and DB connectivity`);
    return new Response(JSON.stringify({ error: "Import failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
