import { EXPENSE_TYPES, IRS_RATE, MEAL_LIMITS, headerBindings } from './constants.js';
import { loadState, saveState, createFreshState } from './storage.js';
import buildReportPayload, { calculateTotals } from './reportPayload.js';
import { fmtCurrency, parseNumber, uuid } from './utils.js';
import { buildApiUrl, isOfflineOnly } from './config.js';
import {
  saveReceiptsForExpense,
  getStoredReceipts,
  deleteReceipts,
  clearReceiptsForDraft,
  createObjectUrlForReceipt,
  revokeObjectUrl,
} from './receiptStorage.js';

const state = await loadState();
const expenseRows = new Map();
const offlineOnly = isOfflineOnly();
const SUBMIT_ENDPOINT = buildApiUrl('/api/reports');
const RECEIPT_UPLOAD_ENDPOINT = buildApiUrl('/api/receipts');
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024; // 10 MB limit per file.
const ACCEPTED_RECEIPT_TYPES = new Set(['application/pdf']);
const ACCEPTED_RECEIPT_PREFIXES = ['image/'];
const storedReceiptObjectUrls = new Map();
const pendingReceiptFiles = new Map();
if (state.meta?.storedReceipts) {
  Object.entries(state.meta.storedReceipts).forEach(([expenseId, items]) => {
    if (Array.isArray(items) && items.length) {
      pendingReceiptFiles.set(expenseId, items.map((item) => ({ ...item })));
    }
  });
}
const receiptUploadState = new Map();
let submitting = false;

const syncStoredReceiptMetadata = () => {
  const serialized = {};
  pendingReceiptFiles.forEach((items, expenseId) => {
    if (!Array.isArray(items) || !items.length) return;
    serialized[expenseId] = items.map((item) => ({
      id: item.id,
      fileName: item.fileName,
      fileSize: item.fileSize,
      contentType: item.contentType,
      lastModified: item.lastModified,
    }));
  });
  state.meta.storedReceipts = serialized;
};

const revokeObjectUrlsForExpense = (expenseId) => {
  const metadata = pendingReceiptFiles.get(expenseId) || [];
  metadata.forEach((meta) => {
    const existing = storedReceiptObjectUrls.get(meta.id);
    if (existing) {
      revokeObjectUrl(existing);
      storedReceiptObjectUrls.delete(meta.id);
    }
  });
};

const clearAllReceiptObjectUrls = () => {
  storedReceiptObjectUrls.forEach((url) => revokeObjectUrl(url));
  storedReceiptObjectUrls.clear();
};

const hydrateOfflineReceiptsForExpense = async (expenseId) => {
  if (!offlineOnly) return;
  const metadata = pendingReceiptFiles.get(expenseId);
  if (!metadata?.length) return;
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (!expense) return;

  let receipts;
  try {
    receipts = await getStoredReceipts(state.meta?.draftId, expenseId, metadata.map((item) => item.id));
  } catch (error) {
    console.warn('Unable to load stored receipt blobs for expense', expenseId, error);
    return;
  }

  receipts.forEach(({ metadata: meta, blob }) => {
    let url = storedReceiptObjectUrls.get(meta.id);
    if (!url) {
      url = createObjectUrlForReceipt(blob);
      if (url) {
        storedReceiptObjectUrls.set(meta.id, url);
      }
    }

    const existing = expense.receipts.find((receipt) => receipt.draftReceiptId === meta.id);
    const base = {
      draftReceiptId: meta.id,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      contentType: meta.contentType,
      lastModified: meta.lastModified,
      storageProvider: 'local',
      storageKey: meta.id,
    };

    if (existing) {
      Object.assign(existing, base);
      existing.downloadUrl = url;
    } else {
      expense.receipts.push({ ...base, downloadUrl: url });
    }
  });
};

syncStoredReceiptMetadata();

const hasWindow = typeof window !== 'undefined';
const API_KEY_SESSION_STORAGE_KEY = 'fsi-expense-api-key';
const API_KEY_PERSIST_STORAGE_KEY = 'fsi-expense-api-key-persistent';

const getStorage = (type) => {
  if (!hasWindow) return null;
  try {
    return window[type];
  } catch (error) {
    console.warn(`${type} unavailable for API key persistence`, error);
    return null;
  }
};

const sessionApiKeyStore = getStorage('sessionStorage');
const persistentApiKeyStore = getStorage('localStorage');

const safeStorageGet = (store, key) => {
  if (!store) return '';
  try {
    return store.getItem(key) ?? '';
  } catch (error) {
    console.warn('Unable to read API key from storage', error);
    return '';
  }
};

const safeStorageSet = (store, key, value) => {
  if (!store) return false;
  try {
    store.setItem(key, value);
    return true;
  } catch (error) {
    console.warn('Unable to persist API key', error);
    return false;
  }
};

const safeStorageRemove = (store, key) => {
  if (!store) return true;
  try {
    store.removeItem(key);
    return true;
  } catch (error) {
    console.warn('Unable to clear stored API key', error);
    return false;
  }
};

let apiKey = '';
let rememberApiKey = false;

const loadStoredApiKey = () => {
  const persisted = safeStorageGet(persistentApiKeyStore, API_KEY_PERSIST_STORAGE_KEY);
  if (persisted) {
    rememberApiKey = true;
    return persisted;
  }
  return safeStorageGet(sessionApiKeyStore, API_KEY_SESSION_STORAGE_KEY) || '';
};

apiKey = loadStoredApiKey();

