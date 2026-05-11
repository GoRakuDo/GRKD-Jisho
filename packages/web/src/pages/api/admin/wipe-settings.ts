import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import { validateCsrfRequest } from "../../../lib/csrf";
import { getChannelSettings, setWipeEnabled } from "@grkd-jisho/db";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  if (!session.isAdmin) {
    return new Response(JSON.stringify({ error: "admin required" }), {
      status: 403,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const settings = await getChannelSettings(session.guildId);
    return new Response(
      JSON.stringify({
        settings: settings.map((setting) => ({
          ...setting,
          lastWipeAt: setting.lastWipeAt?.toISOString() ?? null,
          createdAt: setting.createdAt?.toISOString() ?? null,
          updatedAt: setting.updatedAt?.toISOString() ?? null,
        })),
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[WipeSettingsAPI] GET failed: ${reason} → Check channel_settings table`);
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

  if (!session.isAdmin) {
    return new Response(JSON.stringify({ error: "admin required" }), {
      status: 403,
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
      channelId?: string;
      wipeEnabled?: boolean;
    };

    const channelId = body.channelId?.trim();
    if (!channelId) {
      return new Response(JSON.stringify({ error: "channelId is required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!/^\d{17,20}$/.test(channelId)) {
      return new Response(JSON.stringify({ error: "channelId must be a Discord snowflake" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (typeof body.wipeEnabled !== "boolean") {
      return new Response(JSON.stringify({ error: "wipeEnabled must be boolean" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await setWipeEnabled(session.guildId, channelId, body.wipeEnabled);

    return new Response(JSON.stringify({ success: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[WipeSettingsAPI] PUT failed: ${reason} → Check DB constraints or CSRF/session`);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
