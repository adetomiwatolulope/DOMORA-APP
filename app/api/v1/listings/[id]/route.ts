import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { getListingById } from "@/modules/listings";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const listing = await getListingById(actor, parseId(id, "listing"));
    return { data: listing };
  });
}