const elements = {
  expensesBody: document.querySelector('#expensesBody'),
  addExpense: document.querySelector('#addExpense'),
  reportPreview: document.querySelector('#reportPreview'),
  copyPreview: document.querySelector('#copyPreview'),
  copyFeedback: document.querySelector('#copyFeedback'),
  submissionFeedback: document.querySelector('#submissionFeedback'),
  finalizeSubmit: document.querySelector('#finalizeSubmit'),
  totalSubmitted: document.querySelector('#totalSubmitted'),
  totalDueEmployee: document.querySelector('#totalDueEmployee'),
  totalCompanyCard: document.querySelector('#totalCompanyCard'),
  apiKeyInput: document.querySelector('#field_api_key'),
  apiKeyRemember: document.querySelector('#field_api_key_remember'),
  apiKeyStatus: document.querySelector('#apiKeyStatus'),
};

const applyOfflineUiDefaults = () => {
  const apiCard = document.getElementById('apiAccessCard');
  if (apiCard) {
    apiCard.hidden = true;
    apiCard.setAttribute('aria-hidden', 'true');
  }

  if (elements.finalizeSubmit) {
    elements.finalizeSubmit.textContent = 'Finalize & save locally';
    elements.finalizeSubmit.title = 'Creates a finalized copy stored on this device.';
  }

  if (document.body) {
    document.body.classList.add('offline-only');
  }
};

if (offlineOnly) {
  applyOfflineUiDefaults();
}

const sanitizedApiKey = () => apiKey.trim();

const buildAuthorizedHeaders = (base = {}) => {
  const headers = { ...base };
  const key = sanitizedApiKey();
  if (key) {
    headers['x-api-key'] = key;
  }
  return headers;
};

const persistApiKey = () => {
  const trimmed = sanitizedApiKey();
  let success = true;

  if (rememberApiKey && trimmed) {
    success = safeStorageSet(persistentApiKeyStore, API_KEY_PERSIST_STORAGE_KEY, trimmed) && success;
    success = safeStorageRemove(sessionApiKeyStore, API_KEY_SESSION_STORAGE_KEY) && success;
  } else {
    if (trimmed) {
      success = safeStorageSet(sessionApiKeyStore, API_KEY_SESSION_STORAGE_KEY, trimmed) && success;
    } else {
      success = safeStorageRemove(sessionApiKeyStore, API_KEY_SESSION_STORAGE_KEY) && success;
    }
    success = safeStorageRemove(persistentApiKeyStore, API_KEY_PERSIST_STORAGE_KEY) && success;
  }

  return success;
};

const setApiKeyStatus = (message, variant = 'info') => {
  if (!elements.apiKeyStatus) return;
  elements.apiKeyStatus.textContent = message;
  elements.apiKeyStatus.dataset.variant = variant;
  elements.apiKeyStatus.classList.remove('success', 'error', 'info');
  elements.apiKeyStatus.classList.add(variant);
};

const updateApiKeyStatus = ({ storageFailed = false } = {}) => {
  if (!elements.apiKeyStatus) return;
  const trimmed = sanitizedApiKey();

  if (!trimmed) {
    setApiKeyStatus('Add the API access key to enable uploads and submissions.', 'error');
    return;
  }

  if (storageFailed) {
    setApiKeyStatus('API key ready for use, but the browser cannot store it. Keep this tab open while working.', 'info');
    return;
  }

  if (rememberApiKey) {
    setApiKeyStatus('API key saved for this device.', 'success');
    return;
  }

  setApiKeyStatus('API key ready for this session.', 'info');
};

const applyApiKeyDefaults = () => {
  if (elements.apiKeyInput) {
    elements.apiKeyInput.value = apiKey;
  }
  if (elements.apiKeyRemember) {
    elements.apiKeyRemember.checked = rememberApiKey;
    if (!persistentApiKeyStore) {
      elements.apiKeyRemember.disabled = true;
      const label = elements.apiKeyRemember.closest('label');
      if (label) {
        label.title = 'Persistent storage unavailable in this browser.';
      }
    }
  }
  updateApiKeyStatus();
};

const hasApiKey = () => Boolean(sanitizedApiKey());

const initApiAccessControls = () => {
  applyApiKeyDefaults();

  elements.apiKeyInput?.addEventListener('input', (event) => {
    apiKey = event.target.value;
    const success = persistApiKey();
    if (!success && rememberApiKey && elements.apiKeyRemember) {
      rememberApiKey = false;
      elements.apiKeyRemember.checked = false;
    }
    const trimmed = sanitizedApiKey();
    updateApiKeyStatus({ storageFailed: Boolean(trimmed) && !success });
  });

  elements.apiKeyRemember?.addEventListener('change', (event) => {
    rememberApiKey = event.target.checked;
    const success = persistApiKey();
    if (!success && rememberApiKey) {
      rememberApiKey = false;
      event.target.checked = false;
    }
    const trimmed = sanitizedApiKey();
    updateApiKeyStatus({ storageFailed: Boolean(trimmed) && !success });
  });
};

const ensureStateShape = () => {
  if (!state.header) {
    state.header = {};
  }
  if (typeof state.header.email !== 'string') {
    state.header.email = state.header.email ? String(state.header.email) : '';
  }
  if (!Array.isArray(state.history)) {
    state.history = [];
  }
  if (!state.meta) {
    state.meta = { draftId: uuid(), lastSavedMode: 'draft', lastSavedAt: null };
  }
  if (!state.meta.draftId) {
    state.meta.draftId = uuid();
  }
};

ensureStateShape();

const findExpenseType = (value) => EXPENSE_TYPES.find((type) => type.value === value);

const formatFileSize = (bytes) => {
  const size = Number(bytes);
  if (!Number.isFinite(size) || size <= 0) return '';
  if (size < 1024) return `${size} B`;
  const kb = size / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 10 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
};

