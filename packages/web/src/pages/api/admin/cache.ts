import type { APIRoute } from "astro";
import { randomUUID } from "node:crypto";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { inArray } from "drizzle-orm";
import {
  db,
  schema,
  getCacheStats,
  searchCacheEntries,
  bulkDeleteCache,
} from "@grkd-jisho/db";
import { validateCsrfRequest } from "../../../lib/csrf";
import { adminAuditEvent } from "@grkd-jisho/db";

type FlowStep = {
  stage: string;
  status: "ok" | "error";
  detail: string;
};

const createFlowLogger = () => {
  const traceId = randomUUID();
  const flow: FlowStep[] = [];
  const logStep = (stage: string, status: FlowStep["status"], detail: string) => {
    flow.push({ stage, status, detail });
    const prefix = `[CacheAPI][trace=${traceId}] ${stage}`;
    if (status === "error") {
      console.error(`${prefix}: ${detail} → Check CSRF token, selected IDs, and delete eligibility`);
    } else {
      console.log(`${prefix}: ${detail}`);
    }
  };

  return { traceId, flow, logStep };
};

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
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[CacheAPI] Fetch failed: ${reason} → Check query filter and DB connectivity`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async (context) => {
  const { traceId, flow, logStep } = createFlowLogger();
  const session = getSession(context);
  logStep("request.received", "ok", `method=${context.request.method} path=${context.url.pathname}`);
  if (!session || !getIsAuthenticated(context)) {
    logStep("auth", "error", "unauthorized");
    return new Response(JSON.stringify({ error: "unauthorized", traceId, stage: "auth", flow }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!validateCsrfRequest(session.discordUserId, context.request)) {
    logStep("csrf", "error", "CSRF validation failed");
    return new Response(JSON.stringify({ error: "CSRF validation failed", traceId, stage: "csrf", flow }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    logStep("body.parse", "ok", "Parsing selected cache ids");
    const body = (await context.request.json()) as { ids: string[] };
    if (!Array.isArray(body.ids) || body.ids.length === 0) {
      logStep("body.validate", "error", "ids missing or empty");
      return new Response(JSON.stringify({ error: "invalid request", traceId, stage: "body.validate", flow }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Pre-filter: exclude manual override entries
    logStep("pre-filter.numeric", "ok", `Received ${body.ids.length} ids`);
    const numericIds = body.ids
      .filter((id) => /^\d+$/.test(id))
      .map((id) => BigInt(id));

    if (numericIds.length === 0) {
      logStep("pre-filter.numeric", "error", "No numeric ids found");
      return new Response(JSON.stringify({ success: true, deleted: 0, traceId, stage: "pre-filter.numeric", flow }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Fetch entries to check manual override status
    logStep("pre-filter.manual-override", "ok", "Loading selected entries");
    const existing = await db
      .select({ id: schema.responseCache.id, isManualOverride: schema.responseCache.isManualOverride })
      .from(schema.responseCache)
      .where(inArray(schema.responseCache.id, numericIds));

    const deletableIds = existing
      .filter((e) => !e.isManualOverride)
      .map((e) => String(e.id));

    logStep(
      "pre-filter.manual-override",
      deletableIds.length > 0 ? "ok" : "error",
      `${deletableIds.length} deletable / ${existing.length} selected`,
    );

    if (deletableIds.length === 0) {
      return new Response(JSON.stringify({ success: true, deleted: 0, traceId, stage: "pre-filter.manual-override", flow }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    logStep("bulk-delete", "ok", `Deleting ${deletableIds.length} entries`);
    const deleted = await bulkDeleteCache(deletableIds);
    logStep("bulk-delete", "ok", `Deleted ${deleted} entries`);

    logStep("audit.log", "ok", "Writing admin audit event");
    await adminAuditEvent("admin.cache_deleted", {
      requestedIds: body.ids.length,
      skippedManual: body.ids.length - deletableIds.length,
      deletedCount: deleted,
      operator: session.discordUserId,
    });
    logStep("audit.log", "ok", "Audit event saved");

    return new Response(
      JSON.stringify({ success: true, deleted, traceId, stage: "complete", flow }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    logStep("server.error", "error", reason);
    return new Response(JSON.stringify({ error: "delete failed", traceId, stage: "server.error", flow }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
