import { withHandler } from "@/lib/http";
import { asRecord, requiredString } from "@/lib/validate";
import { requestAffiliation } from "@/modules/affiliations";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const affiliation = await requestAffiliation(actor, {
      agentId: requiredString(body, "agentId"),
      agencyId: requiredString(body, "agencyId"),
    });
    return { data: affiliation };
  });
}