const isAllowedReceiptType = (mime) => {
  if (!mime) return false;
  if (ACCEPTED_RECEIPT_TYPES.has(mime)) return true;
  return ACCEPTED_RECEIPT_PREFIXES.some((prefix) => mime.startsWith(prefix));
};

const ensureReceiptArray = (expense) => {
  if (!Array.isArray(expense.receipts)) {
    expense.receipts = [];
  }
  return expense.receipts;
};

const setReceiptStatus = (expenseId, message, status = 'info') => {
  const refs = expenseRows.get(expenseId);
  if (!refs?.receiptStatus) return;
  refs.receiptStatus.textContent = message || '';
  refs.receiptStatus.dataset.status = status;
};

const renderReceiptList = (expense) => {
  const refs = expenseRows.get(expense.id);
  if (!refs?.receiptList) return;

  refs.receiptList.innerHTML = '';
  const receipts = ensureReceiptArray(expense);
  if (!receipts.length) return;

  receipts.forEach((receipt) => {
    const li = document.createElement('li');
    const sizeLabel = formatFileSize(receipt.fileSize);
    const segments = [receipt.fileName || 'Receipt'];
    if (sizeLabel) segments.push(`(${sizeLabel})`);
    if (receipt.downloadUrl) {
      const link = document.createElement('a');
      link.href = receipt.downloadUrl;
      link.textContent = segments.join(' ');
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      li.appendChild(link);
    } else {
      li.textContent = segments.join(' ');
    }
    refs.receiptList.appendChild(li);
  });
};

const updateReceiptUI = async (expense) => {
  const pending = pendingReceiptFiles.get(expense.id) || [];
  const status = receiptUploadState.get(expense.id);

  if (offlineOnly) {
    await hydrateOfflineReceiptsForExpense(expense.id);
    renderReceiptList(expense);
    const receipts = ensureReceiptArray(expense).filter((receipt) => receipt.draftReceiptId);
    if (receipts.length) {
      const label =
        receipts.length === 1
          ? '1 receipt stored locally'
          : `${receipts.length} receipts stored locally`;
      setReceiptStatus(expense.id, label, 'success');
    } else {
      setReceiptStatus(
        expense.id,
        'Attach receipts now and they will upload automatically once you are back online.',
        'info'
      );
    }
    return;
  }

  renderReceiptList(expense);

  if (status) {
    setReceiptStatus(expense.id, status.message, status.status);
    return;
  }

  if (pending.length) {
    const label = pending.length === 1 ? '1 receipt ready to upload' : `${pending.length} receipts ready to upload`;
    setReceiptStatus(expense.id, label, 'info');
    return;
  }

  const uploaded = ensureReceiptArray(expense).filter((receipt) => !receipt.draftReceiptId);
  if (uploaded.length) {
    const label = uploaded.length === 1 ? '1 receipt uploaded' : `${uploaded.length} receipts uploaded`;
    setReceiptStatus(expense.id, label, 'success');
    return;
  }

  setReceiptStatus(expense.id, 'No receipts attached', 'info');
};

const clearReceiptStateForExpense = (expenseId) => {
  if (pendingReceiptFiles.has(expenseId)) {
    revokeObjectUrlsForExpense(expenseId);
    pendingReceiptFiles.delete(expenseId);
    syncStoredReceiptMetadata();
  }
  const expense = state.expenses.find((item) => item.id === expenseId);
  if (expense?.receipts) {
    expense.receipts = expense.receipts.filter((receipt) => !receipt.draftReceiptId);
  }
  receiptUploadState.delete(expenseId);
};

const createTypeOptions = (select) => {
  select.innerHTML = '';
  EXPENSE_TYPES.forEach((type) => {
    const option = document.createElement('option');
    option.value = type.value;
    option.textContent = `${type.label} (${type.account})`;
    select.append(option);
  });
};

const updateFlightFieldsVisibility = (expense, refs) => {
  const isAir = expense.travelCategory === 'air_domestic' || expense.travelCategory === 'air_international';
  refs.flightOnlyBlocks.forEach((block) => {
    block.style.display = isAir ? '' : 'none';
  });
};

const syncPolicyDetailUI = (expense, refs) => {
  const meta = findExpenseType(expense.type) || EXPENSE_TYPES[0];
  const policy = expense.policy || meta.policy;
  expense.policy = policy;

  Object.entries(refs.detailBlocks).forEach(([key, blocks]) => {
    const targets = Array.isArray(blocks) ? blocks : [blocks].filter(Boolean);
    targets.forEach((block) => {
      block.hidden = policy !== key;
    });
  });

  if (policy === 'travel') {
    updateFlightFieldsVisibility(expense, refs);
  } else {
    refs.flightOnlyBlocks.forEach((block) => {
      block.style.display = 'none';
    });
  }

  const isMileage = policy === 'mileage';
  if (isMileage) {
    refs.amountInput.setAttribute('readonly', 'readonly');
    refs.amountInput.classList.add('readonly');
    const miles = parseNumber(expense.miles);
    expense.miles = miles;
    if (refs.milesInput) {
      refs.milesInput.value = miles ? miles : '';
    }
    const amount = miles * IRS_RATE;
    expense.amount = amount;
    refs.amountInput.value = amount ? amount.toFixed(2) : '';
  } else {
    refs.amountInput.removeAttribute('readonly');
    refs.amountInput.classList.remove('readonly');
  }

  if (refs.mileageRate) {
    refs.mileageRate.hidden = !isMileage;
  }
};

