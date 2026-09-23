import { ListingStatus, PropertyType, ReportTargetType, VerificationStatus } from "@prisma/client";
import { z } from "zod";
import { ApiError } from "@/lib/errors";

// THE single place request bodies, query parameters, and path identifiers are
// validated (Step 4). Routes parse via parseBody / parseQuery / parseId and
// never hand-roll checks. Modules keep their own business-rule asserts as
// defense in depth — nothing here replaces a PRD gate.

export const DEFAULT_LIST_LIMIT = 20;
export const MAX_LIST_LIMIT = 100;

const UUID_PATTERN =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

// Every id in the locked schema is String @default(uuid()) (canonical UUIDv4),
// so a value that is not a UUID is a malformed identifier -> 400, never 500.
// A well-formed but unknown id is a 404, decided by the module.
const resourceId = z.string().regex(UUID_PATTERN);

export function parseId(value: string, label: string): string {
  const parsed = resourceId.safeParse(value);
  if (!parsed.success) {
    throw ApiError.badRequest(`${label} must be a valid identifier (UUID)`);
  }
  return parsed.data;
}

// --- Query parameters -------------------------------------------------------
// Query values arrive as strings: coerce numbers, clamp limit to the
// configured maximum (Step 4: a limit of 5000 is clamped, not honoured), and
// reject anything else with 400 (never a silent 500, never a silent ignore of
// an unknown sort field).

const queryLimit = z
  .coerce.number({ message: "limit must be an integer" })
  .int("limit must be an integer")
  .min(1, "limit must be at least 1")
  .transform((value) => Math.min(value, MAX_LIST_LIMIT))
  .default(DEFAULT_LIST_LIMIT);

const queryOffset = z
  .coerce.number({ message: "offset must be an integer" })
  .int("offset must be an integer")
  .min(0, "offset must be a non-negative integer")
  .default(0);

const queryOrder = z.enum(["asc", "desc"], { message: "order must be asc or desc" }).default("desc");

export function listQuery<const S extends readonly [string, ...string[]]>(opts: {
  sorts: S;
  defaultSort?: S[number];
  defaultOrder?: "asc" | "desc";
}) {
  return z.object({
    limit: queryLimit,
    offset: queryOffset,
    sort: z
      .enum(opts.sorts, { message: `sort must be one of: ${opts.sorts.join(", ")}` })
      .default(opts.defaultSort ?? opts.sorts[0]),
    order: queryOrder.default(opts.defaultOrder ?? "desc"),
  });
}

function enumOptional<T extends readonly [string, ...string[]]>(values: T) {
  return z.enum(values).optional();
}

const optionalTrimmed = z.preprocess(
  (value) => (typeof value === "string" && value.trim() === "" ? undefined : value),
  z.string().trim().min(1).optional(),
);

export const verificationQuerySchema = listQuery({
  sorts: ["createdAt", "reviewedAt"] as const,
  defaultSort: "createdAt",
}).extend({
  status: enumOptional(Object.values(VerificationStatus) as [VerificationStatus, ...VerificationStatus[]]),
  userId: optionalTrimmed,
});

export const listingsQuerySchema = listQuery({
  sorts: ["createdAt", "price", "title"] as const,
  defaultSort: "createdAt",
}).extend({
  propertyType: enumOptional(Object.values(PropertyType) as [PropertyType, ...PropertyType[]]),
  status: enumOptional(Object.values(ListingStatus) as [ListingStatus, ...ListingStatus[]]),
  country: optionalTrimmed,
  minPrice: z.coerce.number({ message: "minPrice must be an integer" }).int().min(0).optional(),
  maxPrice: z.coerce.number({ message: "maxPrice must be an integer" }).int().min(0).optional(),
  latitude: z.coerce.number({ message: "lat must be a number" }).min(-90, "lat must be between -90 and 90").max(90).optional(),
  longitude: z.coerce.number({ message: "lng must be a number" }).min(-180, "lng must be between -180 and 180").max(180).optional(),
  radiusKm: z.coerce.number({ message: "radiusKm must be a number" }).min(0.1, "radiusKm must be at least 0.1").optional(),
});

export const reportsQuerySchema = listQuery({
  sorts: ["createdAt"] as const,
  defaultSort: "createdAt",
}).extend({
  targetType: enumOptional(Object.values(ReportTargetType) as [ReportTargetType, ...ReportTargetType[]]),
  reporterId: optionalTrimmed,
  resolved: z
    .enum(["true", "false"], { message: "resolved must be true or false" })
    .transform((value) => value === "true")
    .optional(),
});

const QUEUE_STATUSES = ["OPEN", "UNDER_REVIEW", "RESOLVED"] as const;

