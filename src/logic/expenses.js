import { EXPENSE_TYPES, IRS_RATE, MEAL_LIMITS } from '../constants.js';
import { fmtCurrency, parseNumber, uuid } from '../utils.js';

export const findExpenseType = (value) =>
  EXPENSE_TYPES.find((type) => type.value === value) ?? EXPENSE_TYPES[0];

export const ensureReceipts = (expense) => {
  if (!Array.isArray(expense.receipts)) {
    return { ...expense, receipts: [] };
  }
  return expense;
};

export const createExpense = (overrides = {}) => {
  const baseType = findExpenseType(overrides.type ?? EXPENSE_TYPES[0].value);
  const initial = {
    id: uuid(),
    date: '',
    type: baseType.value,
    account: baseType.account,
    description: '',
    payment: 'personal',
    amount: 0,
    reimbursable: 0,
    hasReceipt: true,
    mealType: 'dinner',
    miles: 0,
    travelCategory: baseType.travelDefault ?? 'air_domestic',
    travelClass: 'coach',
    flightHours: '',
    receipts: [],
    policy: baseType.policy,
    messages: [],
    ...overrides,
  };

  return applyPolicyDefaults(initial, overrides.type); // ensure derived fields align with type overrides
};

export const applyPolicyDefaults = (expense, nextType) => {
  const typeMeta = findExpenseType(nextType ?? expense.type);
  const policy = typeMeta.policy;

  const next = {
    ...expense,
    type: typeMeta.value,
    account: typeMeta.account,
    policy,
  };

  if (!Array.isArray(next.receipts)) {
    next.receipts = [];
  }

  if (policy !== 'meal' && !next.mealType) {
    next.mealType = 'dinner';
  }

  if (policy === 'travel') {
    next.travelCategory = next.travelCategory || typeMeta.travelDefault || 'air_domestic';
    next.travelClass = next.travelClass || 'coach';
  } else {
    next.travelCategory = next.travelCategory || 'air_domestic';
    next.travelClass = next.travelClass || 'coach';
  }

  if (policy === 'mileage') {
    next.miles = parseNumber(next.miles);
    next.amount = next.miles * IRS_RATE;
  }

  return next;
};

const withMileageAmount = (expense) => {
  if (expense.policy !== 'mileage') {
    return expense;
  }

  const miles = parseNumber(expense.miles);
  const amount = miles * IRS_RATE;
  return {
    ...expense,
    miles,
    amount,
  };
};

const evaluateMealExpense = (expense) => {
  if (expense.policy !== 'meal') {
    return { messages: [], reimbursable: parseNumber(expense.amount) };
  }

  const mealKey = expense.mealType || 'dinner';
  const cap = MEAL_LIMITS[mealKey];
  let reimbursable = parseNumber(expense.amount);
  const messages = [];

  if (expense.hasReceipt === false) {
    if (cap && reimbursable > cap) {
      messages.push({
        type: 'warning',
        text: `No receipt: reimbursement capped at ${fmtCurrency(cap)} for ${mealKey}.`,
      });
    }
    reimbursable = Math.min(reimbursable, cap ?? reimbursable);
  } else if (cap && reimbursable > cap) {
    messages.push({
      type: 'info',
      text: `Above guideline amount (${fmtCurrency(cap)}). Ensure business justification is noted.`,
    });
  }

  return { messages, reimbursable };
};

const evaluateTravelExpense = (expense, header) => {
  if (expense.policy !== 'travel') {
    return { messages: [], reimbursable: parseNumber(expense.amount) };
  }

  const messages = [];
  const reimbursable = parseNumber(expense.amount);
  const category = expense.travelCategory || 'air_domestic';
  const travelClass = expense.travelClass || 'coach';
  const hours = parseNumber(expense.flightHours);

  if (category === 'air_domestic') {
    if (travelClass === 'first') {
      messages.push({ type: 'warning', text: 'First-class airfare is not reimbursable.' });
    } else if (travelClass !== 'coach') {
      messages.push({
        type: 'warning',
        text: 'Domestic airfare should be booked in coach. Upgrades are a personal expense.',
      });
    }
  }

  if (category === 'air_international') {
    if (travelClass === 'first') {
      messages.push({ type: 'warning', text: 'First-class airfare is not reimbursable.' });
    }
    if (travelClass === 'business' && hours < 8) {
      messages.push({
        type: 'warning',
        text: 'Business class allowed only when the published flight time is eight hours or longer.',
      });
    }
    if (!['business', 'coach', 'premium'].includes(travelClass)) {
      messages.push({ type: 'warning', text: 'Select an allowable fare class.' });
    }
  }

  if (category === 'gym' && reimbursable > 15) {
    messages.push({ type: 'warning', text: 'Hotel gym fees should not exceed $15 per day.' });
  }

  if (category === 'laundry') {
    const tripLength = parseNumber(header?.tripLength);
    if (!tripLength || tripLength < 7) {
      messages.push({ type: 'warning', text: 'Laundry reimbursed only for trips exceeding seven full days.' });
    }
  }

  return { messages, reimbursable };
};

