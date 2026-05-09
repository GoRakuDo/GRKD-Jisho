import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import {
  getDictionaryList,
  setDictionaryEnabled,
  setDictionaryPriority,
  getDictionaryEntryCount,
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

  try {
    const dictionaries = await getDictionaryList();
    const withEntryCounts = await Promise.all(
      dictionaries.map(async (dict) => {
        const entryCount = await getDictionaryEntryCount(dict.id);
        return { ...dict, id: String(dict.id), entryCount };
      }),
    );

    return new Response(
      JSON.stringify({ dictionaries: withEntryCounts }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[DictionariesAPI] List fetch failed: ${reason} → Check dictionaries table and DB connectivity`);
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
      id?: number;
      enabled?: boolean;
      priority?: number;
    };

    if (typeof body.id !== "number") {
      return new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (typeof body.enabled === "boolean") {
      await setDictionaryEnabled(body.id, body.enabled);
      await adminAuditEvent("admin.dictionary_updated", {
        dictId: body.id,
        action: "toggle_enabled",
        newValue: body.enabled,
        editor: session.discordUserId,
      });
    }

    if (typeof body.priority === "number") {
      await setDictionaryPriority(body.id, body.priority);
      await adminAuditEvent("admin.dictionary_updated", {
        dictId: body.id,
        action: "set_priority",
        newValue: body.priority,
        editor: session.discordUserId,
      });
    }

    // Return updated dictionary for optimistic UI
    const dicts = await getDictionaryList();
    const updated = dicts.find((d) => d.id === body.id);
    const entryCount = updated ? await getDictionaryEntryCount(updated.id) : 0;

    return new Response(
      JSON.stringify({
        success: true,
        dictionary: updated
          ? { id: String(updated.id), enabled: updated.enabled, priority: updated.priority, entryCount }
          : null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[DictionariesAPI] Update failed: ${reason} → Check CSRF token, payload fields, and update permissions`);
    return new Response(JSON.stringify({ error: "update failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
