import type { APIRoute } from "astro";
import { getIsAuthenticated } from "../../../lib/locals";
import { getSession } from "../../../lib/session";
import {
  getPendingJobs,
  getAllJobs,
  approveJob,
  rejectJob,
} from "@grkd-jisho/db";
import { validateCsrfRequest } from "../../../lib/csrf";

export const GET: APIRoute = async (context) => {
  const session = getSession(context);
  if (!session || !getIsAuthenticated(context)) {
    return new Response(JSON.stringify({ error: "unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { url } = context;
  const filter = url.searchParams.get("filter") ?? "";

  try {
    if (filter === "pending") {
      const jobs = await getPendingJobs();
      return new Response(
        JSON.stringify({ jobs }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    const jobs = await getAllJobs(50);
    return new Response(
      JSON.stringify({ jobs }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );
  } catch (err) {
    console.error("Ops jobs API error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};

export const POST: APIRoute = async (context) => {
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
    let body: { action: string; jobId: string };
    try {
      body = await context.request.json() as { action: string; jobId: string };
    } catch {
      return new Response(JSON.stringify({ error: "invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!body.action || !body.jobId) {
      return new Response(JSON.stringify({ error: "invalid request" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    if (body.action === "approve") {
      const ok = await approveJob(body.jobId, session.discordUserId);
      return new Response(
        JSON.stringify({ success: ok }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    if (body.action === "reject") {
      const ok = await rejectJob(body.jobId, session.discordUserId);
      return new Response(
        JSON.stringify({ success: ok }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("Ops job action error:", err);
    return new Response(JSON.stringify({ error: "internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
};
