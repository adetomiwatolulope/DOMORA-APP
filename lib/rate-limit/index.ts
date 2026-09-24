// Step 5 rate limiter: per-IP fixed-window counter. In-memory (per serverless
// instance), which is acceptable at MVP volume; a shared distributed store is
// an open item. Call sites consume the outcome and map it to an HTTP response;
// the decision itself lives here.
import { getRateLimitConfig, type RateLimitConfig } from "./config";

export interface RateLimitOutcome {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface WindowEntry {
  startedAt: number; // epoch seconds at the start of the window
  count: number;
}

const buckets = new Map<string, WindowEntry>();

export function resetRateLimitStore(): void {
  buckets.clear();
}

// Left-most address of the proxy chain is the immediate client. Missing
// headers collapse to a single "unknown" bucket so every untagged caller still
// shares one budget rather than unlimited.
export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip") ?? "unknown";
}

export function consumeWindow(
  ip: string,
  config: RateLimitConfig = getRateLimitConfig(),
  nowSeconds: number = Math.floor(Date.now() / 1000),
): RateLimitOutcome {
  const windowStart = Math.floor(nowSeconds / config.windowSeconds) * config.windowSeconds;
  const entry = buckets.get(ip);
  if (!entry || entry.startedAt !== windowStart) {
    buckets.set(ip, { startedAt: windowStart, count: 1 });
    return { allowed: true, retryAfterSeconds: 0 };
  }
  entry.count += 1;
  if (entry.count <= config.maxRequestsPerWindow) {
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const retryAfterSeconds = Math.max(0, windowStart + config.windowSeconds - nowSeconds);
  return { allowed: false, retryAfterSeconds };
}