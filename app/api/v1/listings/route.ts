import { listEnvelope, withHandler } from "@/lib/http";
import { createListingBody, listingsQuerySchema, parseBody, parseQuery } from "@/lib/schemas";
import { createListing, listListings } from "@/modules/listings";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, createListingBody);
    const listing = await createListing(actor, body);
    return { data: listing };
  });
}

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const query = parseQuery(new URL(req.url), listingsQuerySchema);
    const listings = await listListings(actor, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      order: query.order,
      propertyType: query.propertyType,
      status: query.status,
      country: query.country,
      minPrice: query.minPrice,
      maxPrice: query.maxPrice,
      latitude: query.latitude,
      longitude: query.longitude,
      radiusKm: query.radiusKm,
    });
    return listEnvelope(listings.items, listings.total, query.limit, query.offset);
  });
}