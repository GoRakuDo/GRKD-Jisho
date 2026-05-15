/**
 * Admin API: Prompt versions management
 *
 * GET    /api/admin/prompts                 — List prompt scopes or one scope
 * GET    /api/admin/prompts?scope=...       — Get one scope dashboard view
 * GET    /api/admin/prompts?id=<id>         — Get a specific version by id
 * PUT    /api/admin/prompts                 — Save: overwrites existing (with id) or creates new (without id)
 * DELETE /api/admin/prompts?id=<id>         — Delete a prompt version (default version is protected)
 */

import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import {
  PromptDomainError,
  createPrompt,
  deletePrompt,
  deletePromptScope,
  getActivePromptForScope,
  getPromptById,
  getPromptScopeViews,
  updatePrompt,
  isPromptScopeKey,
  type PromptScopeKey,
} from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !session.isAdmin || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const url = new URL(context.request.url);
  const scopeParam = url.searchParams.get("scope");
  const activeOnly = url.searchParams.get("active") === "true";
  const id = url.searchParams.get("id");
  const scopeKey: PromptScopeKey | null = scopeParam && isPromptScopeKey(scopeParam) ? scopeParam : null;

  try {
    if (id) {
      const prompt = await getPromptById(id);
      return new Response(JSON.stringify({ prompt: prompt ?? null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (scopeKey) {
      const scopes = await getPromptScopeViews();
      const scope = scopes.find((item) => item.scopeKey === scopeKey) ?? null;

      if (activeOnly) {
        return new Response(JSON.stringify({ prompt: scope?.resolvedPrompt ?? null }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }

      return new Response(JSON.stringify({ scope }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (activeOnly) {
      const prompt = await getActivePromptForScope("default");
      return new Response(JSON.stringify({ prompt: prompt ?? null }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const [scopes, defaultBaseline] = await Promise.all([
      getPromptScopeViews(),
      getActivePromptForScope("default"),
    ]);
    return new Response(JSON.stringify({ scopes, defaultBaseline }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
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
  if (!session || !session.isAdmin || !getIsAuthenticated(context)) {
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
    const body = (await context.request.json()) as Record<string, unknown>;
    const id = typeof body.id === "string" ? body.id : null;
    const content = typeof body.content === "string" ? body.content : "";
    const isActive = typeof body.isActive === "boolean" ? body.isActive : true;
    const scopeKey = typeof body.scopeKey === "string" && isPromptScopeKey(body.scopeKey) ? body.scopeKey : "default";

    if (content.length === 0) {
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

    const prompt = id
      ? await updatePrompt(id, content, isActive)
      : await createPrompt(content, isActive, scopeKey);

    return new Response(JSON.stringify({ prompt }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (err instanceof PromptDomainError) {
      return new Response(JSON.stringify({ error: reason }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    console.error(`[PromptsAPI] Save failed: ${reason} → Check prompts table and DB constraints`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const DELETE: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !session.isAdmin || !getIsAuthenticated(context)) {
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
  const scopeParam = url.searchParams.get("scope");
  const scopeKey = scopeParam && isPromptScopeKey(scopeParam) ? scopeParam : null;

  if (scopeKey) {
    try {
      const deletedCount = await deletePromptScope(scopeKey);
      return new Response(JSON.stringify({ success: true, deletedCount }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      if (err instanceof PromptDomainError) {
        return new Response(JSON.stringify({ error: reason }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      console.error(`[PromptsAPI] Scope delete failed: ${reason} → Check prompts table`);
      return new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

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
    if (err instanceof PromptDomainError) {
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