const evaluateExpense = (expense) => {
  const messages = [];
  let reimbursable = parseNumber(expense.amount);

  if (expense.policy === 'meal') {
    const mealKey = expense.mealType || 'dinner';
    const cap = MEAL_LIMITS[mealKey];
    if (!expense.hasReceipt) {
      if (reimbursable > cap) {
        messages.push({ type: 'warning', text: `No receipt: reimbursement capped at ${fmtCurrency(cap)} for ${mealKey}.` });
      }
      reimbursable = Math.min(reimbursable, cap);
    } else if (cap && reimbursable > cap) {
      messages.push({ type: 'info', text: `Above guideline amount (${fmtCurrency(cap)}). Ensure business justification is noted.` });
    }
  }

  if (expense.policy === 'mileage') {
    reimbursable = parseNumber(expense.miles) * IRS_RATE;
    expense.amount = reimbursable;
  }

  if (expense.policy === 'travel') {
    const category = expense.travelCategory || 'air_domestic';
    const travelClass = expense.travelClass || 'coach';
    const hours = parseNumber(expense.flightHours);

    if (category === 'air_domestic') {
      if (travelClass === 'first') {
        messages.push({ type: 'warning', text: 'First-class airfare is not reimbursable.' });
      } else if (travelClass !== 'coach') {
        messages.push({ type: 'warning', text: 'Domestic airfare should be booked in coach. Upgrades are a personal expense.' });
      }
    }

    if (category === 'air_international') {
      if (travelClass === 'first') {
        messages.push({ type: 'warning', text: 'First-class airfare is not reimbursable.' });
      }
      if (travelClass === 'business' && hours < 8) {
        messages.push({ type: 'warning', text: 'Business class allowed only when the published flight time is eight hours or longer.' });
      }
      if (!['business', 'coach', 'premium'].includes(travelClass)) {
        messages.push({ type: 'warning', text: 'Select an allowable fare class.' });
      }
    }

    if (category === 'gym' && reimbursable > 15) {
      messages.push({ type: 'warning', text: 'Hotel gym fees should not exceed $15 per day.' });
    }

    if (category === 'laundry') {
      const tripLength = parseNumber(state.header.tripLength);
      if (!tripLength || tripLength < 7) {
        messages.push({ type: 'warning', text: 'Laundry reimbursed only for trips exceeding seven full days.' });
      }
    }
  }

  expense.reimbursable = reimbursable;
  expense.messages = messages;
  return expense;
};

const updateRowUI = (expense) => {
  const refs = expenseRows.get(expense.id);
  if (!refs) return;

  syncPolicyDetailUI(expense, refs);
  refs.reimbCell.textContent = fmtCurrency(expense.reimbursable || 0);

  refs.messagesList.innerHTML = '';
  if (expense.messages?.length) {
    expense.messages.forEach((message) => {
      const li = document.createElement('li');
      li.textContent = message.text;
      li.className = message.type;
      refs.messagesList.appendChild(li);
    });
  }

  updateReceiptUI(expense);
};

const updateTotals = () => {
  const totals = calculateTotals(state.expenses);

  elements.totalSubmitted.textContent = fmtCurrency(totals.submitted);
  elements.totalDueEmployee.textContent = fmtCurrency(totals.employee);
  elements.totalCompanyCard.textContent = fmtCurrency(totals.company);
};

const setSubmissionFeedback = (message, variant = 'info') => {
  if (!elements.submissionFeedback) return;
  elements.submissionFeedback.textContent = message;
  elements.submissionFeedback.dataset.variant = variant;
  elements.submissionFeedback.classList.remove('success', 'error', 'info');
  elements.submissionFeedback.classList.add(variant);
};

const updatePreview = () => {
  const lines = [];
  const header = state.header;
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

  state.expenses.forEach((expense) => {
    const meta = findExpenseType(expense.type);
    const typeLabel = meta ? meta.label : expense.type;
    const amount = fmtCurrency(parseNumber(expense.amount));
    const reimb = fmtCurrency(parseNumber(expense.reimbursable));

    lines.push([
      expense.date || '',
      typeLabel,
      expense.account || '',
      (expense.description || '').replace(/\s+/g, ' ').trim(),
      expense.payment === 'company' ? 'Company card' : 'Personal',
      amount,
      reimb,
    ].join(' | '));

    if (expense.messages?.length) {
      expense.messages.forEach((msg) => {
        lines.push(`  - ${msg.type === 'warning' ? '⚠️' : 'ℹ️'} ${msg.text}`);
      });
    }
  });

  const totalsLine = `Totals -> Submitted: ${elements.totalSubmitted.textContent}, Due to employee: ${elements.totalDueEmployee.textContent}, Company card: ${elements.totalCompanyCard.textContent}`;
  lines.push('');
  lines.push(totalsLine);

  elements.reportPreview.value = lines.join('\n');
};

const persistAndRefresh = (expense, { previewOnly = false } = {}) => {
  ensureReceiptArray(expense);
  evaluateExpense(expense);
  const index = state.expenses.findIndex((item) => item.id === expense.id);
  if (index !== -1) {
    state.expenses[index] = { ...state.expenses[index], ...expense };
  }
  void saveState(state);
  updateRowUI(expense);
  if (!previewOnly) {
    updateTotals();
  }
  updatePreview();
};

const applyExpenseType = (expense, refs) => {
  ensureReceiptArray(expense);
  const meta = findExpenseType(expense.type) || EXPENSE_TYPES[0];
  expense.policy = meta.policy;
  expense.account = meta.account;
  refs.accountCell.textContent = meta.account;

  if (meta.policy !== 'meal') {
    expense.mealType = expense.mealType || 'dinner';
  }

  if (meta.policy === 'travel') {
    const defaultCategory = meta.travelDefault || 'air_domestic';
    expense.travelCategory = expense.travelCategory || defaultCategory;
    refs.travelCategory.value = expense.travelCategory;
  }

  syncPolicyDetailUI(expense, refs);

  persistAndRefresh(expense);
};

