// The numbers for the Step 5 rate limiter live here, never inside a handler
// or route file. Env overrides exist so tests can tighten the limit and
// deployments can tune it without a code change; the documented default is
// 100 requests per minute per IP.

export interface RateLimitConfig {
  maxRequestsPerWindow: number;
  windowSeconds: number;
}

export const DEFAULT_RATE_LIMIT: RateLimitConfig = {
  maxRequestsPerWindow: 100,
  windowSeconds: 60,
};

function positiveIntFromEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

export function getRateLimitConfig(): RateLimitConfig {
  return {
    maxRequestsPerWindow: positiveIntFromEnv("RATE_LIMIT_MAX_REQUESTS", DEFAULT_RATE_LIMIT.maxRequestsPerWindow),
    windowSeconds: positiveIntFromEnv("RATE_LIMIT_WINDOW_SECONDS", DEFAULT_RATE_LIMIT.windowSeconds),
  };
}