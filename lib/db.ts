import "server-only";
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient =
  globalForPrisma.prisma ??
  new PrismaClient({
    // Production runs against a remote managed Postgres (Neon). The default
    // interactive-transaction timeout (5000ms) is a localhost expectation;
    // a slow round trip on a cold compute otherwise aborts legitimate work.
    transactionOptions: { maxWait: 10000, timeout: 60000 },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}