const removeExpense = (id) => {
  const index = state.expenses.findIndex((expense) => expense.id === id);
  if (index === -1) return;

  state.expenses.splice(index, 1);
  clearReceiptStateForExpense(id);
  deleteReceipts(state.meta?.draftId, id).catch((error) => {
    console.warn('Unable to remove stored receipts for deleted expense', error);
  });
  const refs = expenseRows.get(id);
  if (refs) {
    refs.row.remove();
    expenseRows.delete(id);
  }

  updateTotals();
  updatePreview();
  void saveState(state);
};

const persistAndRefreshHeader = () => {
  void saveState(state);
  state.expenses.forEach((expense) => {
    evaluateExpense(expense);
    updateRowUI(expense);
  });
  updateTotals();
  updatePreview();
};

const bindHeaderFields = () => {
  Object.entries(headerBindings).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = state.header[key];
    if (value !== undefined) el.value = value;
    el.addEventListener('input', () => {
      let nextValue = el.value;
      if (el.type === 'number') {
        nextValue = nextValue === '' ? '' : Number(nextValue);
      }
      state.header[key] = nextValue;
      persistAndRefreshHeader();
    });
  });
};

const buildRow = (expense) => {
  const template = document.getElementById('expense-row-template');
  const fragment = template.content.cloneNode(true);
  const row = fragment.querySelector('tr');
  row.dataset.id = expense.id;

  const dateInput = row.querySelector('.exp-date');
  const typeSelect = row.querySelector('.exp-type');
  const accountCell = row.querySelector('.expense-account');
  const description = row.querySelector('.exp-description');
  const paymentSelect = row.querySelector('.exp-payment');
  const amountInput = row.querySelector('.exp-amount');
  const reimbCell = row.querySelector('.expense-reimbursable');
  const messagesList = row.querySelector('.policy-messages');
  const removeBtn = row.querySelector('.remove-expense');
  const mealType = row.querySelector('.exp-meal-type');
  const receipt = row.querySelector('.exp-receipt');
  const receiptInput = row.querySelector('.exp-receipt-files');
  const receiptStatus = row.querySelector('.receipt-status');
  const receiptList = row.querySelector('.receipt-list');
  const milesInput = row.querySelector('.exp-miles');
  const mileageRate = row.querySelector('.mileage-rate');
  const travelCategory = row.querySelector('.exp-travel-cat');
  const travelClass = row.querySelector('.exp-travel-class');
  const flightHours = row.querySelector('.exp-flight-hours');
  const detailBlocks = {
    meal: Array.from(row.querySelectorAll('[data-detail="meal"]')),
    mileage: Array.from(row.querySelectorAll('[data-detail="mileage"]')),
    travel: Array.from(row.querySelectorAll('[data-detail="travel"]')),
  };
  const flightOnlyBlocks = row.querySelectorAll('[data-flight-only]');

  createTypeOptions(typeSelect);

  dateInput.value = expense.date || '';
  typeSelect.value = expense.type || EXPENSE_TYPES[0].value;
  description.value = expense.description || '';
  paymentSelect.value = expense.payment || 'personal';
  amountInput.value = expense.amount ?? '';
  reimbCell.textContent = fmtCurrency(expense.reimbursable || 0);
  mealType.value = expense.mealType || 'dinner';
  receipt.checked = expense.hasReceipt !== false;
  milesInput.value = expense.miles || '';
  travelCategory.value = expense.travelCategory || 'air_domestic';
  travelClass.value = expense.travelClass || 'coach';
  flightHours.value = expense.flightHours || '';
  mileageRate.textContent = `IRS rate $${IRS_RATE.toFixed(3)} per mile`;

  const refs = {
    row,
    dateInput,
    typeSelect,
    accountCell,
    description,
    paymentSelect,
    amountInput,
    reimbCell,
    messagesList,
    removeBtn,
    mealType,
    receipt,
    receiptInput,
    receiptStatus,
    receiptList,
    milesInput,
    mileageRate,
    travelCategory,
    travelClass,
    flightHours,
    detailBlocks,
    flightOnlyBlocks,
  };

  expenseRows.set(expense.id, refs);
  ensureReceiptArray(expense);
  updateReceiptUI(expense);

  typeSelect.addEventListener('change', () => {
    expense.type = typeSelect.value;
    applyExpenseType(expense, refs);
  });

  dateInput.addEventListener('change', () => {
    expense.date = dateInput.value;
    persistAndRefresh(expense);
  });

  description.addEventListener('input', () => {
    expense.description = description.value;
    persistAndRefresh(expense, { previewOnly: true });
  });

  paymentSelect.addEventListener('change', () => {
    expense.payment = paymentSelect.value;
    persistAndRefresh(expense);
  });

  amountInput.addEventListener('input', () => {
    if (expense.policy === 'mileage') return;
    expense.amount = parseNumber(amountInput.value);
    persistAndRefresh(expense);
  });

  mealType.addEventListener('change', () => {
    expense.mealType = mealType.value;
    persistAndRefresh(expense);
  });

  receipt.addEventListener('change', () => {
    expense.hasReceipt = receipt.checked;
    persistAndRefresh(expense);
  });

  if (receiptInput && offlineOnly) {
    receiptInput.title = 'Receipts are stored locally and will upload once you reconnect.';
  }

  receiptInput?.addEventListener('change', async () => {
    const files = Array.from(receiptInput.files || []);
    receiptInput.value = '';
    if (!files.length) return;

    const invalidType = files.find((file) => !isAllowedReceiptType(file.type));
    if (invalidType) {
      receiptUploadState.set(expense.id, {
        status: 'error',
        message: `Unsupported file type: ${invalidType.type || invalidType.name}`,
      });
      clearReceiptStateForExpense(expense.id);
      await deleteReceipts(state.meta?.draftId, expense.id).catch(() => {});
      void updateReceiptUI(expense);
      return;
    }

    const oversize = files.find((file) => file.size > MAX_RECEIPT_BYTES);
    if (oversize) {
      const maxLabel = formatFileSize(MAX_RECEIPT_BYTES);
      receiptUploadState.set(expense.id, {
        status: 'error',
        message: `File exceeds ${maxLabel}: ${oversize.name}`,
      });
      clearReceiptStateForExpense(expense.id);
      await deleteReceipts(state.meta?.draftId, expense.id).catch(() => {});
      void updateReceiptUI(expense);
      return;
    }

    let metadata = [];
    try {
      metadata = await saveReceiptsForExpense(state.meta?.draftId, expense.id, files);
    } catch (error) {
      console.error('Unable to persist receipt files for expense', expense.id, error);
      receiptUploadState.set(expense.id, {
        status: 'error',
        message: 'Unable to store receipts locally. Check storage permissions and try again.',
      });
      clearReceiptStateForExpense(expense.id);
      void updateReceiptUI(expense);
      return;
    }

    if (metadata.length) {
      pendingReceiptFiles.set(expense.id, metadata);
    } else {
      pendingReceiptFiles.delete(expense.id);
    }
    syncStoredReceiptMetadata();

    if (!offlineOnly) {
      receiptUploadState.set(expense.id, {
        status: 'info',
        message: metadata.length === 1 ? '1 receipt ready to upload' : `${metadata.length} receipts ready to upload`,
      });
    } else {
      receiptUploadState.delete(expense.id);
    }

    await hydrateOfflineReceiptsForExpense(expense.id);
    void saveState(state);
    void updateReceiptUI(expense);
  });

  milesInput.addEventListener('input', () => {
    expense.miles = parseNumber(milesInput.value);
    expense.amount = expense.miles * IRS_RATE;
    amountInput.value = expense.amount ? expense.amount.toFixed(2) : '';
    persistAndRefresh(expense);
  });

  travelCategory.addEventListener('change', () => {
    expense.travelCategory = travelCategory.value;
    updateFlightFieldsVisibility(expense, refs);
    persistAndRefresh(expense);
  });

  travelClass.addEventListener('change', () => {
    expense.travelClass = travelClass.value;
    persistAndRefresh(expense);
  });

  flightHours.addEventListener('input', () => {
    expense.flightHours = flightHours.value;
    persistAndRefresh(expense);
  });

  removeBtn.addEventListener('click', () => {
    removeExpense(expense.id);
  });

  applyExpenseType(expense, refs);
  return row;
};