export const evaluateExpense = (expense, header) => {
  const prepared = withMileageAmount(applyPolicyDefaults(ensureReceipts(expense)));

  let reimbursable = parseNumber(prepared.amount);
  const messages = [];

  if (prepared.policy === 'meal') {
    const mealEval = evaluateMealExpense(prepared);
    reimbursable = mealEval.reimbursable;
    messages.push(...mealEval.messages);
  } else if (prepared.policy === 'travel') {
    const travelEval = evaluateTravelExpense(prepared, header);
    reimbursable = travelEval.reimbursable;
    messages.push(...travelEval.messages);
  } else if (prepared.policy === 'mileage') {
    const miles = parseNumber(prepared.miles);
    reimbursable = miles * IRS_RATE;
  } else {
    reimbursable = parseNumber(prepared.amount);
  }

  return {
    ...prepared,
    reimbursable,
    messages,
  };
};

export const evaluateAllExpenses = (expenses, header) =>
  expenses.map((expense) => evaluateExpense(expense, header));

export const buildPreview = (state, totals) => {
  const lines = [];
  const header = state.header || {};
  lines.push('Expense report');
  lines.push(`Name: ${header.name || ''}`);
  lines.push(`Email: ${header.email || ''}`);
  lines.push(`Manager email: ${header.managerEmail || ''}`);
  lines.push(`Department: ${header.department || ''}`);
  lines.push(`Expense focus: ${header.focus || ''}`);
  lines.push(`Purpose: ${header.purpose || ''}`);
  lines.push(`JE #: ${header.je || ''}`);
  lines.push(`Dates: ${header.dates || ''}`);
  if (header.tripLength) {
    lines.push(`Trip length: ${header.tripLength} day(s)`);
  }
  lines.push('');
  lines.push('Date | Type | Account | Description | Payment | Amount | Reimbursable');
  lines.push('-----|------|---------|-------------|---------|--------|-------------');

  (state.expenses || []).forEach((expense) => {
    const meta = findExpenseType(expense.type);
    const typeLabel = meta ? meta.label : expense.type;
    const amount = fmtCurrency(parseNumber(expense.amount));
    const reimb = fmtCurrency(parseNumber(expense.reimbursable));

    lines.push(
      [
        expense.date || '',
        typeLabel,
        expense.account || '',
        (expense.description || '').replace(/\s+/g, ' ').trim(),
        expense.payment === 'company' ? 'Company card' : 'Personal',
        amount,
        reimb,
      ].join(' | '),
    );

    if (Array.isArray(expense.messages) && expense.messages.length) {
      expense.messages.forEach((msg) => {
        lines.push(`  - ${msg.type === 'warning' ? '⚠️' : 'ℹ️'} ${msg.text}`);
      });
    }
  });

  const totalsLine = `Totals -> Submitted: ${fmtCurrency(totals.submitted)}, Due to employee: ${fmtCurrency(
    totals.employee,
  )}, Company card: ${fmtCurrency(totals.company)}`;
  lines.push('');
  lines.push(totalsLine);

  return lines.join('\n');
};

export const mergeReceiptMetadata = (expense, uploadedReceipts) => {
  const existing = Array.isArray(expense.receipts) ? expense.receipts : [];
  const map = new Map(existing.map((item) => [item.id || item.storageKey || item.fileName, item]));
  uploadedReceipts.forEach((item) => {
    if (!item) return;
    const key = item.id || item.storageKey || item.fileName;
    map.set(key, { ...map.get(key), ...item });
  });
  return { ...expense, receipts: Array.from(map.values()) };
};
