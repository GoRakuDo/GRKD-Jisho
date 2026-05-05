import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { eq, and } from "drizzle-orm";
import {
  db,
  schema,
  getCacheStats,
  searchCacheEntries,
  bulkDeleteCache,
} from "@grkd-jisho/db";
import { validateCsrfRequest } from "../../../lib/csrf";
import { adminAuditEvent } from "@grkd-jisho/db";

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
  const preview = url.searchParams.get("preview");

  try {
    if (query) {
      const entries = await searchCacheEntries(query, 20);
      if (preview === "true") {
        const deletable = entries.filter((e) => !e.isManualOverride).length;
        return new Response(
          JSON.stringify({
            total: entries.length,
            manualOverride: entries.filter((e) => e.isManualOverride).length,
            deletable,
            entries,
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }
      return new Response(
        JSON.stringify({ entries }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const stats = await getCacheStats();
    return new Response(
      JSON.stringify({ stats }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Cache API error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
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

  try {
    const body = (await context.request.json()) as { ids: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      return new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pre-filter: exclude manual override entries
    const numericIds = body.ids
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));

    if (numericIds.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch entries to check manual override status
    const existing = await db
      .select({ id: schema.responseCache.id, isManualOverride: schema.responseCache.isManualOverride })
      .from(schema.responseCache)
      .where(and(...numericIds.map((nid) => eq(schema.responseCache.id, nid))));

    const deletableIds = existing
      .filter((e) => !e.isManualOverride)
      .map((e) => String(e.id));

    if (deletableIds.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0 }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const deleted = await bulkDeleteCache(deletableIds);

    await adminAuditEvent("admin.cache_refreshed", {
      requestedIds: body.ids.length,
      skippedManual: body.ids.length - deletableIds.length,
      deletedCount: deleted,
      operator: session.discordUserId,
    });

    return new Response(
      JSON.stringify({ success: true, deleted }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Cache delete error:", err);
    return new Response(JSON.stringify({ error: "delete failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
