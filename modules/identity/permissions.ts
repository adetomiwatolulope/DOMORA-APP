import { UserRole } from "@prisma/client";
import { ApiError } from "@/lib/errors";

// Role-permission matrix, PRD Section 5. This is the only place the matrix
// is expressed (PR-ADM-001). A denial is always a 403, never a filtered
// result.

export type Permission =
  | "CREATE_LISTING"
  | "EDIT_OWN_LISTING"
  | "VIEW_ANY_LISTING"
  | "BOOK_INSPECTION"
  | "REVIEW_VERIFICATION_AND_REPORTS"
  | "SYSTEM_CONFIG";

const MATRIX: Record<Permission, readonly UserRole[]> = {
  CREATE_LISTING: [UserRole.AGENT, UserRole.AGENCY_ADMIN, UserRole.LANDLORD],
  EDIT_OWN_LISTING: [UserRole.AGENT, UserRole.AGENCY_ADMIN, UserRole.LANDLORD],
  VIEW_ANY_LISTING: [
    UserRole.SEEKER,
    UserRole.AGENT,
    UserRole.AGENCY_ADMIN,
    UserRole.LANDLORD,
    UserRole.PLATFORM_REVIEWER,
  ],
  BOOK_INSPECTION: [UserRole.SEEKER],
  REVIEW_VERIFICATION_AND_REPORTS: [UserRole.PLATFORM_REVIEWER],
  SYSTEM_CONFIG: [UserRole.SUPER_ADMIN],
};

export function assertAllowed(role: UserRole, permission: Permission): void {
  if (!MATRIX[permission].includes(role)) {
    throw ApiError.forbidden(
      `Role ${role} is not permitted to ${permission} (PR-ADM-001 permission matrix)`,
    );
  }
}

export function requireRole(role: UserRole, ...permitted: readonly UserRole[]): void {
  if (!permitted.includes(role)) {
    throw ApiError.forbidden(`Role ${role} is not permitted to perform this action`);
  }
}