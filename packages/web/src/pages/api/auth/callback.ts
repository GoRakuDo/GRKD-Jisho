import type { APIRoute } from "astro";
import {
  exchangeCode,
  fetchCurrentUser,
  fetchGuildMember,
  hasGuildPermission,
  PERM_ADMINISTRATOR,
  PERM_MANAGE_GUILD,
  type DiscordGuildMember,
} from "../../../lib/discord-oauth";
import { getEnv } from "../../../env";
import {
  setSession,
  verifyOAuthState,
} from "../../../lib/session";

const DISCORD_API = "https://discord.com/api/v10";

export const GET: APIRoute = async (context) => {
  const { url } = context;
  const code = url.searchParams.get("code");
  const stateParam = url.searchParams.get("state");

  if (!code || !stateParam) {
    return context.redirect("/auth/login?error=oauth_failed");
  }

  if (!verifyOAuthState(context, stateParam)) {
    return context.redirect("/auth/login?error=oauth_failed");
  }

  try {
    const accessToken = await exchangeCode(code);
    const env = getEnv();
    const user = await fetchCurrentUser(accessToken);

    // Verify guild membership and get member info
    let member: DiscordGuildMember;
    try {
      member = await fetchGuildMember(accessToken, env.DISCORD_GUILD_ID);
    } catch {
      return context.redirect("/auth/login?error=guild_required");
    }

    // Check admin permissions
    const isAdmin = await checkAdminAccess(
      accessToken,
      env.DISCORD_GUILD_ID,
      member,
      env.ADMIN_ROLE_IDS,
    );

    if (!isAdmin) {
      return context.redirect("/auth/login?error=admin_required");
    }

    setSession(context, {
      discordUserId: user.id,
      guildId: env.DISCORD_GUILD_ID,
      isAdmin: true,
      expiresAt: Date.now() + 8 * 60 * 60 * 1000,
      authCheckedAt: Date.now(),
    });

    return context.redirect("/admin");
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error(`[OAuth] Callback failed: ${reason} → Check Discord OAuth2 config (CLIENT_ID, CLIENT_SECRET, redirect_uri)`);
    return context.redirect("/auth/login?error=oauth_failed");
  }
};

/**
 * Check if the user has admin access.
 *
 * Conditions (matches Bot Slash Commands):
 * 1. ADMIN_ROLE_IDS に一致する role を持つ
 * 2. Administrator permission (bit 3)
 * 3. ManageGuild permission (bit 5)
 * 4. Guild Owner
 */
async function checkAdminAccess(
  accessToken: string,
  guildId: string,
  member: DiscordGuildMember,
  adminRoleIds: string[],
): Promise<boolean> {
  // Condition 1: ADMIN_ROLE_IDS match
  if (adminRoleIds.length > 0) {
    if (member.roles.some((r) => adminRoleIds.includes(r))) return true;
  }

  // Condition 2: Administrator permission
  if (hasGuildPermission(member.permissions, PERM_ADMINISTRATOR)) return true;

  // Condition 3: ManageGuild permission
  if (hasGuildPermission(member.permissions, PERM_MANAGE_GUILD)) return true;

  // Condition 4: Guild Owner
  const guildResp = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!guildResp.ok) return false;

  const guild = await (async () => {
    const text = await guildResp.text();
    try {
      return JSON.parse(text) as { owner_id?: string };
    } catch {
      return {} as { owner_id?: string };
    }
  })();

  if (!guild.owner_id) return false;

  const userResp = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!userResp.ok) return false;

  const userBody = await (async () => {
    const text = await userResp.text();
    try {
      return JSON.parse(text) as { id: string };
    } catch {
      return {} as { id: string };
    }
  })();

  return guild.owner_id === userBody.id;
}
