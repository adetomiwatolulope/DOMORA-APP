import "server-only";
import { SignJWT, jwtVerify } from "jose";
import { UserRole } from "@prisma/client";
import { ApiError } from "@/lib/errors";

// PRD names no auth mechanism (SEC-1 open item). Recorded default:
// HttpOnly, SameSite=Lax session cookie holding a short-lived HS256 JWT
// (jose). The session id (jti) must be regenerated on login.
export const SESSION_COOKIE_NAME = "domora_session";

export const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7; // 7 days [ASSUMPTION]

export interface SessionPayload {
  userId: string;
  role: UserRole;
}

const ALL_ROLES: readonly UserRole[] = [
  UserRole.SEEKER,
  UserRole.AGENT,
  UserRole.AGENCY_ADMIN,
  UserRole.LANDLORD,
  UserRole.PLATFORM_REVIEWER,
  UserRole.SUPER_ADMIN,
];

function secretKey(): Uint8Array {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) {
    throw ApiError.config(
      "SESSION_SECRET is unset or too short (min 32 bytes). It must be a server-only env value (SEC-8).",
    );
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(payload: SessionPayload, tokenId: string): Promise<string> {
  return new SignJWT({ userId: payload.userId, role: payload.role, jti: tokenId })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSession(token: string | undefined | null): Promise<SessionPayload | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const { userId, role } = payload;
    if (typeof userId !== "string" || typeof role !== "string") return null;
    if (!ALL_ROLES.includes(role as UserRole)) return null;
    return { userId, role: role as UserRole };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE_ATTRS = {
  httpOnly: true,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: SESSION_MAX_AGE_SECONDS,
};