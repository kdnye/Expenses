import { STORAGE_KEY, cloneDefaultState, DEFAULT_STATE } from './constants.js';
import { uuid } from './utils.js';
import { listReceiptMetadataForDraft, clearReceiptsForDraft } from './receiptStorage.js';

const normalizeState = (rawState = {}) => {
  const base = cloneDefaultState();
  const state = {
    header: { ...base.header, ...(rawState.header || {}) },
    expenses: Array.isArray(rawState.expenses)
      ? rawState.expenses.map((expense) => {
          const normalized = { ...expense };
          if (!normalized.id) normalized.id = uuid();
          if (!Array.isArray(normalized.receipts)) {
            normalized.receipts = [];
          }
          return normalized;
        })
      : [],
    history: Array.isArray(rawState.history) ? rawState.history : [],
    meta: { ...base.meta, ...(rawState.meta || {}) },
  };

  if (!state.meta?.draftId) {
    state.meta.draftId = uuid();
  }

  return state;
};

const getLocalStorage = () => {
  try {
    if (typeof window === 'undefined' || !('localStorage' in window)) {
      return null;
    }
    const testKey = '__fsi-expense-test__';
    window.localStorage.setItem(testKey, 'ok');
    window.localStorage.removeItem(testKey);
    return window.localStorage;
  } catch (error) {
    console.warn('Local storage unavailable, state will not persist.', error);
    return null;
  }
};

const storage = getLocalStorage();

const buildStoredReceiptIndex = (metadataMap) => {
  const result = {};
  metadataMap.forEach((list, expenseId) => {
    if (!Array.isArray(list) || !list.length) return;
    result[expenseId] = list.map((item) => ({
      id: item.id,
      expenseId: item.expenseId,
      fileName: item.fileName,
      fileSize: item.fileSize,
      contentType: item.contentType,
      lastModified: item.lastModified,
    }));
  });
  return result;
};

const mergeStoredMetadataIntoState = (state, metadataMap) => {
  const storedIndex = buildStoredReceiptIndex(metadataMap);
  state.meta.storedReceipts = storedIndex;

  if (!Array.isArray(state.expenses)) return;
  state.expenses = state.expenses.map((expense) => {
    const receipts = Array.isArray(expense.receipts) ? [...expense.receipts] : [];
    const stored = storedIndex[expense.id] || [];
    const filtered = receipts.filter((receipt) => !stored.find((meta) => meta.id === receipt.draftReceiptId));
    const enriched = stored.map((meta) => ({
      draftReceiptId: meta.id,
      fileName: meta.fileName,
      fileSize: meta.fileSize,
      contentType: meta.contentType,
      lastModified: meta.lastModified,
    }));
    return { ...expense, receipts: [...filtered, ...enriched] };
  });
};

export const loadState = async () => {
  if (!storage) {
    const base = cloneDefaultState();
    base.meta.storedReceipts = {};
    return base;
  }

  let parsed = null;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      parsed = JSON.parse(raw);
    }
  } catch (error) {
    console.warn('Unable to load saved expense state', error);
  }

  const state = normalizeState(parsed || DEFAULT_STATE);
  let metadataMap = new Map();
  try {
    metadataMap = await listReceiptMetadataForDraft(state.meta?.draftId);
  } catch (error) {
    console.warn('Unable to read stored receipts for draft', error);
    metadataMap = new Map();
  }

  mergeStoredMetadataIntoState(state, metadataMap);
  return state;
};

export const saveState = async (state, { mode = 'draft' } = {}) => {
  if (!storage) return;
  if (!state.meta?.draftId) {
    state.meta = { ...state.meta, draftId: uuid() };
  }

  state.meta.lastSavedMode = mode;
  state.meta.lastSavedAt = new Date().toISOString();

  if (!state.meta.storedReceipts) {
    try {
      const metadataMap = await listReceiptMetadataForDraft(state.meta.draftId);
      state.meta.storedReceipts = buildStoredReceiptIndex(metadataMap);
    } catch (error) {
      console.warn('Unable to sync stored receipt metadata before saving', error);
    }
  }

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Unable to persist expense state', error);
  }
};

export const clearDraft = async () => {
  if (!storage) return;
  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const draftId = parsed?.meta?.draftId;
      await clearReceiptsForDraft(draftId);
    }
  } catch (error) {
    console.warn('Unable to purge stored receipts for draft', error);
  }

  try {
    storage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to clear saved expense state', error);
  }
};

export const createFreshState = () => {
  const state = cloneDefaultState();
  state.meta.draftId = uuid();
  state.meta.storedReceipts = {};
  return state;
};
