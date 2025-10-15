import { Router } from 'express';
import { Decimal } from '@prisma/client/runtime/library.js';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { requireAdmin, adminFinanceRoles } from '../middleware/adminAuth.js';
import { lookupCategoryAccount } from '../lib/categoryAccounts.js';
import { ReportStatusEnum } from '../lib/prismaEnums.js';

const router = Router();

const querySchema = z
  .object({
    start: z.string().min(1),
    end: z.string().min(1),
    employees: z.union([z.string(), z.array(z.string())]).optional(),
  })
  .transform((value) => {
    const startDate = new Date(value.start);
    const endDate = new Date(value.end);

    if (Number.isNaN(startDate.getTime())) {
      throw new Error('Invalid start date');
    }

    if (Number.isNaN(endDate.getTime())) {
      throw new Error('Invalid end date');
    }

    const employeesRaw = value.employees;
    const employees = Array.isArray(employeesRaw)
      ? employeesRaw
      : typeof employeesRaw === 'string'
      ? employeesRaw.split(',')
      : [];

    const normalizedEmployees = employees
      .map((employee) => employee.trim().toLowerCase())
      .filter(Boolean);

    return {
      start: startDate,
      end: endDate,
      employees: normalizedEmployees.length > 0 ? normalizedEmployees : undefined,
    };
  });

const ZERO = new Decimal(0);

type DecimalLike = Decimal | number | string | bigint | { toString(): string };

function toDecimal(value: DecimalLike): Decimal {
  if (value instanceof Decimal) {
    return value;
  }

  return new Decimal(value);
}

function addDecimal(a: Decimal, b: DecimalLike): Decimal {
  return a.add(toDecimal(b));
}

function decimalToCurrency(decimal: Decimal): string {
  return decimal.toFixed(2);
}

router.get('/', requireAdmin(adminFinanceRoles), async (req, res, next) => {
  let parsed: z.infer<typeof querySchema>;
  try {
    parsed = querySchema.parse(req.query);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid query';
    return res.status(400).json({ message });
  }

  if (parsed.start > parsed.end) {
    return res.status(400).json({ message: 'Start date must be before or equal to end date' });
  }

  try {
    const expenses = await prisma.expense.findMany({
      where: {
        report: {
          finalizedAt: {
            gte: parsed.start,
            lte: parsed.end,
          },
          status: ReportStatusEnum.FINANCE_APPROVED,
          ...(parsed.employees
            ? {
                employeeEmail: {
                  in: parsed.employees,
                },
              }
            : {}),
        },
      },
      include: {
        report: true,
      },
      orderBy: [
        { report: { employeeEmail: 'asc' } },
        { incurredAt: 'asc' },
        { createdAt: 'asc' },
      ],
    });

    const employees = new Map<
      string,
      {
        reportIds: Set<string>;
        totalsByCurrency: Map<string, Decimal>;
        accounts: Map<
          string,
          {
            info: ReturnType<typeof lookupCategoryAccount>;
            totalsByCurrency: Map<string, Decimal>;
            expenseCount: number;
            expenses: Array<{
              expenseId: string;
              reportId: string;
              amount: string;
              currency: string;
              incurredAt: string | null;
              description: string | null;
            }>;
            categories: Map<string, Decimal>;
          }
        >;
      }
    >();
    const totalsByCurrency = new Map<string, Decimal>();
    const unmappedCategories = new Set<string>();

    for (const expense of expenses) {
      const employeeEmail = expense.report.employeeEmail.toLowerCase();
      const currency = (expense.currency ?? 'USD').toUpperCase();
      const amountDecimal = toDecimal(expense.amount);
      const reportId = expense.report.reportId;
      const categoryKey = expense.category.trim().toLowerCase();

      const employee = employees.get(employeeEmail) ?? {
        reportIds: new Set<string>(),
        totalsByCurrency: new Map<string, Decimal>(),
        accounts: new Map(),
      };

      employees.set(employeeEmail, employee);
      employee.reportIds.add(reportId);
      employee.totalsByCurrency.set(currency, addDecimal(employee.totalsByCurrency.get(currency) ?? ZERO, amountDecimal));

      totalsByCurrency.set(currency, addDecimal(totalsByCurrency.get(currency) ?? ZERO, amountDecimal));

      const accountInfo = lookupCategoryAccount(categoryKey);
      if (!accountInfo) {
        unmappedCategories.add(categoryKey);
      }

      const accountKey = accountInfo?.account ?? `unmapped:${categoryKey}`;
      const accountSummary = employee.accounts.get(accountKey) ?? {
        info: accountInfo,
        totalsByCurrency: new Map<string, Decimal>(),
        expenseCount: 0,
        expenses: [],
        categories: new Map<string, Decimal>(),
      };

      employee.accounts.set(accountKey, accountSummary);
      accountSummary.expenseCount += 1;
      accountSummary.totalsByCurrency.set(
        currency,
        addDecimal(accountSummary.totalsByCurrency.get(currency) ?? ZERO, amountDecimal)
      );
      accountSummary.categories.set(
        categoryKey,
        addDecimal(accountSummary.categories.get(categoryKey) ?? ZERO, amountDecimal)
      );
      accountSummary.expenses.push({
        expenseId: expense.id,
        reportId,
        amount: decimalToCurrency(amountDecimal),
        currency,
        incurredAt: expense.incurredAt ? expense.incurredAt.toISOString() : null,
        description: expense.description ?? null,
      });
    }

    const responseBody = {
      start: parsed.start.toISOString(),
      end: parsed.end.toISOString(),
      generatedAt: new Date().toISOString(),
      totalsByCurrency: Object.fromEntries(
        Array.from(totalsByCurrency.entries()).map(([currency, total]) => [currency, decimalToCurrency(total)])
      ),
      employees: Array.from(employees.entries())
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([employeeEmail, summary]) => ({
          employeeEmail,
          reportIds: Array.from(summary.reportIds).sort(),
          totalsByCurrency: Object.fromEntries(
            Array.from(summary.totalsByCurrency.entries()).map(([currency, total]) => [currency, decimalToCurrency(total)])
          ),
          accounts: Array.from(summary.accounts.entries())
            .sort(([aKey, aSummary], [bKey, bSummary]) => {
              const aAccount = aSummary.info?.account ?? aKey;
              const bAccount = bSummary.info?.account ?? bKey;
              return aAccount.localeCompare(bAccount);
            })
            .map(([, accountSummary]) => ({
              account: accountSummary.info?.account ?? null,
              label: accountSummary.info?.label ?? 'Unmapped category',
              totalsByCurrency: Object.fromEntries(
                Array.from(accountSummary.totalsByCurrency.entries()).map(([currency, total]) => [
                  currency,
                  decimalToCurrency(total),
                ])
              ),
              categories: Array.from(accountSummary.categories.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([category, total]) => ({
                  category,
                  total: decimalToCurrency(total),
                })),
              expenseCount: accountSummary.expenseCount,
              expenses: accountSummary.expenses,
            })),
        })),
      unmappedCategories: Array.from(unmappedCategories.values()).sort(),
    } as const;

    return res.json(responseBody);
  } catch (error) {
    return next(error);
  }
});

export default router;
