import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { approveListing } from "@/modules/listings";

// Reviewer-only listing activation (PR-LST-002). The action verb lives in the
// path so the collection's POST (create) and the item's approve are distinct.
export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const listing = await approveListing(parseId(id, "listing"), actor);
    return { data: listing };
  });
}