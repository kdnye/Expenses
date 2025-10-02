import { Router } from 'express';
import { ApprovalStage, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { authenticate } from '../middleware/authenticate.js';
import { reportSchema } from '../validators/reportSchema.js';

const router = Router();

router.post('/', authenticate, async (req, res, next) => {
  const parsed = reportSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      message: 'Invalid report payload',
      issues: parsed.error.flatten()
    });
  }

  const data = parsed.data;

  const rawHeader = (data.header ?? {}) as Record<string, unknown>;
  const managerEmailValue = typeof rawHeader.managerEmail === 'string' ? rawHeader.managerEmail : '';
  const managerEmail = managerEmailValue.trim().toLowerCase();

  if (!managerEmail) {
    return res.status(400).json({ message: 'Manager email is required for approvals.' });
  }

  const normalizedHeader = {
    ...rawHeader,
    managerEmail
  };

  const reportData: Prisma.ReportCreateInput = {
    reportId: data.reportId,
    employeeEmail: data.employeeEmail.toLowerCase(),
    finalizedAt: data.finalizedAt,
    finalizedYear: data.period.year,
    finalizedMonth: data.period.month,
    finalizedWeek: data.period.week,
    managerEmail,
    header: normalizedHeader as Prisma.InputJsonValue,
    ...(data.totals
      ? { totals: data.totals as Prisma.InputJsonValue }
      : {})
  };

  const expensesData: Prisma.ExpenseCreateManyInput[] = data.expenses.map((expense) => ({
    reportId: data.reportId,
    externalId: expense.expenseId ?? null,
    category: expense.category,
    description: expense.description ?? null,
    amount: typeof expense.amount === 'number'
      ? expense.amount.toString()
      : expense.amount,
    currency: expense.currency,
    incurredAt: expense.incurredAt ?? null,
    ...(expense.metadata
      ? { metadata: expense.metadata as Prisma.InputJsonValue }
      : { metadata: Prisma.JsonNull })
  }));

  try {
    await prisma.$transaction(async (tx) => {
      await tx.report.create({ data: reportData });
      await tx.expense.createMany({ data: expensesData });
      await tx.reportApproval.createMany({
        data: [
          { reportId: data.reportId, stage: ApprovalStage.MANAGER },
          { reportId: data.reportId, stage: ApprovalStage.FINANCE }
        ]
      });

      const receipts = await tx.receipt.findMany({
        where: { reportId: data.reportId },
        select: { id: true, clientExpenseId: true, expenseId: true },
      });

      if (receipts.length) {
        const expenses = await tx.expense.findMany({
          where: { reportId: data.reportId },
          select: { id: true, externalId: true },
        });

        const expenseMap = new Map(
          expenses
            .filter((expense) => expense.externalId)
            .map((expense) => [expense.externalId as string, expense.id])
        );

        await Promise.all(
          receipts.map((receipt) => {
            if (!receipt.clientExpenseId) {
              return Promise.resolve(null);
            }

            const expenseId = expenseMap.get(receipt.clientExpenseId);
            if (!expenseId || receipt.expenseId === expenseId) {
              return Promise.resolve(null);
            }

            return tx.receipt.update({
              where: { id: receipt.id },
              data: { expenseId },
            });
          })
        );
      }
    });

    return res.status(201).json({
      message: 'Report stored',
      reportId: data.reportId,
      expenseCount: expensesData.length
    });
  } catch (error) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return res.status(409).json({
        message: 'Report already exists',
        code: 'REPORT_EXISTS'
      });
    }

    return next(error);
  }
});

export default router;
