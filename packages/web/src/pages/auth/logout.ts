import type { APIRoute } from "astro";
import { clearSession } from "../../lib/session";

export const GET: APIRoute = async (context) => {
  clearSession(context);
  return context.redirect("/auth/login");
};
