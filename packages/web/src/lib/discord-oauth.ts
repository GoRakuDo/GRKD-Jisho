import { z } from "zod";
import { getEnv } from "../env";

const DISCORD_API = "https://discord.com/api/v10";

const tokenResponseSchema = z.object({
  access_token: z.string(),
});

const userResponseSchema = z.object({
  id: z.string(),
  username: z.string(),
  global_name: z.string().nullable(),
  avatar: z.string().nullable(),
});

const guildMemberResponseSchema = z.object({
  roles: z.array(z.string()),
  permissions: z.string().optional(),
});

export interface DiscordUser {
  id: string;
  username: string;
  global_name: string | null;
  avatar: string | null;
}

export interface DiscordGuildMember {
  roles: string[];
  permissions?: string | undefined;
}

/**
 * Build the Discord OAuth2 authorize URL.
 */
export function buildAuthorizeUrl(state: string): string {
  const env = getEnv();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: env.DISCORD_CLIENT_ID,
    redirect_uri: `${env.WEB_BASE_URL}/auth/callback`,
    scope: "identify guilds guilds.members.read",
    state,
  });
  return `${DISCORD_API}/oauth2/authorize?${params.toString()}`;
}

/**
 * Exchange an authorization code for an access token.
 */
export async function exchangeCode(code: string): Promise<string> {
  const env = getEnv();
  const resp = await fetch(`${DISCORD_API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env.DISCORD_CLIENT_ID,
      client_secret: env.DISCORD_CLIENT_SECRET,
      grant_type: "authorization_code",
      code,
      redirect_uri: `${env.WEB_BASE_URL}/auth/callback`,
    }),
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "unknown");
    throw new Error(`token exchange failed: ${resp.status} ${text}`);
  }

  const body = tokenResponseSchema.parse(await resp.json());
  return body.access_token;
}

/**
 * Fetch the current user's Discord user object.
 */
export async function fetchCurrentUser(
  accessToken: string,
): Promise<DiscordUser> {
  const resp = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!resp.ok) {
    throw new Error(`failed to fetch user: ${resp.status}`);
  }

  return userResponseSchema.parse(await resp.json());
}

/**
 * Fetch the current user's guild member object for the target guild.
 * Requires `guilds.members.read` scope.
 */
export async function fetchGuildMember(
  accessToken: string,
  guildId: string,
): Promise<DiscordGuildMember> {
  const resp = await fetch(
    `${DISCORD_API}/users/@me/guilds/${guildId}/member`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
    },
  );

  if (!resp.ok) {
    throw new Error(`failed to fetch guild member: ${resp.status}`);
  }

  return guildMemberResponseSchema.parse(await resp.json());
}

/**
 * Check if a user has Administrator or ManageGuild permission.
 * Uses computed permissions from the guild member object.
 */
export function hasGuildPermission(
  permissions: string | undefined,
  bit: bigint,
): boolean {
  if (!permissions) return false;
  try {
    return (BigInt(permissions) & bit) === bit;
  } catch {
    return false;
  }
}

export const PERM_ADMINISTRATOR = 1n << 3n; // bit 3
export const PERM_MANAGE_GUILD = 1n << 5n; // bit 5
