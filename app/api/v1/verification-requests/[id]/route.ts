import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { getVerificationRequestById } from "@/modules/verification";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const request = await getVerificationRequestById(parseId(id, "verification request"), actor);
    return { data: request };
  });
}