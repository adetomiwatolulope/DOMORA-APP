import type { NotificationChannel, Prisma } from "@prisma/client";
import { ApiError } from "@/lib/errors";

// PR-NOT-002: every notification is generated from a versioned template
// with variable substitution, never a hand-built string at a call site.
// The Notification.template column stores the versioned key; the body is
// deterministic from this registry and escaped before being shown.

export interface TemplateDef {
  id: string;
  version: number;
  body: string;
}

export const NOTIFICATION_TEMPLATES = {
  VERIFICATION_APPROVED: {
    id: "verification_approved",
    version: 1,
    body: "Your verification request was approved. You are now verified and can create listings.",
  },
  VERIFICATION_REJECTED: {
    id: "verification_rejected",
    version: 1,
    body: "Your verification request was rejected. Reason: {reviewNote}. You may resubmit.",
  },
  AFFILIATION_ACCEPTED: {
    id: "affiliation_accepted",
    version: 1,
    body: "Your affiliation request with {agencyName} was accepted.",
  },
  AFFILIATION_REJECTED: {
    id: "affiliation_rejected",
    version: 1,
    body: "Your affiliation request with {agencyName} was declined.",
  },
} as const satisfies Record<string, TemplateDef>;

export type NotificationTemplateId = keyof typeof NOTIFICATION_TEMPLATES;

type Vars = Record<string, string | number>;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderTemplate(templateId: NotificationTemplateId, vars: Vars): string {
  const template = NOTIFICATION_TEMPLATES[templateId];
  if (!template) {
    throw ApiError.config(`Unknown notification template: ${String(templateId)}`);
  }
  return template.body.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = vars[key];
    if (value === undefined) return match;
    return escapeHtml(String(value)); // SEC-7: template variables are rendered escaped
  });
}

export async function notify(
  tx: Prisma.TransactionClient,
  input: {
    userId: string;
    templateId: NotificationTemplateId;
    vars: Vars;
    channel?: NotificationChannel;
  },
): Promise<void> {
  const template = NOTIFICATION_TEMPLATES[input.templateId];
  const text = renderTemplate(input.templateId, input.vars);
  if (template === undefined || text.includes("{")) {
    throw ApiError.config(`Notification template ${String(input.templateId)} did not render`);
  }
  await tx.notification.create({
    data: {
      userId: input.userId,
      channel: input.channel ?? "IN_APP",
      template: `${template.id}@v${template.version}`,
      // REVIEW FIX #14: substitution inputs are stored so the delivery worker
      // renders the body without re-reading the caller's context.
      vars: input.vars as Prisma.InputJsonValue,
    },
  });
}