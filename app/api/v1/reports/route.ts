import { listEnvelope, withHandler } from "@/lib/http";
import { createReportBody, parseBody, parseQuery, reportsQuerySchema } from "@/lib/schemas";
import { createReport, listReports } from "@/modules/reports";

export async function POST(req: Request) {
  return withHandler(req, async ({ actor, input }) => {
    const body = parseBody(input, createReportBody);
    const result = await createReport(actor, body);
    return { data: result };
  });
}

export async function GET(req: Request) {
  return withHandler(req, async ({ actor }) => {
    const query = parseQuery(new URL(req.url), reportsQuerySchema);
    const reports = await listReports(actor, {
      limit: query.limit,
      offset: query.offset,
      sort: "createdAt",
      order: query.order,
      targetType: query.targetType,
      reporterId: query.reporterId,
      resolved: query.resolved,
    });
    return listEnvelope(reports.items, reports.total, query.limit, query.offset);
  });
}