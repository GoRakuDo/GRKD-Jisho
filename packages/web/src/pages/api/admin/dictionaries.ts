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
    console.error("Dictionaries API error:", err);
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

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Dictionary update error:", err);
    return new Response(JSON.stringify({ error: "update failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
