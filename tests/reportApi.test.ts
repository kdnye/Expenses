import request from 'supertest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const reportCreate = vi.fn();
const expenseCreateMany = vi.fn();
const receiptFindMany = vi.fn();
const expenseFindMany = vi.fn();
const receiptUpdate = vi.fn();
const transactionMock = vi.fn();

vi.mock('../server/src/lib/prisma.js', () => ({
  prisma: {
    $transaction: transactionMock,
  },
}));

const importApp = async () => {
  const module = await import('../server/src/app.ts');
  return module.default;
};

describe('report submission', () => {
  beforeEach(() => {
    process.env.API_KEY = 'report-key';
    reportCreate.mockReset();
    expenseCreateMany.mockReset();
    receiptFindMany.mockReset();
    expenseFindMany.mockReset();
    receiptUpdate.mockReset();

    transactionMock.mockImplementation(async (callback) => {
      return callback({
        report: { create: reportCreate },
        expense: { createMany: expenseCreateMany, findMany: expenseFindMany },
        receipt: { findMany: receiptFindMany, update: receiptUpdate },
      });
    });
  });

  it('links uploaded receipts to newly created expenses', async () => {
    const app = await importApp();

    receiptFindMany.mockResolvedValue([
      {
        id: 'rcpt-1',
        clientExpenseId: 'exp-1',
        expenseId: null,
      },
    ]);

    expenseFindMany.mockResolvedValue([
      { id: 'db-exp-1', externalId: 'exp-1' },
    ]);

    const payload = {
      reportId: 'rep-1',
      employeeEmail: 'user@example.com',
      finalizedAt: new Date('2024-03-05T00:00:00Z').toISOString(),
      header: { name: 'User Example' },
      totals: { submitted: 10 },
      period: { year: 2024, month: 3, week: 10 },
      expenses: [
        {
          expenseId: 'exp-1',
          category: 'travel',
          description: 'Taxi',
          amount: 10,
          currency: 'USD',
          incurredAt: new Date('2024-03-04T00:00:00Z').toISOString(),
          metadata: { payment: 'personal' },
        },
      ],
    };

    const response = await request(app)
      .post('/api/reports')
      .set('x-api-key', 'report-key')
      .send(payload);

    expect(response.status).toBe(201);
    expect(reportCreate).toHaveBeenCalled();
    expect(expenseCreateMany).toHaveBeenCalledWith({ data: expect.any(Array) });
    expect(receiptFindMany).toHaveBeenCalledWith({
      where: { reportId: 'rep-1' },
      select: { id: true, clientExpenseId: true, expenseId: true },
    });
    expect(expenseFindMany).toHaveBeenCalledWith({
      where: { reportId: 'rep-1' },
      select: { id: true, externalId: true },
    });
    expect(receiptUpdate).toHaveBeenCalledWith({
      where: { id: 'rcpt-1' },
      data: { expenseId: 'db-exp-1' },
    });
  });
});
