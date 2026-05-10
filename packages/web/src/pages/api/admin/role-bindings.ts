import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import {
  getRoleBindings,
  upsertRoleBinding,
  deleteRoleBinding,
  SYSTEM_ROLE_KEYS,
} from "@grkd-jisho/db";

/**
 * GET /api/admin/role-bindings
 * Returns all role bindings for the current guild.
 */
export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  try {
    const bindings = await getRoleBindings(session.guildId);
    return new Response(JSON.stringify({ bindings }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[RoleBindings] GET failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "Failed to fetch bindings" }), { status: 500 });
  }
};

/**
 * PUT /api/admin/role-bindings
 * Upsert a role binding.
 * Body: { discordRoleId, systemRoleKey }
 */
export const PUT: APIRoute = async (context) => {
  const session = getSession(context);

  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  if (!validateCsrfRequest(session.discordUserId, context.request)) {
    return new Response(JSON.stringify({ error: "Invalid CSRF token" }), { status: 403 });
  }

  try {
    const body = await context.request.json();
    const { discordRoleId, systemRoleKey } = body;

    if (!discordRoleId || typeof discordRoleId !== "string") {
      return new Response(JSON.stringify({ error: "discordRoleId is required" }), { status: 400 });
    }
    if (!/^\d{17,20}$/.test(discordRoleId)) {
      return new Response(JSON.stringify({ error: "discordRoleId must be a Discord snowflake" }), { status: 400 });
    }
    if (!systemRoleKey || typeof systemRoleKey !== "string") {
      return new Response(JSON.stringify({ error: "systemRoleKey is required" }), { status: 400 });
    }
    if (!SYSTEM_ROLE_KEYS.includes(systemRoleKey as typeof SYSTEM_ROLE_KEYS[number])) {
      return new Response(JSON.stringify({ error: "Invalid systemRoleKey" }), { status: 400 });
    }

    const binding = await upsertRoleBinding(session.guildId, discordRoleId, systemRoleKey);
    return new Response(JSON.stringify({ binding }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[RoleBindings] PUT failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "Failed to upsert binding" }), { status: 500 });
  }
};

/**
 * DELETE /api/admin/role-bindings?id=><number>
 * DELETE /api/admin/role-bindings?id=<number>
 */
export const DELETE: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }
  if (!validateCsrfRequest(session.discordUserId, context.request)) {
    return new Response(JSON.stringify({ error: "Invalid CSRF token" }), { status: 403 });
  }
  try {
    const idParam = context.url.searchParams.get("id");
    if (!idParam) {
      return new Response(JSON.stringify({ error: "id query param is required" }), { status: 400 });
    }
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return new Response(JSON.stringify({ error: "Invalid id" }), { status: 400 });
    }
    const deleted = await deleteRoleBinding(session.guildId, id);
    if (!deleted) {
      return new Response(JSON.stringify({ error: "Binding not found" }), { status: 404 });
    }
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[RoleBindings] DELETE failed:", err instanceof Error ? err.message : err);
    return new Response(JSON.stringify({ error: "Failed to delete binding" }), { status: 500 });
  }
};
