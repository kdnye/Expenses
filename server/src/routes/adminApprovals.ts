import { Router } from 'express';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, adminApprovalRoles } from '../middleware/adminAuth.js';
import {
  ApprovalStageEnum,
  ApprovalStatusEnum,
  AdminRoleEnum,
  ReportStatusEnum,
  type ApprovalStageLiteral,
  type AdminRoleLiteral,
  type ApprovalStatusLiteral,
} from '../lib/prismaEnums.js';

const router = Router();

const approvalQuerySchema = z
  .object({
    stage: z.nativeEnum(ApprovalStageEnum),
    status: z.enum(['pending', 'approved', 'rejected']).default('pending'),
  })
  .transform((value) => ({
    stage: value.stage,
    status: value.status,
  }));

const decisionSchema = z.object({
  stage: z.nativeEnum(ApprovalStageEnum),
  action: z.enum(['approve', 'reject']),
  note: z
    .string()
    .trim()
    .max(1000, 'Notes must be 1,000 characters or fewer.')
    .optional(),
});

const stageRoleMap: Record<ApprovalStageLiteral, AdminRoleLiteral[]> = {
  [ApprovalStageEnum.MANAGER]: [
    AdminRoleEnum.MANAGER,
    AdminRoleEnum.ANALYST,
    AdminRoleEnum.CFO,
    AdminRoleEnum.SUPER,
  ],
  [ApprovalStageEnum.FINANCE]: [AdminRoleEnum.CFO, AdminRoleEnum.SUPER, AdminRoleEnum.FINANCE],
};

function canActOnStage(role: AdminRoleLiteral, stage: ApprovalStageLiteral): boolean {
  const roles = stageRoleMap[stage] ?? [];
  return roles.includes(role);
}

function serializeApproval(approval: {
  status: ApprovalStatusLiteral;
  decidedBy: string | null;
  decidedAt: Date | null;
  note: string | null;
}) {
  return {
    status: approval.status,
    decidedBy: approval.decidedBy,
    decidedAt: approval.decidedAt ? approval.decidedAt.toISOString() : null,
    note: approval.note,
  };
}

function serializeReport(report: Prisma.ReportGetPayload<{ include: { approvals: true; expenses: true } }>) {
  const managerApproval = report.approvals.find((approval) => approval.stage === ApprovalStageEnum.MANAGER) ?? null;
  const financeApproval = report.approvals.find((approval) => approval.stage === ApprovalStageEnum.FINANCE) ?? null;

  return {
    reportId: report.reportId,
    employeeEmail: report.employeeEmail,
    finalizedAt: report.finalizedAt.toISOString(),
    status: report.status,
    managerEmail: report.managerEmail,
    header: report.header,
    totals: report.totals,
    approvals: {
      manager: managerApproval ? serializeApproval(managerApproval) : null,
      finance: financeApproval ? serializeApproval(financeApproval) : null,
    },
    expenses: report.expenses
      .slice()
      .sort((a, b) => {
        const aTime = a.incurredAt ? a.incurredAt.getTime() : 0;
        const bTime = b.incurredAt ? b.incurredAt.getTime() : 0;
        return aTime - bTime;
      })
      .map((expense) => ({
        id: expense.id,
        category: expense.category,
        description: expense.description,
        amount: expense.amount.toString(),
        currency: expense.currency,
        incurredAt: expense.incurredAt ? expense.incurredAt.toISOString() : null,
      })),
  };
}

router.get('/', requireAdmin(adminApprovalRoles), async (req, res, next) => {
  let parsed: { stage: ApprovalStageLiteral; status: 'pending' | 'approved' | 'rejected' };
  try {
    parsed = approvalQuerySchema.parse(req.query);
  } catch (error) {
    return res.status(400).json({ message: 'Invalid query parameters.' });
  }

  const user = req.adminUser;
  if (!user || !canActOnStage(user.role, parsed.stage)) {
    return res.status(403).json({ message: 'Insufficient role for this stage.' });
  }

  const statusMap: Record<typeof parsed.status, ApprovalStatusLiteral> = {
    pending: ApprovalStatusEnum.PENDING,
    approved: ApprovalStatusEnum.APPROVED,
    rejected: ApprovalStatusEnum.REJECTED,
  };

  const where: Prisma.ReportWhereInput = {
    approvals: {
      some: {
        stage: parsed.stage,
        status: statusMap[parsed.status],
      },
    },
  };

  if (parsed.stage === ApprovalStageEnum.MANAGER) {
    if (parsed.status === 'pending') {
      where.status = ReportStatusEnum.SUBMITTED;
    } else if (parsed.status === 'approved') {
      where.status = ReportStatusEnum.MANAGER_APPROVED;
    } else if (parsed.status === 'rejected') {
      where.status = ReportStatusEnum.REJECTED;
    }
  } else if (parsed.stage === ApprovalStageEnum.FINANCE) {
    if (parsed.status === 'pending') {
      where.status = ReportStatusEnum.MANAGER_APPROVED;
    } else if (parsed.status === 'approved') {
      where.status = ReportStatusEnum.FINANCE_APPROVED;
    } else if (parsed.status === 'rejected') {
      where.status = ReportStatusEnum.REJECTED;
    }
  }

  try {
    const reports = await prisma.report.findMany({
      where,
      include: {
        approvals: true,
        expenses: {
          orderBy: { incurredAt: 'asc' },
        },
      },
      orderBy: { finalizedAt: 'asc' },
    });

    return res.json({ reports: reports.map(serializeReport) });
  } catch (error) {
    return next(error);
  }
});

