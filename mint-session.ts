import crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { UserRole } from "@prisma/client";
import { prisma } from "@/lib/db";
import { createSession } from "@/lib/auth";

process.env.SESSION_SECRET = readFileSync(
  "C:/Users/user/AppData/Local/Temp/opencode/prod-session-secret.txt",
  "utf8",
).trim();

const reviewer = await prisma.user.findFirst({
  where: { role: UserRole.PLATFORM_REVIEWER },
  select: { id: true },
});
if (!reviewer) throw new Error("no seeded reviewer found");

const token = await createSession(
  { userId: reviewer.id, role: UserRole.PLATFORM_REVIEWER },
  crypto.randomUUID(),
);
process.stdout.write(token);
await prisma.$disconnect();