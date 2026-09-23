import { withHandler } from "@/lib/http";
import { parseBody, requestAffiliationBody } from "@/lib/schemas";
import { requestAffiliation } from "@/modules/affiliations";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, requestAffiliationBody);
    const affiliation = await requestAffiliation(actor, body);
    return { data: affiliation };
  });
}