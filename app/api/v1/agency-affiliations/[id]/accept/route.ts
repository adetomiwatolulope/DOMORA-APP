import { withHandler } from "@/lib/http";
import { acceptAffiliation } from "@/modules/affiliations";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const affiliation = await acceptAffiliation(id, actor);
    return { data: affiliation };
  });
}