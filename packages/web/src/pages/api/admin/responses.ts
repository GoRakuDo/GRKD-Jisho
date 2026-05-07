import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import {
  searchResponse,
  getResponseDetail,
  updateResponse,
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
      return new Response(
        JSON.stringify({ response: detail, source: detail.source, edits: detail.edits }),
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
    console.error("Responses API error:", err);
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
    console.error("Response update error:", err);
    return new Response(JSON.stringify({ error: "update failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
