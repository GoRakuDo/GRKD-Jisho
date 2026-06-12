import type { APIRoute } from "astro";
import path from "node:path";
import AdmZip from "adm-zip";
import { getIsAuthenticated } from "../../../../lib/locals";
import { getSession } from "../../../../lib/session";
import { validateCsrfRequest } from "../../../../lib/csrf";
import { adminAuditEvent, importFrequencyZip } from "@grkd-jisho/db";

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

  if (!session.isAdmin) {
    return new Response(JSON.stringify({ error: "forbidden" }), {
      status: 403,
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
    const frequencyModeRaw = formData.get("frequencyMode");
    const frequencyMode =
      frequencyModeRaw === "occurrence-based" ? "occurrence-based" : "rank-based";

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

    const dictionaryName =
      typeof dictionaryNameRaw === "string" && dictionaryNameRaw.trim().length > 0
        ? dictionaryNameRaw.trim()
        : file.name.replace(/\.zip$/i, "").replace(/[[\]]/g, "").trim();

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

    const metaBankFiles = zipEntries.filter((e) =>
      /^term_meta_bank_(\d+)\.json$/.test(e.entryName),
    );

    if (metaBankFiles.length === 0) {
      return new Response(
        JSON.stringify({ error: "No term_meta_bank_*.json files found in zip" }),
        { status: 400, headers: { "Content-Type": "application/json" } },
      );
    }

    const result = await importFrequencyZip(buffer, { dictionaryName, frequencyMode });

    await adminAuditEvent("admin.frequency_imported", {
      dictionaryId: result.dictionaryId,
      dictionaryName: result.dictionaryName,
      imported: result.imported,
      skipped: result.skipped,
      operator: session.discordUserId,
    });

    return new Response(JSON.stringify({ success: true, result }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[FreqImportAPI] Import failed: ${reason} → Check ZIP structure and DB connectivity`);
    return new Response(JSON.stringify({ error: "Import failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
