import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { readSession, SESSION_COOKIE_NAME, type SessionPayload } from "@/lib/auth";
import { ApiError, type ErrorKind } from "@/lib/errors";
import { clientIp, consumeWindow } from "@/lib/rate-limit";
import { getRateLimitConfig } from "@/lib/rate-limit/config";

// Thin handler wrapper (CS-9). All business decisions live in /modules;
// this wrapper only resolves the session, enforces the CSRF/origin check
// for state-changing requests (SEC-9), and maps results/errors.
//
// Step 3 response contract:
//   success (single) -> { data: <resource> }
//   success (list)   -> { data: [...], meta: { total, limit, offset, hasMore } }
//   error            -> { error: { code, message } }

type Handler = (ctx: { actor: SessionPayload; input: unknown }) => Promise<unknown>;

const ERROR_CODES: Record<ErrorKind, string> = {
  bad_request: "BAD_REQUEST",
  unauthorized: "UNAUTHORIZED",
  forbidden: "FORBIDDEN",
  not_found: "NOT_FOUND",
  conflict: "CONFLICT",
  validation: "VALIDATION_ERROR",
  rate_limited: "RATE_LIMITED",
  config: "INTERNAL_ERROR",
};

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
    return NextResponse.json(
      {
        error: {
          code: ERROR_CODES[error.kind] ?? "INTERNAL_ERROR",
          message: error.message,
        },
      },
      { status: error.status },
    );
  }
  // CS-8 / SEC-12: unexpected failures return a generic body; details stay server-side.
  // Logging here excludes request bodies and personal data.
  if (error instanceof Error) {
    console.error(`unhandled error: ${error.name}: ${error.message}`);
  }
  return NextResponse.json(
    { error: { code: "INTERNAL_ERROR", message: "Internal server error" } },
    { status: 500 },
  );
}

export async function withHandler(req: Request, handler: Handler): Promise<NextResponse> {
  try {
    // Step 5: per-IP budget is spent before auth so unauthenticated abuse is
    // counted too. Numbers live in lib/rate-limit/config.ts, not here.
    const outcome = consumeWindow(clientIp(req), getRateLimitConfig());
    if (!outcome.allowed) {
      return NextResponse.json(
        { error: { code: ERROR_CODES.rate_limited, message: "Too many requests" } },
        { status: 429, headers: { "retry-after": String(outcome.retryAfterSeconds) } },
      );
    }
    if (req.method !== "GET" && req.method !== "HEAD" && !isTrustedOrigin(req)) {
      throw ApiError.forbidden("Untrusted request origin");
    }
    const actor = await resolveActor();
    let input: unknown;
    const rawBody = await req.text();
    input = rawBody.length > 0 ? parseBody(rawBody) : undefined;
    const result = await handler({ actor, input });
    return NextResponse.json(result ?? { data: null });
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

// The one place a list response is shaped (Step 3). Every list endpoint must
// use this; never return a different list shape per resource.
export interface ListMeta {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}

export function listEnvelope<T>(
  items: T[],
  total: number,
  limit: number,
  offset: number,
): { data: T[]; meta: ListMeta } {
  return {
    data: items,
    meta: {
      total,
      limit,
      offset,
      hasMore: offset + items.length < total,
    },
  };
}