export const reviewQueueQuerySchema = listQuery({
  sorts: ["createdAt"] as const,
  defaultSort: "createdAt",
  defaultOrder: "asc", // FIFO: oldest open case first
}).extend({
  status: z.enum(QUEUE_STATUSES).optional(),
  targetType: enumOptional(Object.values(ReportTargetType) as [ReportTargetType, ...ReportTargetType[]]),
});

// --- Request bodies ---------------------------------------------------------
// A well-formed body that fails the schema is VALIDATION_ERROR (422) and the
// message names the offending field (Step 4). Malformed JSON is already a 400
// in lib/http before any schema runs.

export const createVerificationBody = z.object({
  documentKey: z.string({ message: "documentKey is required" }).trim().min(1, "documentKey is required"),
});

export const rejectVerificationBody = z.object({
  reviewNote: z
    .string({ message: "reviewNote is required" })
    .trim()
    .min(1, "reviewNote is required"),
});

export const createListingBody = z.object({
  title: z
    .string({ message: "title is required (3-200 characters)" })
    .trim()
    .min(3, "title is required (3-200 characters)")
    .max(200, "title is required (3-200 characters)"),
  price: z
    .number({ message: "price is required and must be a number" })
    .int("price must be an integer in the smallest currency unit")
    .positive("price must be a positive integer in the smallest currency unit"),
  address: z.string({ message: "address is required" }).trim().min(1, "address is required"),
  country: z.string().trim().min(1).optional(),
  propertyType: z.enum(Object.values(PropertyType) as [PropertyType, ...PropertyType[]], {
    message: "propertyType is invalid",
  }),
  images: z
    .array(z.string({ message: "images must contain only strings" }).trim().min(1))
    .min(1, "images must be a non-empty array"),
  latitude: z.number({ message: "latitude must be a number" }).min(-90).max(90).optional(),
  longitude: z.number({ message: "longitude must be a number" }).min(-180).max(180).optional(),
});

export const createReportBody = z.object({
  targetType: z.enum(Object.values(ReportTargetType) as [ReportTargetType, ...ReportTargetType[]], {
    message: "targetType is invalid",
  }),
  listingId: z.string({ message: "listingId must be a string" }).uuid("listingId must be a valid identifier (UUID)").optional(),
  targetUserId: z
    .string({ message: "targetUserId must be a string" })
    .uuid("targetUserId must be a valid identifier (UUID)")
    .optional(),
  reason: z
    .string({ message: "reason is required (10-2000 characters)" })
    .trim()
    .min(10, "reason is required (10-2000 characters)")
    .max(2000, "reason is required (10-2000 characters)"),
});

export const resolveReviewCaseBody = z.object({
  resolution: z
    .string({ message: "resolution is required" })
    .trim()
    .min(1, "resolution is required"),
  action: z.enum(["NONE", "SUSPEND_LISTING"], { message: "action is invalid" }).optional(),
});

export const requestAffiliationBody = z.object({
  agentId: z.string({ message: "agentId is required" }).uuid("agentId must be a valid identifier (UUID)"),
  agencyId: z.string({ message: "agencyId is required" }).uuid("agencyId must be a valid identifier (UUID)"),
});

// --- Parse helpers ----------------------------------------------------------

function valueAtPath(input: unknown, path: readonly PropertyKey[]): unknown {
  let value: unknown = input;
  for (const segment of path) {
    if (typeof value !== "object" || value === null) return undefined;
    value = (value as Record<PropertyKey, unknown>)[segment];
  }
  return value;
}

function firstIssueMessage(
  input: unknown,
  issues: z.ZodIssue[],
  absentCodeBuilder: (field: string) => string,
): string {
  const issue = issues[0];
  const field = issue.path.length > 0 ? issue.path.join(".") : "body";
  // A missing field surfaces as an invalid_type issue at a path whose value is
  // genuinely absent (zod v4 does not tag "received" on the issue).
  if (issue.code === "invalid_type" && valueAtPath(input, issue.path) === undefined) {
    return absentCodeBuilder(field);
  }
  return `Field "${field}": ${issue.message}`;
}

// Body schema failures are 422 VALIDATION_ERROR (Step 3 contract).
export function parseBody<T extends z.ZodType>(input: unknown, schema: T): z.infer<T> {
  if (input === undefined || input === null) {
    throw ApiError.validation("Request body is required");
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    throw ApiError.validation(
      firstIssueMessage(input, parsed.error.issues, (field) => `Field "${field}" is required`),
    );
  }
  return parsed.data;
}

// Query-parameter failures are 400 BAD_REQUEST with a clear message that names
// the offending parameter (Step 4: negative offset, unknown sort, bad enums).
export function parseQuery<T extends z.ZodType>(url: URL, schema: T): z.infer<T> {
  const input: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) {
    input[key] = value;
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue.path.length > 0 ? issue.path.join(".") : "query";
    throw ApiError.badRequest(`Invalid query parameter "${field}": ${issue.message}`);
  }
  return parsed.data;
}