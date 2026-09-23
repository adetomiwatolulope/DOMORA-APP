import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { getReviewCaseById } from "@/modules/reports";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const reviewCase = await getReviewCaseById(parseId(id, "review case"), actor);
    return { data: reviewCase };
  });
}