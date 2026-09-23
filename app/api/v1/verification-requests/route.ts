import { withHandler } from "@/lib/http";
import { asRecord, requiredString } from "@/lib/validate";
import { listPendingVerifications, submitVerificationRequest } from "@/modules/verification";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = asRecord(input);
    const request = await submitVerificationRequest(actor, {
      documentKey: requiredString(body, "documentKey"),
    });
    return { data: request };
  });
}

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const requests = await listPendingVerifications(actor);
    return { data: requests };
  });
}