import { listEnvelope, withHandler } from "@/lib/http";
import { createVerificationBody, parseBody, parseQuery, verificationQuerySchema } from "@/lib/schemas";
import { listVerificationRequests, submitVerificationRequest } from "@/modules/verification";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, createVerificationBody);
    const request = await submitVerificationRequest(actor, { documentKey: body.documentKey });
    return { data: request };
  });
}

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const query = parseQuery(new URL(req.url), verificationQuerySchema);
    const requests = await listVerificationRequests(actor, {
      limit: query.limit,
      offset: query.offset,
      sort: query.sort,
      order: query.order,
      status: query.status,
      userId: query.userId,
    });
    return listEnvelope(requests.items, requests.total, query.limit, query.offset);
  });
}