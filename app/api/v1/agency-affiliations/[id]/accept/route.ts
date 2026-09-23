import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { acceptAffiliation } from "@/modules/affiliations";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const affiliation = await acceptAffiliation(parseId(id, "affiliation"), actor);
    return { data: affiliation };
  });
}