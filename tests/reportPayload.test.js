import { describe, expect, it } from 'vitest';
import buildReportPayload, { calculateTotals } from '../src/reportPayload.js';

const sampleState = {
  header: {
    name: 'Jamie Freight',
    department: 'Logistics',
    focus: 'Mileage & supplies',
    purpose: 'Client onboarding trip',
    je: '4455',
    dates: 'May 1-7 2024',
    tripLength: 6,
    email: ' jamie.freight@example.com ',
  },
  expenses: [
    {
      id: 'exp-1',
      date: '2024-05-01',
      type: 'mileage',
      account: '64190',
      description: 'Mileage reimbursement',
      payment: 'personal',
      amount: 120,
      reimbursable: 120,
      policy: 'mileage',
      miles: 183.2,
      messages: [],
      receipts: [
        {
          id: 'rec-1',
          fileName: 'mileage.pdf',
          contentType: 'application/pdf',
          fileSize: 20480,
          storageKey: 'reports/draft-123/exp-1/rec-1.pdf',
          downloadUrl: 'https://example.com/receipts/rec-1',
        },
      ],
    },
    {
      id: 'exp-2',
      date: '2024-05-02',
      type: 'travel_ga',
      account: '64190',
      description: 'Hotel stay',
      payment: 'company',
      amount: 340,
      reimbursable: 340,
      policy: 'travel',
      travelCategory: 'lodging',
      travelClass: 'coach',
      flightHours: '',
      messages: [],
    },
  ],
  history: [],
  meta: {
    draftId: 'draft-123',
    lastSavedMode: 'draft',
    lastSavedAt: null,
  },
};

describe('calculateTotals', () => {
  it('separates employee and company reimbursements', () => {
    const totals = calculateTotals(sampleState.expenses);
    expect(totals).toEqual({
      submitted: 460,
      employee: 120,
      company: 340,
    });
  });
});

describe('buildReportPayload', () => {
  it('serializes header, totals, period, and expenses for submission', () => {
    const state = JSON.parse(JSON.stringify(sampleState));
    const payload = buildReportPayload(state, {
      reportId: 'draft-123',
      finalizedAt: new Date('2024-05-20T14:32:00Z'),
    });

    expect(payload.reportId).toBe('draft-123');
    expect(payload.employeeEmail).toBe('jamie.freight@example.com');
    expect(payload.totals).toEqual({ submitted: 460, employee: 120, company: 340 });
    expect(payload.period).toEqual({ year: 2024, month: 5, week: 21 });

    const [firstExpense] = payload.expenses;
    expect(firstExpense).toMatchObject({
      expenseId: 'exp-1',
      category: '64190',
      amount: 120,
      currency: 'USD',
    });
    expect(firstExpense.incurredAt).toMatch(/^2024-05-01/);
    expect(firstExpense.metadata).toMatchObject({ payment: 'personal', policy: 'mileage' });
    expect(firstExpense.metadata.receipts).toEqual([
      {
        id: 'rec-1',
        fileName: 'mileage.pdf',
        contentType: 'application/pdf',
        fileSize: 20480,
        storageProvider: undefined,
        storageBucket: undefined,
        storageKey: 'reports/draft-123/exp-1/rec-1.pdf',
        storageUrl: undefined,
        downloadUrl: 'https://example.com/receipts/rec-1',
        uploadedAt: undefined,
      },
    ]);
  });

  it('throws when email is missing', () => {
    const withoutEmail = JSON.parse(JSON.stringify(sampleState));
    withoutEmail.header.email = '';

    expect(() =>
      buildReportPayload(withoutEmail, { reportId: 'draft-123', finalizedAt: new Date() }),
    ).toThrow(/email/i);
  });
});
