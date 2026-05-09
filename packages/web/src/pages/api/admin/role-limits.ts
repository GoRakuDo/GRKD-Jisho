/**
 * Admin API: Role Limit Management & Usage Reset
 *
 * GET    /api/admin/role-limits                 — List all role limits + default
 * PUT    /api/admin/role-limits                 — Add or update a role limit
 * DELETE /api/admin/role-limits?discordRoleId=  — Delete a custom role limit
 * POST   /api/admin/role-limits/reset-usage     — Reset a user's daily usage
 */

import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import {
  getRoleLimits,
  setRoleLimit,
  deleteRoleLimit,
  resetUserUsage,
} from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const all = await getRoleLimits();
    const defaultRecord = all.find((r) => r.discordRoleId === "__default__");
    const roleLimits = all.filter((r) => r.discordRoleId !== "__default__");

    return new Response(
      JSON.stringify({
        defaultLimit: defaultRecord?.dailyLimit ?? 10,
        roleLimits,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[RoleLimitsAPI] GET failed: ${reason} → Check role_rate_limits table`,
    );
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
      discordRoleId?: string;
      roleLabel?: string | null;
      dailyLimit?: number;
    };

    const { discordRoleId, roleLabel, dailyLimit } = body;

    if (!discordRoleId || typeof discordRoleId !== "string") {
      return new Response(
        JSON.stringify({ error: "discordRoleId is required" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (typeof dailyLimit !== "number" || !Number.isInteger(dailyLimit)) {
      return new Response(
        JSON.stringify({ error: "dailyLimit must be an integer" }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    if (dailyLimit < -1 || dailyLimit === 0 || dailyLimit > 99999) {
      return new Response(
        JSON.stringify({
          error: "dailyLimit must be -1 or between 1 and 99999",
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json" },
        },
      );
    }

    await setRoleLimit(discordRoleId, roleLabel ?? null, dailyLimit);

    return new Response(
      JSON.stringify({ success: true }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[RoleLimitsAPI] PUT failed: ${reason} → Check DB constraints`,
    );
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
  const discordRoleId = url.searchParams.get("discordRoleId");

  if (!discordRoleId) {
    return new Response(
      JSON.stringify({ error: "discordRoleId query parameter is required" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  if (discordRoleId === "__default__") {
    return new Response(
      JSON.stringify({ error: "Cannot delete the default role limit" }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      },
    );
  }

  try {
    await deleteRoleLimit(discordRoleId);
    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(
      `[RoleLimitsAPI] DELETE failed: ${reason} → Check DB constraints`,
    );
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async (context) => {
  if (new URL(context.request.url).pathname.endsWith("/reset-usage")) {
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
        userId?: string;
        guildId?: string;
      };

      const { userId, guildId } = body;

      if (!userId || typeof userId !== "string") {
        return new Response(
          JSON.stringify({ error: "userId is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      if (!guildId || typeof guildId !== "string") {
        return new Response(
          JSON.stringify({ error: "guildId is required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const affected = await resetUserUsage(userId, guildId);
      return new Response(
        JSON.stringify({ success: true, affected }),
        {
          status: 200,
          headers: { "Content-Type": "application/json" },
        },
      );
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.error(
        `[RoleLimitsAPI] POST reset-usage failed: ${reason}`,
      );
      return new Response(JSON.stringify({ error: "internal error" }), {
        status: 500,
        headers: { "Content-Type": "application/json" },
      });
    }
  }

  return new Response(JSON.stringify({ error: "not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
};