router.post('/:reportId/decision', requireAdmin(adminApprovalRoles), async (req, res, next) => {
  const { reportId } = req.params;

  if (!reportId) {
    return res.status(400).json({ message: 'Report identifier is required.' });
  }

  const parsed = decisionSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({ message: 'Invalid decision payload.', issues: parsed.error.flatten() });
  }

  const user = req.adminUser;
  if (!user || !canActOnStage(user.role, parsed.data.stage)) {
    return res.status(403).json({ message: 'Insufficient role for this stage.' });
  }

  const note = parsed.data.note && parsed.data.note.length > 0 ? parsed.data.note : undefined;

  try {
    const updatedReport = await prisma.$transaction(async (tx) => {
      const approval = await tx.reportApproval.findUnique({
        where: {
          reportId_stage: {
            reportId,
            stage: parsed.data.stage,
          },
        },
        include: {
          report: {
            include: {
              approvals: true,
              expenses: {
                orderBy: { incurredAt: 'asc' },
              },
            },
          },
        },
      });

      if (!approval || !approval.report) {
        return null;
      }

      if (approval.status !== ApprovalStatusEnum.PENDING) {
        throw Object.assign(new Error('Approval already decided.'), { statusCode: 409 });
      }

      if (parsed.data.stage === ApprovalStageEnum.FINANCE) {
        const managerApproval = approval.report.approvals.find(
          (item) => item.stage === ApprovalStageEnum.MANAGER,
        );
        if (!managerApproval || managerApproval.status !== ApprovalStatusEnum.APPROVED) {
          throw Object.assign(new Error('Manager approval required before finance review.'), { statusCode: 409 });
        }
      }

      const nextApprovalStatus =
        parsed.data.action === 'approve' ? ApprovalStatusEnum.APPROVED : ApprovalStatusEnum.REJECTED;
      const nextReportStatus = (() => {
        if (parsed.data.action !== 'approve') {
          return ReportStatusEnum.REJECTED;
        }
        return parsed.data.stage === ApprovalStageEnum.MANAGER
          ? ReportStatusEnum.MANAGER_APPROVED
          : ReportStatusEnum.FINANCE_APPROVED;
      })();

      await tx.reportApproval.update({
        where: {
          reportId_stage: {
            reportId,
            stage: parsed.data.stage,
          },
        },
        data: {
          status: nextApprovalStatus,
          decidedBy: user.username,
          decidedAt: new Date(),
          note: note ?? null,
        },
      });

      if (parsed.data.stage === ApprovalStageEnum.MANAGER) {
        await tx.reportApproval
          .update({
            where: {
              reportId_stage: {
                reportId,
                stage: ApprovalStageEnum.FINANCE,
              },
            },
            data: {
              status: ApprovalStatusEnum.PENDING,
              decidedAt: null,
              decidedBy: null,
              note: null,
            },
          })
          .catch(() => Promise.resolve(null));
      }

      await tx.report.update({
        where: { reportId },
        data: {
          status: nextReportStatus,
        },
      });

      const refreshed = await tx.report.findUnique({
        where: { reportId },
        include: {
          approvals: true,
          expenses: {
            orderBy: { incurredAt: 'asc' },
          },
        },
      });

      return refreshed;
    });

    if (!updatedReport) {
      return res.status(404).json({ message: 'Report not found.' });
    }

    return res.json({ report: serializeReport(updatedReport) });
  } catch (error) {
    if (error instanceof Error && (error as { statusCode?: number }).statusCode) {
      const statusCode = (error as { statusCode?: number }).statusCode ?? 500;
      return res.status(statusCode).json({ message: error.message });
    }

    return next(error);
  }
});

export default router;
