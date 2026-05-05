import type { APIRoute } from "astro";
import { buildAuthorizeUrl } from "../../../lib/discord-oauth";
import { setOAuthState } from "../../../lib/session";

export const GET: APIRoute = async (context) => {
  const state = setOAuthState(context);
  const authorizeUrl = buildAuthorizeUrl(state);
  return context.redirect(authorizeUrl);
};
