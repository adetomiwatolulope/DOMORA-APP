import { withHandler } from "@/lib/http";
import { asRecord, requiredString } from "@/lib/validate";
import { rejectVerification } from "@/modules/verification";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const request = await rejectVerification(id, actor, {
      reviewNote: requiredString(body, "reviewNote"),
    });
    return { data: request };
  });
}