import { beforeEach, describe, expect, it } from "vitest";
import { clientIp, consumeWindow, resetRateLimitStore } from "@/lib/rate-limit";
import { getRateLimitConfig, type RateLimitConfig } from "@/lib/rate-limit/config";

const cfg: RateLimitConfig = { maxRequestsPerWindow: 3, windowSeconds: 60 };

describe("rate limiter (Step 5)", () => {
  beforeEach(() => resetRateLimitStore());

  it("allows requests up to the per-window budget, then denies with a retry-after", () => {
    expect(consumeWindow("10.0.0.1", cfg, 100).allowed).toBe(true);
    expect(consumeWindow("10.0.0.1", cfg, 110).allowed).toBe(true);
    expect(consumeWindow("10.0.0.1", cfg, 115).allowed).toBe(true);

    const denied = consumeWindow("10.0.0.1", cfg, 118);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterSeconds).toBe(2); // window [60,120), ends at 120
  });

  it("rolls over to a fresh budget when the window turns over", () => {
    // window [0,60): consume one then deny
    consumeWindow("10.0.0.1", cfg, 10);
    consumeWindow("10.0.0.1", cfg, 20);
    consumeWindow("10.0.0.1", cfg, 30);
    expect(consumeWindow("10.0.0.1", cfg, 40).allowed).toBe(false);

    // window [60,120): a brand-new budget
    expect(consumeWindow("10.0.0.1", cfg, 60).allowed).toBe(true);
  });

  it("keeps budgets independent per IP", () => {
    consumeWindow("10.0.0.1", cfg, 100);
    consumeWindow("10.0.0.1", cfg, 101);
    consumeWindow("10.0.0.1", cfg, 102);
    expect(consumeWindow("10.0.0.1", cfg, 103).allowed).toBe(false);

    expect(consumeWindow("10.0.0.2", cfg, 103).allowed).toBe(true);
  });

  it("resetRateLimitStore() clears spent budgets", () => {
    consumeWindow("5.5.5.5", cfg, 100);
    consumeWindow("5.5.5.5", cfg, 101);
    consumeWindow("5.5.5.5", cfg, 102);
    expect(consumeWindow("5.5.5.5", cfg, 103).allowed).toBe(false);
    resetRateLimitStore();
    expect(consumeWindow("5.5.5.5", cfg, 104).allowed).toBe(true);
  });
});

describe("client IP extraction (Step 5)", () => {
  it("takes the left-most address of the x-forwarded-for chain", () => {
    const req = new Request("http://localhost:3000/api/v1/listings", {
      headers: { "x-forwarded-for": "203.0.113.9, 10.0.0.1, 198.51.100.7" },
    });
    expect(clientIp(req)).toBe("203.0.113.9");
  });

  it("falls back to the nobody bucket when no proxy header is present", () => {
    expect(clientIp(new Request("http://localhost:3000/api/v1/listings"))).toBe("unknown");
  });
});

describe("rate limit config (Step 5)", () => {
  it("defaults to 100 requests per 60s window and honours env overrides", () => {
    const savedMax = process.env.RATE_LIMIT_MAX_REQUESTS;
    const savedWindow = process.env.RATE_LIMIT_WINDOW_SECONDS;
    delete process.env.RATE_LIMIT_MAX_REQUESTS;
    delete process.env.RATE_LIMIT_WINDOW_SECONDS;
    try {
      expect(getRateLimitConfig()).toEqual({ maxRequestsPerWindow: 100, windowSeconds: 60 });
    } finally {
      if (savedMax !== undefined) process.env.RATE_LIMIT_MAX_REQUESTS = savedMax;
      if (savedWindow !== undefined) process.env.RATE_LIMIT_WINDOW_SECONDS = savedWindow;
    }

    process.env.RATE_LIMIT_MAX_REQUESTS = "7";
    process.env.RATE_LIMIT_WINDOW_SECONDS = "120";
    try {
      expect(getRateLimitConfig()).toEqual({ maxRequestsPerWindow: 7, windowSeconds: 120 });
    } finally {
      if (savedMax !== undefined) process.env.RATE_LIMIT_MAX_REQUESTS = savedMax;
      if (savedWindow !== undefined) process.env.RATE_LIMIT_WINDOW_SECONDS = savedWindow;
    }
  });

  it("ignores a non-positive env value instead of shipping a broken window", () => {
    const savedMax = process.env.RATE_LIMIT_MAX_REQUESTS;
    const savedWindow = process.env.RATE_LIMIT_WINDOW_SECONDS;
    process.env.RATE_LIMIT_MAX_REQUESTS = "-4";
    process.env.RATE_LIMIT_WINDOW_SECONDS = "0";
    try {
      expect(getRateLimitConfig()).toEqual({ maxRequestsPerWindow: 100, windowSeconds: 60 });
    } finally {
      if (savedMax !== undefined) process.env.RATE_LIMIT_MAX_REQUESTS = savedMax;
      if (savedWindow !== undefined) process.env.RATE_LIMIT_WINDOW_SECONDS = savedWindow;
    }
  });
});