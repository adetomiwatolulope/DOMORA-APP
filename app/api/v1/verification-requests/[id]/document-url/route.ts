import { withHandler } from "@/lib/http";
import { verificationDocumentUrl } from "@/modules/verification";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const url = await verificationDocumentUrl(id, actor);
    return { data: { url } };
  });
}