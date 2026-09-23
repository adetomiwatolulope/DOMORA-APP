import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { approveVerification } from "@/modules/verification";

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const request = await approveVerification(parseId(id, "verification request"), actor);
    return { data: request };
  });
}