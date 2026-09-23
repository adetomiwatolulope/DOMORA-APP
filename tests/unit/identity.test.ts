import { UserRole } from "@prisma/client";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@/lib/db";
import { ApiError } from "@/lib/errors";
import { authenticate, createUser, type SignupRole } from "@/modules/identity/users";
import { resetDb } from "../helpers";

describe("identity", () => {
  beforeEach(async () => {
    await resetDb();
  });

  it("creates a user with a role-linked profile", async () => {
    const user = await createUser({
      email: "agent@example.com",
      password: "password123",
      role: UserRole.AGENT,
      country: "NG",
    });
    expect(user.role).toBe(UserRole.AGENT);
    expect(user).not.toHaveProperty("passwordHash"); // SEC-2: never returned
    const profile = await prisma.agentProfile.findUnique({ where: { userId: user.id } });
    expect(profile).not.toBeNull();
  });

  it("rejects a second account with the same email (409)", async () => {
    await createUser({ email: "a@example.com", password: "password123", role: UserRole.SEEKER });
    await expect(
      createUser({ email: "a@example.com", password: "password123", role: UserRole.SEEKER }),
    ).rejects.toMatchObject({ kind: "conflict", status: 409 });
  });

  it("never creates a reviewer or admin through the public path (SEC-3)", async () => {
    await expect(
      createUser({
        email: "reviewer@example.com",
        password: "password123",
        role: UserRole.PLATFORM_REVIEWER as unknown as SignupRole,
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      createUser({
        email: "admin@example.com",
        password: "password123",
        role: UserRole.SUPER_ADMIN as unknown as SignupRole,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it("rejects login with an unknown email using a generic message (SEC-11)", async () => {
    await expect(authenticate("ghost@example.com", "password123")).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      message: "Invalid email or password",
    });
  });

  it("rejects login with a wrong password using the same generic message (SEC-11)", async () => {
    await createUser({ email: "a@example.com", password: "password123", role: UserRole.SEEKER });
    await expect(
      authenticate("a@example.com", "wrong-password"),
    ).rejects.toMatchObject({
      kind: "unauthorized",
      status: 401,
      message: "Invalid email or password",
    });
  });

  it("emits a conflict ApiError when email is taken (dedupp checks response shape)", async () => {
    await createUser({ email: "a@example.com", password: "password123", role: UserRole.SEEKER });
    const error = await createUser({
      email: "a@example.com",
      password: "password123",
      role: UserRole.SEEKER,
    }).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect((error as ApiError).status).toBe(409);
  });
});