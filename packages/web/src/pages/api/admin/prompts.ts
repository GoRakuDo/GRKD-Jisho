/**
 * Admin API: Prompt versions management
 *
 * GET    /api/admin/prompts          — List all versions
 * GET    /api/admin/prompts?active   — Get active version only
 * PUT    /api/admin/prompts          — Create/update a version
 */

import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import {
  getPromptVersions,
  getActivePrompt,
  upsertPrompt,
} from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const activeOnly = url.searchParams.get("active") === "true";

  try {
    if (activeOnly) {
      const active = await getActivePrompt();
      return new Response(
        JSON.stringify({ prompt: active ?? null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const versions = await getPromptVersions();
    return new Response(
      JSON.stringify({ versions }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[PromptsAPI] Fetch failed: ${reason} → Check prompts table and DB connectivity`);
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
    const body = await context.request.json();
    const { version, content, isActive } = body;

    if (!version || typeof version !== "string") {
      return new Response(JSON.stringify({ error: "version is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (typeof content !== "string") {
      return new Response(JSON.stringify({ error: "content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const prompt = await upsertPrompt(version, content, isActive ?? false);
    return new Response(
      JSON.stringify({ prompt }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[PromptsAPI] Update failed: ${reason} → Check prompts table and DB constraints`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
