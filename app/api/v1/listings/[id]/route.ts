import { withHandler } from "@/lib/http";
import { approveListing, getListingById } from "@/modules/listings";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const listing = await getListingById(actor, id);
    return { data: listing };
  });
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const listing = await approveListing(id, actor);
    return { data: listing };
  });
}