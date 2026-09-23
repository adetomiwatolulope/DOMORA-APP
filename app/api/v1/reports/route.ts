import { ReportTargetType } from "@prisma/client";
import { withHandler } from "@/lib/http";
import {
  asRecord,
  enumValue,
  optionalString,
  requiredString,
} from "@/lib/validate";
import { createReport } from "@/modules/reports";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const result = await createReport(actor, {
      targetType: enumValue(body, "targetType", Object.keys(ReportTargetType) as (keyof typeof ReportTargetType)[]),
      listingId: optionalString(body, "listingId"),
      targetUserId: optionalString(body, "targetUserId"),
      reason: requiredString(body, "reason"),
    });
    return { data: result };
  });
}