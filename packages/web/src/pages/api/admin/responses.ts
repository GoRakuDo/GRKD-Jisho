import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import {
  searchResponse,
  getResponseDetail,
  updateResponse,
  deleteResponse as deleteDbResponse,
} from "@grkd-jisho/db";
import { validateCsrfRequest } from "../../../lib/csrf";
import { adminAuditEvent } from "@grkd-jisho/db";
import type { ResponseDetailResult } from "@grkd-jisho/db";

/** JSON.stringify の BigInt エラーを防ぐため、detail の BigInt/Date フィールドを string に変換 */
function serializeResponseDetail(raw: ResponseDetailResult) {
  return {
    ...raw,
    updatedAt: raw.updatedAt?.toISOString() ?? null,
    edits: raw.edits.map((e) => ({
      ...e,
      id: String(e.id),
      responseCacheId: String(e.responseCacheId),
      createdAt: e.createdAt?.toISOString() ?? null,
    })),
    source: raw.source.map((s) => ({
      ...s,
      dictionaryId: s.dictionaryId ?? null,
      cacheId: s.cacheId != null ? String(s.cacheId) : null,
      createdAt: s.createdAt?.toISOString() ?? null,
    })),
  };
}

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url } = context;
  const query = url.searchParams.get("query") ?? "";
  const id = url.searchParams.get("id");

  try {
    if (id) {
      const detail = await getResponseDetail(id);
      if (!detail) {
        return new Response(JSON.stringify({ error: "not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json" },
        });
      }
      const serialized = serializeResponseDetail(detail);
      return new Response(
        JSON.stringify({ response: serialized }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (!query) {
      return new Response(JSON.stringify({ responses: [] }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const responses = await searchResponse(query, 20);
    return new Response(
      JSON.stringify({ responses }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ResponsesAPI] List fetch failed: ${reason} → Check query parameters and DB connectivity`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const PUT: APIRoute = async (context) => {
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
    const body = (await context.request.json()) as {
      id: string;
      responseText: string;
      reason?: string;
    };

    if (!body.id || typeof body.responseText !== "string") {
      return new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await updateResponse(
      body.id,
      body.responseText,
      session.discordUserId,
      body.reason,
    );

    await adminAuditEvent("admin.response_updated", {
      cacheId: body.id,
      editor: session.discordUserId,
    });

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ResponsesAPI] Update failed: ${reason} → Check CSRF token, payload format, and DB update permissions`);
    return new Response(JSON.stringify({ error: "update failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async (context) => {
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

  const { url } = context;
  const id = url.searchParams.get("id");

  if (!id || !/^\d+$/.test(id)) {
    return new Response(JSON.stringify({ error: "invalid response ID" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const deleted = await deleteDbResponse(id);

    if (deleted === 0) {
      return new Response(JSON.stringify({ error: "response not found or is delete-protected" }), {
        status: 404,
        headers: { "Content-Type": "application/json" },
      });
    }

    await adminAuditEvent("admin.response_deleted", {
      cacheId: id,
      editor: session.discordUserId,
    });

    return new Response(JSON.stringify({ success: true, deleted }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[ResponsesAPI] Delete failed: ${reason} → Check CSRF token, response ID, and DB delete permissions`);
    return new Response(JSON.stringify({ error: "delete failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
