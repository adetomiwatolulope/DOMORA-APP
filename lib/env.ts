// Shared reader for numeric configuration supplied through the environment.
// An absent, unparseable, or non-positive value falls back to the caller's
// documented default instead of failing the process at import time — a typo in
// a deployment's env must not take a process down.
export function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
