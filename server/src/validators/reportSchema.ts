import { z } from 'zod';

const expenseSchema = z.object({
  expenseId: z.string().min(1).optional(),
  category: z.string().min(1),
  description: z.string().min(1).optional(),
  amount: z.union([z.number(), z.string()]),
  currency: z.string().min(1),
  incurredAt: z.coerce.date().optional(),
  metadata: z.record(z.unknown()).optional()
});

const totalsSchema = z.record(z.string(), z.number().or(z.string()));

export const reportSchema = z.object({
  reportId: z.string().min(1),
  employeeEmail: z.string().email(),
  finalizedAt: z.coerce.date(),
  header: z.record(z.unknown()).optional(),
  totals: totalsSchema.optional(),
  period: z.object({
    year: z.number().int(),
    month: z.number().int().min(1).max(12),
    week: z.number().int().min(1).max(53)
  }),
  expenses: z.array(expenseSchema).min(1)
});

export type ReportPayload = z.infer<typeof reportSchema>;
export type ExpensePayload = z.infer<typeof expenseSchema>;
