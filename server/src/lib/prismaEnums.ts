import type {
  ApprovalStage as ApprovalStageType,
  ApprovalStatus as ApprovalStatusType,
  AdminRole as AdminRoleType,
  ReportStatus as ReportStatusType,
} from '@prisma/client';
import {
  ApprovalStage as ApprovalStageRuntime,
  ApprovalStatus as ApprovalStatusRuntime,
  AdminRole as AdminRoleRuntime,
  ReportStatus as ReportStatusRuntime,
} from '@prisma/client';

const fallbackApprovalStage = {
  MANAGER: 'MANAGER',
  FINANCE: 'FINANCE',
} as const satisfies Record<string, ApprovalStageType | string>;

const fallbackApprovalStatus = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
} as const satisfies Record<string, ApprovalStatusType | string>;

const fallbackAdminRole = {
  CFO: 'CFO',
  SUPER: 'SUPER',
  ANALYST: 'ANALYST',
  MANAGER: 'MANAGER',
  FINANCE: 'FINANCE',
} as const satisfies Record<string, AdminRoleType | string>;

const fallbackReportStatus = {
  SUBMITTED: 'SUBMITTED',
  MANAGER_APPROVED: 'MANAGER_APPROVED',
  FINANCE_APPROVED: 'FINANCE_APPROVED',
  REJECTED: 'REJECTED',
} as const satisfies Record<string, ReportStatusType | string>;

const normalizeEnum = <T extends Record<string, string>>(value: unknown, fallback: T): T => {
  if (value && typeof value === 'object') {
    return value as T;
  }
  return fallback;
};

export const ApprovalStageEnum = normalizeEnum(ApprovalStageRuntime, fallbackApprovalStage);
export const ApprovalStatusEnum = normalizeEnum(ApprovalStatusRuntime, fallbackApprovalStatus);
export const AdminRoleEnum = normalizeEnum(AdminRoleRuntime, fallbackAdminRole);
export const ReportStatusEnum = normalizeEnum(ReportStatusRuntime, fallbackReportStatus);

export type ApprovalStageLiteral = ApprovalStageType | typeof fallbackApprovalStage[keyof typeof fallbackApprovalStage];
export type ApprovalStatusLiteral =
  | ApprovalStatusType
  | typeof fallbackApprovalStatus[keyof typeof fallbackApprovalStatus];
export type AdminRoleLiteral = AdminRoleType | typeof fallbackAdminRole[keyof typeof fallbackAdminRole];
export type ReportStatusLiteral =
  | ReportStatusType
  | typeof fallbackReportStatus[keyof typeof fallbackReportStatus];
