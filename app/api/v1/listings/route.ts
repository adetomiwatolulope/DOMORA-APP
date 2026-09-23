import { PropertyType } from "@prisma/client";
import { withHandler } from "@/lib/http";
import {
  asRecord,
  enumValue,
  optionalLatitude,
  optionalString,
  positiveInt,
  requiredString,
  requiredStringArray,
} from "@/lib/validate";
import { createListing, searchActiveListings } from "@/modules/listings";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const listing = await createListing(actor, {
      title: requiredString(body, "title"),
      price: positiveInt(body, "price"),
      address: requiredString(body, "address"),
      country: optionalString(body, "country"),
      propertyType: enumValue(body, "propertyType", Object.keys(PropertyType) as (keyof typeof PropertyType)[]),
      images: requiredStringArray(body, "images"),
    });
    return { data: listing };
  });
}

export async function GET(req: Request) {
  return withHandler(req, async ({ actor, input: _input }) => {
    const url = new URL(req.url);
    const latitude = optionalLatitude({ latitude: num(url.searchParams.get("lat")) }, "latitude");
    const longitude = optionalLatitude({ longitude: num(url.searchParams.get("lng")) }, "longitude");
    const radiusKm = url.searchParams.get("radiusKm") ? positiveInt({ radiusKm: num(url.searchParams.get("radiusKm")) }, "radiusKm") : undefined;
    const limit = url.searchParams.get("limit") ? positiveInt({ limit: num(url.searchParams.get("limit")) }, "limit") : undefined;
    const listings = await searchActiveListings({ latitude, longitude, radiusKm, limit });
    return { data: listings };
  });
}

function num(value: string | null): number | undefined {
  if (value === null) return undefined;
  const parsed = Number(value);
  return Number.isNaN(parsed) ? undefined : parsed;
}