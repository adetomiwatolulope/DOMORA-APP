import { withHandler } from "@/lib/http";
import { listReviewQueue } from "@/modules/reports";

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const queue = await listReviewQueue(actor);
    return { data: queue };
  });
}