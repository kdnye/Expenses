import { parseNumber } from './utils.js';

const ISO_CURRENCY = 'USD';

const toIsoDate = (value) => {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    // Try to coerce YYYY-MM-DD strings explicitly to avoid timezone drift.
    const normalized = new Date(`${value}T00:00:00Z`);
    if (Number.isNaN(normalized.getTime())) return undefined;
    return normalized.toISOString();
  }
  return date.toISOString();
};

const getIsoWeek = (date) => {
  const tmp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNumber = tmp.getUTCDay() || 7;
  tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
  const diff = tmp - yearStart;
  return Math.ceil((diff / 86400000 + 1) / 7);
};

export const calculateTotals = (expenses = []) => {
  return expenses.reduce(
    (acc, expense) => {
      const amount = parseNumber(expense.amount);
      const reimb = parseNumber(expense.reimbursable);
      acc.submitted += amount;
      if (expense.payment === 'company') {
        acc.company += reimb;
      } else {
        acc.employee += reimb;
      }
      return acc;
    },
    { submitted: 0, employee: 0, company: 0 },
  );
};

const buildExpenseMetadata = (expense) => {
  const metadata = {
    payment: expense.payment,
    policy: expense.policy,
    reimbursable: parseNumber(expense.reimbursable),
    account: expense.account,
  };

  if (expense.policy === 'meal') {
    metadata.mealType = expense.mealType;
    metadata.receiptProvided = expense.hasReceipt !== false;
  }

  if (expense.policy === 'mileage') {
    metadata.miles = parseNumber(expense.miles);
    const miles = parseNumber(expense.miles);
    const amount = parseNumber(expense.amount);
    const rate = miles ? amount / miles : undefined;
    metadata.irsRate = Number.isFinite(rate) ? rate : undefined;
  }

  if (expense.policy === 'travel') {
    metadata.travelCategory = expense.travelCategory;
    metadata.travelClass = expense.travelClass;
    metadata.flightHours = expense.flightHours;
  }

  if (Array.isArray(expense.messages) && expense.messages.length) {
    metadata.policyMessages = expense.messages.map((msg) => msg.text);
  }

  const receipts = Array.isArray(expense.receipts)
    ? expense.receipts
        .map((receipt) => {
          if (!receipt) return null;
          return {
            id: receipt.id,
            fileName: receipt.fileName,
            contentType: receipt.contentType,
            fileSize: receipt.fileSize,
            storageProvider: receipt.storageProvider,
            storageBucket: receipt.storageBucket,
            storageKey: receipt.storageKey,
            storageUrl: receipt.storageUrl,
            downloadUrl: receipt.downloadUrl,
            uploadedAt: receipt.uploadedAt,
          };
        })
        .filter(Boolean)
    : [];

  if (receipts.length) {
    metadata.receipts = receipts;
  }

  return metadata;
};

const sanitizeHeader = (header = {}) => {
  const cleaned = { ...header };
  if (cleaned.email) {
    cleaned.email = cleaned.email.trim();
  }
  if (cleaned.managerEmail) {
    cleaned.managerEmail = cleaned.managerEmail.trim().toLowerCase();
  }
  return cleaned;
};

export const buildReportPayload = (state, { reportId, finalizedAt }) => {
  if (!state) throw new Error('State is required to build the report payload.');
  const email = state.header?.email?.trim();
  if (!email) {
    throw new Error('Employee email is required before submitting.');
  }

  const managerEmail = state.header?.managerEmail?.trim();
  if (!managerEmail) {
    throw new Error('Manager email is required before submitting.');
  }

  if (!managerEmail.includes('@') || !managerEmail.includes('.')) {
    throw new Error('Enter a valid manager email before submitting.');
  }

  if (!reportId) {
    throw new Error('A report identifier is required to submit.');
  }

  const finalizedDate = finalizedAt instanceof Date ? finalizedAt : new Date(finalizedAt);
  if (Number.isNaN(finalizedDate.getTime())) {
    throw new Error('A valid submission date is required.');
  }

  const normalizedExpenses = (state.expenses || [])
    .map((expense) => ({
      ...expense,
      amount: parseNumber(expense.amount),
      reimbursable: parseNumber(expense.reimbursable),
    }))
    .filter((expense) => expense.amount > 0 || expense.reimbursable > 0);

  if (!normalizedExpenses.length) {
    throw new Error('At least one expense is required before submitting.');
  }

  const expensesPayload = normalizedExpenses.map((expense) => {
    const incurredAt = expense.date ? toIsoDate(expense.date) : undefined;
    return {
      expenseId: expense.id,
      category: expense.account || expense.type,
      description: expense.description || undefined,
      amount: expense.amount,
      currency: ISO_CURRENCY,
      incurredAt,
      metadata: buildExpenseMetadata(expense),
    };
  });

  const totals = calculateTotals(normalizedExpenses);
  const period = {
    year: finalizedDate.getUTCFullYear(),
    month: finalizedDate.getUTCMonth() + 1,
    week: getIsoWeek(finalizedDate),
  };

  const header = sanitizeHeader(state.header);

  return {
    reportId,
    employeeEmail: email,
    finalizedAt: finalizedDate.toISOString(),
    header,
    totals,
    period,
    expenses: expensesPayload,
  };
};

export default buildReportPayload;
