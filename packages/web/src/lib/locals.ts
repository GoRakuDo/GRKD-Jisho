import type { APIContext } from "astro";

type UserShape = {
  discordUserId: string;
  guildId: string;
  isAdmin: boolean;
};

type LocalsShape = {
  user: UserShape | null;
  isAuthenticated: boolean;
};

/**
 * Set locals on an APIContext.
 *
 * Uses `as unknown as LocalsShape` because `astro check` does not
 * resolve `declare namespace App` augmentation reliably in Astro 5.
 * Runtime behaviour is identical — the shape exists at runtime.
 */
export function setLocals(
  ctx: APIContext,
  data: LocalsShape,
): void {
  const locals = ctx.locals as unknown as LocalsShape;
  locals.user = data.user;
  locals.isAuthenticated = data.isAuthenticated;
}

export function getUser(ctx: APIContext): UserShape | null {
  const locals = ctx.locals as unknown as LocalsShape;
  return locals.user;
}

export function getIsAuthenticated(ctx: APIContext): boolean {
  const locals = ctx.locals as unknown as LocalsShape;
  return locals.isAuthenticated;
}
