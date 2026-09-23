import { listEnvelope, withHandler } from "@/lib/http";
import { parseQuery, reviewQueueQuerySchema } from "@/lib/schemas";
import { listReviewQueue } from "@/modules/reports";

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const query = parseQuery(new URL(req.url), reviewQueueQuerySchema);
    const queue = await listReviewQueue(actor, {
      limit: query.limit,
      offset: query.offset,
      sort: "createdAt",
      order: query.order,
      status: query.status,
      targetType: query.targetType,
    });
    return listEnvelope(queue.items, queue.total, query.limit, query.offset);
  });
}