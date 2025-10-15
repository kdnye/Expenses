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
    managerEmail: 'manager@example.com',
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

  it('handles empty and malformed expense values gracefully', () => {
    const totals = calculateTotals([
      { amount: '10.50', reimbursable: '10.50', payment: 'personal' },
      { amount: '', reimbursable: null, payment: 'company' },
      { amount: undefined, reimbursable: undefined, payment: 'company' },
      { amount: 'not-a-number', reimbursable: 'still-not', payment: 'personal' },
    ]);

    expect(totals).toEqual({
      submitted: 10.5,
      employee: 10.5,
      company: 0,
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

  it('includes rich metadata for various policies and filters empty expenses', () => {
    const payload = buildReportPayload(
      {
        header: {
          ...sampleState.header,
          email: '  someone@example.com  ',
        },
        expenses: [
          {
            id: 'meal-1',
            date: '2024-05-02',
            type: 'meals_ga',
            account: '64180',
            description: 'Team dinner',
            payment: 'personal',
            amount: 48,
            reimbursable: 48,
            policy: 'meal',
            mealType: 'dinner',
            hasReceipt: false,
            messages: [{ text: 'Needs manager approval' }],
            receipts: [
              {
                id: 'receipt-1',
                fileName: 'dinner.jpg',
                contentType: 'image/jpeg',
                fileSize: 1024,
                downloadUrl: 'https://example.com/receipts/dinner',
                uploadedAt: '2024-05-03T18:30:00Z',
              },
            ],
          },
          {
            id: 'mileage-1',
            date: '2024-05-03',
            type: 'mileage',
            account: '64190',
            description: 'Client visit',
            payment: 'personal',
            amount: 32.5,
            reimbursable: 32.5,
            policy: 'mileage',
            miles: 50,
          },
          {
            id: 'travel-1',
            date: '2024-05-04',
            type: 'travel_ga',
            account: '64190',
            description: 'Hotel stay',
            payment: 'company',
            amount: 220,
            reimbursable: 220,
            policy: 'travel',
            travelCategory: 'lodging',
            travelClass: 'coach',
            flightHours: 2,
          },
          {
            id: 'ignore-me',
            date: '2024-05-05',
            type: 'office_supplies',
            amount: 0,
            reimbursable: 0,
            payment: 'personal',
            policy: 'default',
          },
        ],
        history: [],
        meta: sampleState.meta,
      },
      { reportId: 'rep-987', finalizedAt: '2024-05-10T12:00:00Z' },
    );

    expect(payload.reportId).toBe('rep-987');
    expect(payload.employeeEmail).toBe('someone@example.com');
    expect(payload.header.email).toBe('someone@example.com');
    expect(payload.expenses).toHaveLength(3);

    const [mealExpense, mileageExpense, travelExpense] = payload.expenses;

    expect(mealExpense.metadata).toMatchObject({
      payment: 'personal',
      policy: 'meal',
      mealType: 'dinner',
      receiptProvided: false,
      policyMessages: ['Needs manager approval'],
      reimbursable: 48,
    });
    expect(mealExpense.metadata.receipts).toEqual([
      {
        id: 'receipt-1',
        fileName: 'dinner.jpg',
        contentType: 'image/jpeg',
        fileSize: 1024,
        storageProvider: undefined,
        storageBucket: undefined,
        storageKey: undefined,
        storageUrl: undefined,
        downloadUrl: 'https://example.com/receipts/dinner',
        uploadedAt: '2024-05-03T18:30:00Z',
      },
    ]);
    expect(mealExpense.incurredAt).toMatch(/^2024-05-02/);

    expect(mileageExpense.metadata).toMatchObject({
      policy: 'mileage',
      miles: 50,
      irsRate: 0.65,
    });

    expect(travelExpense.metadata).toMatchObject({
      policy: 'travel',
      travelCategory: 'lodging',
      travelClass: 'coach',
      flightHours: 2,
    });

    expect(payload.totals).toEqual({
      submitted: 300.5,
      employee: 80.5,
      company: 220,
    });

    expect(payload.period).toEqual({ year: 2024, month: 5, week: 19 });
  });

  it('throws when submission date is invalid', () => {
    expect(() =>
      buildReportPayload(sampleState, { reportId: 'rep-111', finalizedAt: 'not-a-date' }),
    ).toThrow(/valid submission date/i);
  });
});
