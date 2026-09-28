import { NextResponse } from "next/server";
import { createSession, SESSION_COOKIE_ATTRS, SESSION_COOKIE_NAME } from "@/lib/auth";
import { randomUUID } from "node:crypto";

// TEMPORARY local-dev helper ONLY: sets a session cookie so /api/v1/* pages
// render in the browser, then redirects to `to`. Hard-disabled during any
// `next build`/production runtime. Delete this file once it has served its
// purpose (the customer evidence viewer). Not part of the API surface.
export async function GET(req: Request) {
  if (process.env.NODE_ENV === "production") {
    return new NextResponse("disabled", { status: 404 });
  }
  const url = new URL(req.url);
  const target = url.searchParams.get("to") ?? "/api/v1/verification-requests?limit=10";
  if (!target.startsWith("/")) {
    return NextResponse.json({ error: { code: "BAD_REQUEST", message: "to must be a relative path" } }, { status: 400 });
  }
  const token = await createSession(
    { userId: "00000000-0000-4000-8000-00000000646576", role: "PLATFORM_REVIEWER" },
    randomUUID(),
  );
  const res = NextResponse.redirect(new URL(target, req.url));
  res.cookies.set(SESSION_COOKIE_NAME, token, { ...SESSION_COOKIE_ATTRS, sameSite: "lax" });
  return res;
}