const addExpense = (initial = {}) => {
  const baseType = EXPENSE_TYPES[0];
  const expense = {
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
    travelCategory: 'air_domestic',
    travelClass: 'coach',
    flightHours: '',
    receipts: [],
    ...initial,
  };

  state.expenses.push(expense);
  const row = buildRow(expense);
  elements.expensesBody.appendChild(row);
  evaluateExpense(expense);
  updateRowUI(expense);
  updateTotals();
  updatePreview();
  void saveState(state);
};

const restoreExpenses = () => {
  if (!state.expenses.length) {
    addExpense();
    return;
  }

  state.expenses.forEach((expense) => {
    if (!expense.id) expense.id = uuid();
    ensureReceiptArray(expense);
    const row = buildRow(expense);
    elements.expensesBody.appendChild(row);
    evaluateExpense(expense);
    updateRowUI(expense);
  });

  updateTotals();
  updatePreview();
};

const copyPreview = async () => {
  if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
    elements.copyFeedback.textContent = 'Clipboard unavailable. Select the text and copy manually.';
    setTimeout(() => { elements.copyFeedback.textContent = ''; }, 3000);
    return;
  }

  try {
    await navigator.clipboard.writeText(elements.reportPreview.value);
    elements.copyFeedback.textContent = 'Copied to clipboard!';
  } catch (error) {
    console.warn('Copy to clipboard failed', error);
    elements.copyFeedback.textContent = 'Unable to copy automatically. Select and copy manually.';
  }

  setTimeout(() => { elements.copyFeedback.textContent = ''; }, 3000);
};

const initHeaderBindings = () => bindHeaderFields();

const initAddButton = () => {
  elements.addExpense?.addEventListener('click', () => addExpense());
};

const initCopyButton = () => {
  elements.copyPreview?.addEventListener('click', copyPreview);
};

const resetHeaderInputs = () => {
  Object.entries(headerBindings).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if (!el) return;
    const value = state.header[key];
    if (value === undefined || value === null) {
      el.value = '';
    } else if (el.type === 'number') {
      el.value = value === '' ? '' : String(value);
    } else {
      el.value = value;
    }
  });
};

const clearExpensesUI = () => {
  expenseRows.forEach((refs) => {
    refs.row.remove();
  });
  expenseRows.clear();
  elements.expensesBody.innerHTML = '';
  clearAllReceiptObjectUrls();
  pendingReceiptFiles.clear();
  syncStoredReceiptMetadata();
  receiptUploadState.clear();
};

const buildHistoryEntry = (payload, responseData) => {
  const serverId = responseData?.id || responseData?.reportId || responseData?.report?.id || null;
  return {
    reportId: payload.reportId,
    serverId,
    finalizedAt: payload.finalizedAt,
    employeeEmail: payload.employeeEmail,
    totals: payload.totals,
  };
};

