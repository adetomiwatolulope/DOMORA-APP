import { withHandler } from "@/lib/http";
import { parseBody, parseId, rejectVerificationBody } from "@/lib/schemas";
import { rejectVerification } from "@/modules/verification";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, rejectVerificationBody);
    const request = await rejectVerification(parseId(id, "verification request"), actor, {
      reviewNote: body.reviewNote,
    });
    return { data: request };
  });
}