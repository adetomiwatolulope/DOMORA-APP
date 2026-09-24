import "dotenv/config";

// Vitest setup file (runs before every test file's imports). The Prisma
// singleton in lib/db reads DATABASE_URL at construction, so we must point it
// at the test database before any module under test is imported.
if (!process.env.DATABASE_URL_TEST) {
  throw new Error("DATABASE_URL_TEST must be defined in .env for tests to run");
}
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST;
process.env.DOMORA_ENV = "test";
// Step 5 rate limiter: a huge default budget so the bulk suites never trip it;
// the dedicated rate-limit tests override this per-test and reset the store.
process.env.RATE_LIMIT_MAX_REQUESTS = "100000";
process.env.RATE_LIMIT_WINDOW_SECONDS = "60";