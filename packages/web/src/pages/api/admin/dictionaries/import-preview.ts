import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../../lib/locals";
import { getSession } from "../../../../lib/session";
import { validateCsrfRequest } from "../../../../lib/csrf";
import AdmZip from "adm-zip";
import path from "node:path";

interface IndexJson {
  title: string;
  revision: string;
  format?: number;
}

export const POST: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  // NOTE: This route is exempted from middleware CSRF checks.
  // Keep this route-level validation as the required CSRF gate.
  if (!validateCsrfRequest(session.discordUserId, context.request)) {
    const token = context.request.headers.get("x-csrf-token");
    const tokenState = token && token.length > 0 ? "present" : "missing";
    console.warn(`[ImportPreviewAPI] CSRF validation failed: token=${tokenState} user=${session.discordUserId.slice(0, 6)}... → Refresh page and retry; if persistent, re-login and re-fetch CSRF token`);
    return new Response(JSON.stringify({ error: "CSRF validation failed" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const formData = await context.request.formData();
    const file = formData.get("file");

    if (!file || !(file instanceof File)) {
      return new Response(JSON.stringify({ error: "No file uploaded" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 安全制約: zip以外拒否
    if (!file.name.endsWith(".zip") && file.type !== "application/zip") {
      return new Response(JSON.stringify({ error: "Only .zip files are accepted" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // 安全制約: サイズ上限 300MB (compressed)
    const MAX_SIZE = 300 * 1024 * 1024;
    if (file.size > MAX_SIZE) {
      return new Response(JSON.stringify({ error: "File too large (max 300MB)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const zip = new AdmZip(buffer);

    // 安全制約: path traversal / absolute path / decompression bomb をまとめてチェック
    const MAX_UNCOMPRESSED_PER_ENTRY = 300 * 1024 * 1024; // 300MB per entry
    let totalUncompressed = 0;
    const zipEntries = zip.getEntries();
    for (const entry of zipEntries) {
      const name = entry.entryName;

      // path traversal (..) 拒否
      if (name.includes("..")) {
        return new Response(JSON.stringify({ error: "Path traversal detected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 絶対パス拒否
      if (path.win32.isAbsolute(name) || path.posix.isAbsolute(name) || name.startsWith("/") || name.startsWith("\\")) {
        return new Response(JSON.stringify({ error: "Absolute path detected" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }

      // 解凍後サイズ上限チェック (zip bomb / decompression bomb 対策)
      const uncompressedSize = entry.header.size;
      if (uncompressedSize > MAX_UNCOMPRESSED_PER_ENTRY) {
        return new Response(JSON.stringify({ error: "Entry too large (max 300MB uncompressed)" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      totalUncompressed += uncompressedSize;

      // 1.5GB total uncompressed limit
      if (totalUncompressed > 1536 * 1024 * 1024) {
        return new Response(JSON.stringify({ error: "Total uncompressed data exceeds 1.5GB limit" }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    // index.json の読み取り
    const indexEntry = zip.getEntry("index.json");
    if (!indexEntry) {
      return new Response(JSON.stringify({ error: "index.json not found in zip" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const indexData = JSON.parse(indexEntry.getData().toString("utf8")) as IndexJson;
    if (!indexData.title) {
      return new Response(JSON.stringify({ error: "index.json missing title" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // term_bank 件数の概算
    const termBankFiles = zipEntries
      .filter((e) => /^term_bank_(\d+)\.json$/.test(e.entryName))
      .sort((a, b) => a.entryName.localeCompare(b.entryName));

    let totalTerms = 0;
    for (const entry of termBankFiles) {
      try {
        const data = JSON.parse(entry.getData().toString("utf8"));
        if (Array.isArray(data)) totalTerms += data.length;
      } catch {
        // skip malformed term_bank files in preview
      }
    }

    // 自動生成 slug
    const autoSlug = indexData.title.toLowerCase().replace(/\s+/g, "-");

    return new Response(
      JSON.stringify({
        title: indexData.title,
        revision: indexData.revision ?? "unknown",
        format: indexData.format ?? 3,
        termBankCount: termBankFiles.length,
        totalTerms,
        autoSlug,
        fileName: file.name,
        fileSize: file.size,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ImportPreviewAPI] Preview failed: ${reason} → Check ZIP file validity, size limits, and parser constraints`);
    return new Response(JSON.stringify({ error: "Preview failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
