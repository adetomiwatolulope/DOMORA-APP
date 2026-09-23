import { ApiError } from "@/lib/errors";

export function parseJsonBody(text: string | null): unknown {
  if (!text) throw ApiError.badRequest("Request body is required");
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw ApiError.badRequest("Invalid JSON body");
  }
}

export function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw ApiError.badRequest("Request body must be an object");
  }
  return value as Record<string, unknown>;
}

export function requiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw ApiError.badRequest(`${key} is required`);
  }
  return value.trim();
}

export function optionalString(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") throw ApiError.badRequest(`${key} must be a string`);
  const trimmed = value.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}

export function positiveInt(record: Record<string, unknown>, key: string): number {
  const value = record[key];
  if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
    throw ApiError.badRequest(`${key} must be a positive integer`);
  }
  return value;
}

export function requiredStringArray(record: Record<string, unknown>, key: string): string[] {
  const value = record[key];
  if (!Array.isArray(value) || value.length === 0) {
    throw ApiError.badRequest(`${key} must be a non-empty array`);
  }
  const items = value.map((item) => (typeof item === "string" ? item.trim() : ""));
  if (items.some((item) => item.length === 0)) {
    throw ApiError.badRequest(`${key} must contain only non-empty strings`);
  }
  return items;
}

export function enumValue<T extends readonly string[]>(
  record: Record<string, unknown>,
  key: string,
  allowed: T,
): T[number] {
  const value = record[key];
  if (typeof value !== "string" || !allowed.includes(value as T[number])) {
    throw ApiError.badRequest(`${key} is invalid`);
  }
  return value as T[number];
}

export function optionalLatitude(record: Record<string, unknown>, key: string): number | undefined {
  const value = record[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || value < -90 || value > 90) {
    throw ApiError.badRequest(`${key} must be a latitude between -90 and 90`);
  }
  return value;
}