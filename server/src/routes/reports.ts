import { Router } from 'express';
import { Prisma } from '@prisma/client';
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

  const reportData: Prisma.ReportCreateInput = {
    reportId: data.reportId,
    employeeEmail: data.employeeEmail.toLowerCase(),
    finalizedAt: data.finalizedAt,
    finalizedYear: data.period.year,
    finalizedMonth: data.period.month,
    finalizedWeek: data.period.week,
    ...(data.header
      ? { header: data.header as Prisma.InputJsonValue }
      : {}),
    ...(data.totals
      ? { totals: data.totals as Prisma.InputJsonValue }
      : {})
  };

  const expensesData: Prisma.ExpenseCreateManyInput[] = data.expenses.map(
    (expense) => ({
      reportId: data.reportId,
      externalId: expense.expenseId ?? null,
      category: expense.category,
      description: expense.description ?? null,
      amount: new Prisma.Decimal(expense.amount),
      currency: expense.currency,
      incurredAt: expense.incurredAt ?? null,
      ...(expense.metadata
        ? { metadata: expense.metadata as Prisma.InputJsonValue }
        : { metadata: Prisma.JsonNull })
    })
  );

  try {
    await prisma.$transaction(async (tx) => {
      await tx.report.create({ data: reportData });
      await tx.expense.createMany({ data: expensesData });
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
