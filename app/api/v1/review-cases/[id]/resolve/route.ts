import { withHandler } from "@/lib/http";
import { asRecord, enumValue, requiredString } from "@/lib/validate";
import { resolveReviewCase, type ResolutionAction } from "@/modules/reports";

const RESOLUTION_ACTIONS = ["NONE", "SUSPEND_LISTING"] as const;

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const result = await resolveReviewCase(id, actor, {
      resolution: requiredString(body, "resolution"),
      action: enumValue(body, "action", RESOLUTION_ACTIONS) as ResolutionAction,
    });
    return { data: result };
  });
}