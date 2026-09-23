import { Prisma, UserRole } from "@prisma/client";
import { hash, verify } from "@node-rs/argon2";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { createSession, type SessionPayload } from "@/lib/auth";

// SEC-3: public signup may create these roles only. There is no public/API
// path to create PLATFORM_REVIEWER or SUPER_ADMIN and no path that changes
// a user's role.
export const PUBLIC_SIGNUP_ROLES = [
  UserRole.SEEKER,
  UserRole.AGENT,
  UserRole.AGENCY_ADMIN,
  UserRole.LANDLORD,
] as const;

export type SignupRole = (typeof PUBLIC_SIGNUP_ROLES)[number];

export interface SafeUser {
  id: string;
  role: UserRole;
  email: string;
  country: string | null;
  createdAt: Date;
}

function toSafeUser(user: {
  id: string;
  role: UserRole;
  email: string;
  country: string | null;
  createdAt: Date;
  passwordHash: string;
}): SafeUser {
  const { passwordHash: _passwordHash, ...safe } = user;
  return safe; // SEC-2/SEC-6: passwordHash is never selected into a response
}

export async function hashPassword(password: string): Promise<string> {
  // SEC-2: @node-rs/argon2 defaults to Argon2id when no algorithm is given.
  return hash(password);
}

export async function verifyPassword(hashed: string, password: string): Promise<boolean> {
  try {
    return await verify(hashed, password);
  } catch {
    return false;
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export interface CreateUserInput {
  email: string;
  password: string;
  role: SignupRole;
  country?: string | null;
  // Required when role === AGENCY_ADMIN: AgencyProfile.name is non-nullable.
  agencyName?: string;
}

export async function createUser(input: CreateUserInput): Promise<SafeUser> {
  if (!PUBLIC_SIGNUP_ROLES.includes(input.role)) {
    throw ApiError.forbidden("This role cannot be created through public signup (SEC-3)");
  }
  const email = normalizeEmail(input.email);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw ApiError.validation("email is invalid");
  }
  if (input.password.length < 8) {
    throw ApiError.validation("password must be at least 8 characters");
  }
  if (input.role === UserRole.AGENCY_ADMIN && !input.agencyName?.trim()) {
    throw ApiError.validation("agencyName is required for an agency admin account");
  }
  const passwordHash = await hashPassword(input.password);

  try {
    const user = await prisma.$transaction(async (tx) => {
      const created = await tx.user.create({
        data: {
          email,
          passwordHash,
          role: input.role,
          country: input.country ?? null,
        },
      });
      // [ASSUMPTION] The role-linked profile row is created with the account.
      // The PRD models verification and listing ownership through these
      // profiles; without one the account could never progress.
      switch (input.role) {
        case UserRole.SEEKER:
          break;
        case UserRole.AGENT:
          await tx.agentProfile.create({ data: { userId: created.id } });
          break;
        case UserRole.AGENCY_ADMIN:
          await tx.agencyProfile.create({
            data: { userId: created.id, name: input.agencyName!.trim() },
          });
          break;
        case UserRole.LANDLORD:
          await tx.landlordProfile.create({ data: { userId: created.id } });
          break;
        default: {
          const unreachable: never = input.role;
          throw unreachable;
        }
      }
      return created;
    });
    return toSafeUser(user);
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      throw ApiError.conflict("An account with this email already exists");
    }
    throw error;
  }
}

export interface AuthenticateResult {
  token: string;
  session: SessionPayload;
}

// SEC-11: failed login returns one generic message whether or not the email exists.
export async function authenticate(
  email: string,
  password: string,
): Promise<AuthenticateResult> {
  const user = await prisma.user.findUnique({ where: { email: normalizeEmail(email) } });
  if (!user) throw ApiError.unauthorized("Invalid email or password");
  const valid = await verifyPassword(user.passwordHash, password);
  if (!valid) throw ApiError.unauthorized("Invalid email or password");

  const session: SessionPayload = { userId: user.id, role: user.role };
  // Session id is regenerated on every login (SEC-1).
  const token = await createSession(session, randomUUID());
  return { token, session };
}