const applyFinalizeSuccessState = (historyEntry, { mode, successMessage }) => {
  state.history.push(historyEntry);

  const previousDraftId = state.meta?.draftId;
  const freshState = createFreshState();
  state.header = { ...freshState.header };
  state.expenses = [];
  state.meta = { ...freshState.meta, lastSavedMode: mode, lastSavedAt: new Date().toISOString() };

  clearExpensesUI();
  addExpense();
  resetHeaderInputs();
  updateTotals();
  updatePreview();

  if (previousDraftId) {
    clearReceiptsForDraft(previousDraftId).catch((error) => {
      console.warn('Unable to clear stored receipts for finalized draft', error);
    });
  }

  void saveState(state, { mode });
  setSubmissionFeedback(successMessage, 'success');
};

const hasPendingReceiptUploads = () => {
  for (const files of pendingReceiptFiles.values()) {
    if (Array.isArray(files) && files.length) {
      return true;
    }
  }
  return false;
};

const normalizeReceiptResponse = (receipt) => {
  if (!receipt || typeof receipt !== 'object') return null;
  return {
    id: receipt.id,
    reportId: receipt.reportId,
    clientExpenseId: receipt.clientExpenseId,
    storageProvider: receipt.storageProvider,
    storageBucket: receipt.storageBucket,
    storageKey: receipt.storageKey ?? receipt.objectKey ?? receipt.storageId,
    fileName: receipt.fileName,
    contentType: receipt.contentType,
    fileSize: receipt.fileSize,
    storageUrl: receipt.storageUrl,
    downloadUrl: receipt.downloadUrl || receipt.storageUrl,
    uploadedAt: receipt.uploadedAt ?? receipt.createdAt,
  };
};

const mergeReceiptMetadata = (expense, uploadedReceipts) => {
  const existing = ensureReceiptArray(expense);
  const map = new Map(existing.map((item) => [item.id || item.storageKey || item.fileName, item]));
  uploadedReceipts.forEach((item) => {
    if (!item) return;
    const key = item.id || item.storageKey || item.fileName;
    map.set(key, { ...map.get(key), ...item });
  });
  expense.receipts = Array.from(map.values());
};

const uploadReceiptsForExpense = async (expense, reportId) => {
  const metadata = pendingReceiptFiles.get(expense.id);
  if (!metadata?.length) return;

  if (!hasApiKey()) {
    receiptUploadState.set(expense.id, {
      status: 'error',
      message: 'Add the API access key before uploading receipts.',
    });
    void updateReceiptUI(expense);
    throw new Error('Missing API key for receipt upload');
  }

  receiptUploadState.set(expense.id, {
    status: 'uploading',
    message: metadata.length === 1 ? 'Uploading 1 receipt…' : `Uploading ${metadata.length} receipts…`,
  });
  void updateReceiptUI(expense);

  let stored = [];
  try {
    stored = await getStoredReceipts(state.meta?.draftId, expense.id, metadata.map((item) => item.id));
  } catch (error) {
    console.error('Unable to read stored receipts for upload', error);
    receiptUploadState.set(expense.id, {
      status: 'error',
      message: 'Unable to read stored receipts for upload. Try reattaching the files.',
    });
    void updateReceiptUI(expense);
    throw error;
  }

  if (!stored.length) {
    receiptUploadState.set(expense.id, {
      status: 'error',
      message: 'Receipts were not found in storage. Attach them again before uploading.',
    });
    void updateReceiptUI(expense);
    throw new Error('No stored receipts available for upload');
  }

  const formData = new FormData();
  formData.append('reportId', reportId);
  formData.append('expenseId', expense.id);
  stored.forEach(({ metadata: meta, blob }) => {
    const fileName = meta.fileName || 'receipt';
    let uploadBlob = blob;
    if (!(uploadBlob instanceof File)) {
      try {
        uploadBlob = new File([blob], fileName, {
          type: meta.contentType || 'application/octet-stream',
          lastModified: meta.lastModified || Date.now(),
        });
      } catch (error) {
        uploadBlob = blob;
      }
    }
    formData.append('files', uploadBlob, fileName);
  });

  let response;
  try {
    response = await fetch(RECEIPT_UPLOAD_ENDPOINT, {
      method: 'POST',
      headers: buildAuthorizedHeaders({ accept: 'application/json' }),
      body: formData,
    });
  } catch (error) {
    receiptUploadState.set(expense.id, {
      status: 'error',
      message: 'Network error while uploading receipts. Try again.',
    });
    void updateReceiptUI(expense);
    throw error;
  }

  if (!response.ok) {
    let errorMessage = `Upload failed (status ${response.status}). Check files and retry.`;
    if (response.status === 401) {
      errorMessage = 'Upload failed: API key was rejected. Confirm the key and try again.';
    } else {
      try {
        const errorBody = await response.json();
        if (errorBody?.message) {
          errorMessage = errorBody.message;
        }
      } catch (error) {
        // ignore parse errors
      }
    }
    receiptUploadState.set(expense.id, {
      status: 'error',
      message: errorMessage,
    });
    void updateReceiptUI(expense);
    throw new Error(`Receipt upload failed with status ${response.status}`);
  }

  let body;
  try {
    body = await response.json();
  } catch (error) {
    body = null;
  }

  const uploadedReceipts = Array.isArray(body?.receipts)
    ? body.receipts.map(normalizeReceiptResponse).filter(Boolean)
    : [];

  const retained = ensureReceiptArray(expense).filter((receipt) => !receipt.draftReceiptId);
  expense.receipts = retained;
  mergeReceiptMetadata(expense, uploadedReceipts);
  revokeObjectUrlsForExpense(expense.id);
  pendingReceiptFiles.delete(expense.id);
  syncStoredReceiptMetadata();
  await deleteReceipts(state.meta?.draftId, expense.id, metadata.map((item) => item.id)).catch((error) => {
    console.warn('Unable to remove uploaded receipts from storage', error);
  });
  receiptUploadState.set(expense.id, {
    status: 'success',
    message:
      uploadedReceipts.length === 1
        ? 'Receipt uploaded successfully'
        : `${uploadedReceipts.length} receipts uploaded successfully`,
  });
  void saveState(state);
  void updateReceiptUI(expense);
};

