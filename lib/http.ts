import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth";
import { ApiError } from "@/lib/errors";

// Thin handler wrapper (CS-9). All business decisions live in /modules;
// this wrapper only resolves the session, enforces the CSRF/origin check
// for state-changing requests (SEC-9), and maps results/errors.

type Handler = (ctx: { actor: SessionPayload; input: unknown }) => Promise<unknown>;

async function resolveActor(): Promise<SessionPayload> {
  const cookieStore = await cookies();
  const actor = await readSession(cookieStore.get(SESSION_COOKIE_NAME)?.value);
  if (!actor) throw ApiError.unauthorized();
  return actor;
}

function isTrustedOrigin(req: Request): boolean {
  const origin = req.headers.get("origin");
  if (!origin) return false;
  const allowed = process.env.APP_ORIGIN ?? "http://localhost:3000";
  return origin === allowed;
}

function toErrorResponse(error: unknown): NextResponse {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  // CS-8 / SEC-12: unexpected failures return a generic body; details stay server-side.
  // Logging here excludes request bodies and personal data.
  if (error instanceof Error) {
    console.error(`unhandled error: ${error.name}: ${error.message}`);
  }
  return NextResponse.json({ error: "internal_error" }, { status: 500 });
}

export async function withHandler(req: Request, handler: Handler): Promise<NextResponse> {
  try {
    if (req.method !== "GET" && req.method !== "HEAD" && !isTrustedOrigin(req)) {
      throw ApiError.forbidden("Untrusted request origin");
    }
    const actor = await resolveActor();
    let input: unknown;
    const rawBody = await req.text();
    input = rawBody.length > 0 ? parseBody(rawBody) : undefined;
    const result = await handler({ actor, input });
    return NextResponse.json(result ?? { ok: true });
  } catch (error) {
    return toErrorResponse(error);
  }
}

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw ApiError.badRequest("Invalid JSON body");
  }
}