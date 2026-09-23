import { execSync } from "node:child_process";
import "dotenv/config";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`[global-setup] missing required env: ${name}`);
  return value;
}

export default async function globalSetup(): Promise<void> {
  const testDatabaseUrl = requireEnv("DATABASE_URL_TEST");
  const url = new URL(testDatabaseUrl);
  const dbName = url.pathname.replace(/^\//, "");
  if (!/^[a-zA-Z0-9_]+$/.test(dbName)) {
    throw new Error(`[global-setup] invalid database name in DATABASE_URL_TEST: ${dbName}`);
  }

  const psqlBin = process.env.PSQL_BIN ?? "psql";
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";

  const exists = execSync(
    `"${psqlBin}" -tAc "SELECT 1 FROM pg_database WHERE datname='${dbName}'" "${adminUrl.toString()}"`,
    { encoding: "utf8", env: { ...process.env, DATABASE_URL: adminUrl.toString() } },
  ).trim();

  if (exists !== "1") {
    execSync(`"${psqlBin}" -c "CREATE DATABASE \\"${dbName}\\"" "${adminUrl.toString()}"`, {
      stdio: "inherit",
      env: { ...process.env, DATABASE_URL: adminUrl.toString() },
    });
  }

  execSync(`npx prisma migrate deploy`, {
    stdio: "inherit",
    env: { ...process.env, DATABASE_URL: testDatabaseUrl },
  });
}