const uploadPendingReceipts = async (reportId) => {
  const uploads = [];
  state.expenses.forEach((expense) => {
    const files = pendingReceiptFiles.get(expense.id);
    if (files?.length) {
      uploads.push(uploadReceiptsForExpense(expense, reportId));
    }
  });

  for (const upload of uploads) {
    await upload;
  }

  if (uploads.length) {
    void saveState(state);
  }
};

const finalizeSubmit = async () => {
  if (submitting) return;

  state.expenses.forEach((expense) => evaluateExpense(expense));
  updateTotals();
  updatePreview();

  const duplicate = state.history?.some((entry) => entry.reportId === state.meta?.draftId);
  if (duplicate) {
    setSubmissionFeedback('This report has already been submitted. Start a new report to submit again.', 'info');
    return;
  }

  const reportId = state.meta?.draftId;
  if (!reportId) {
    setSubmissionFeedback('Unable to determine report identifier. Reload and try again.', 'error');
    return;
  }

  const finalizedAt = new Date();

  if (!offlineOnly && !hasApiKey()) {
    setSubmissionFeedback('Enter the API access key provided by Finance before submitting.', 'error');
    return;
  }

  submitting = true;
  elements.finalizeSubmit?.setAttribute('disabled', 'disabled');
  const pendingUploads = hasPendingReceiptUploads();
  const preparingMessage = offlineOnly
    ? 'Preparing local report…'
    : pendingUploads
    ? 'Uploading receipts…'
    : 'Preparing submission…';
  setSubmissionFeedback(preparingMessage, 'info');

  if (!offlineOnly) {
    try {
      if (pendingUploads) {
        await uploadPendingReceipts(reportId);
      }
    } catch (error) {
      console.error('Receipt upload failed', error);
      setSubmissionFeedback('Receipt upload failed. Check the highlighted expenses and try again.', 'error');
      submitting = false;
      elements.finalizeSubmit?.removeAttribute('disabled');
      return;
    }
  }

  let payload;
  try {
    payload = buildReportPayload(state, { reportId, finalizedAt });
  } catch (error) {
    setSubmissionFeedback(error.message || 'Unable to prepare submission. Check required fields and try again.', 'error');
    submitting = false;
    elements.finalizeSubmit?.removeAttribute('disabled');
    return;
  }

  if (offlineOnly) {
    const historyEntry = {
      ...buildHistoryEntry(payload, null),
      offline: true,
      offlinePayload: JSON.stringify(payload, null, 2),
    };
    applyFinalizeSuccessState(historyEntry, {
      mode: 'finalized-offline',
      successMessage: 'Report saved locally. Attach receipts and submit once you are back online.',
    });

    submitting = false;
    elements.finalizeSubmit?.removeAttribute('disabled');
    return;
  }

  setSubmissionFeedback('Submitting report…', 'info');

  let submissionHandledError = false;

  try {
    const response = await fetch(SUBMIT_ENDPOINT, {
      method: 'POST',
      headers: buildAuthorizedHeaders({ 'Content-Type': 'application/json', accept: 'application/json' }),
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      submissionHandledError = true;
      if (response.status === 401) {
        setSubmissionFeedback('Submission failed: API key was rejected. Confirm the key and try again.', 'error');
      } else {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.message
          ? `Submission failed: ${errorBody.message}`
          : `Submission failed with status ${response.status}. Try again.`;
        setSubmissionFeedback(message, 'error');
      }
      throw new Error(`Server responded with status ${response.status}`);
    }

    let responseBody = null;
    try {
      responseBody = await response.json();
    } catch (error) {
      responseBody = null;
    }

    const historyEntry = buildHistoryEntry(payload, responseBody);
    const confirmationId = historyEntry.serverId ? `Confirmation ID: ${historyEntry.serverId}.` : 'Submission recorded.';

    applyFinalizeSuccessState(historyEntry, {
      mode: 'finalized',
      successMessage: `Report submitted successfully. ${confirmationId}`,
    });
  } catch (error) {
    console.error('Report submission failed', error);
    if (!submissionHandledError) {
      setSubmissionFeedback(
        'Submission failed. Check your connection and try again in a few moments. Your draft is still saved.',
        'error'
      );
    }
    void saveState(state);
  } finally {
    submitting = false;
    elements.finalizeSubmit?.removeAttribute('disabled');
  }
};

const initFinalizeButton = () => {
  elements.finalizeSubmit?.addEventListener('click', finalizeSubmit);
};

const refreshAllExpenses = () => {
  state.expenses.forEach((expense) => {
    evaluateExpense(expense);
    updateRowUI(expense);
  });
  updateTotals();
  updatePreview();
};

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') {
    refreshAllExpenses();
  }
});

const init = () => {
  if (!offlineOnly) {
    initApiAccessControls();
  }
  initHeaderBindings();
  restoreExpenses();
  initAddButton();
  initCopyButton();
  initFinalizeButton();
};

init();

if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .register('/service-worker.js')
    .catch((error) => {
      console.error('Service worker registration failed:', error);
    });
}

export { finalizeSubmit };
