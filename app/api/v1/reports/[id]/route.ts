import { withHandler } from "@/lib/http";
import { parseId } from "@/lib/schemas";
import { getReportById } from "@/modules/reports";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor }) => {
    const report = await getReportById(parseId(id, "report"), actor);
    return { data: report };
  });
}