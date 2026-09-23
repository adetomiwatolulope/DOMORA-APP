import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { rejectAffiliation } from "@/modules/affiliations";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const affiliation = await rejectAffiliation(parseId(id, "affiliation"), actor);
    return { data: affiliation };
  });
}