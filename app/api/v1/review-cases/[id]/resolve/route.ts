import { withHandler } from "@/lib/http";
import { parseBody, parseId, resolveReviewCaseBody } from "@/lib/schemas";
import { resolveReviewCase } from "@/modules/reports";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, resolveReviewCaseBody);
    const result = await resolveReviewCase(parseId(id, "review case"), actor, {
      resolution: body.resolution,
      action: body.action,
    });
    return { data: result };
  });
}