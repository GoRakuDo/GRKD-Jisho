/**
 * Admin API: Prompt versions management
 *
 * GET    /api/admin/prompts                 — List all versions
 * GET    /api/admin/prompts?active          — Get active version only
 * GET    /api/admin/prompts?id=<uuid>       — Get a specific version by id
 * PUT    /api/admin/prompts                 — Save: overwrites existing (with id) or creates new (without id)
 * DELETE /api/admin/prompts?id=<uuid>       — Delete a prompt version (default version is protected)
 */

import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import {
  getPromptVersions,
  getActivePrompt,
  getPromptById,
  createPrompt,
  updatePrompt,
  deletePrompt,
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
  const id = url.searchParams.get("id");

  try {
    if (id) {
      const prompt = await getPromptById(id);
      return new Response(
        JSON.stringify({ prompt: prompt ?? null }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

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
    const { id, content, isActive } = body;

    if (typeof content !== "string" || content.length === 0) {
      return new Response(JSON.stringify({ error: "content is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (content.length > 65535) {
      return new Response(JSON.stringify({ error: "content exceeds maximum length (65535 chars)" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // id present → overwrite existing version; absent → create new version
    const prompt = id
      ? await updatePrompt(id, content, isActive ?? true)
      : await createPrompt(content, isActive ?? true);
    return new Response(
      JSON.stringify({ prompt }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[PromptsAPI] Save failed: ${reason} → Check prompts table and DB constraints`);
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

  const url = new URL(context.request.url);
  const id = url.searchParams.get("id");

  if (!id) {
    return new Response(JSON.stringify({ error: "id query parameter is required" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    await deletePrompt(id);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (reason.includes("Cannot delete") || reason.includes("not found")) {
      return new Response(JSON.stringify({ error: reason }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error(`[PromptsAPI] Delete failed: ${reason} → Check prompts table`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
