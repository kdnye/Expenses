import { STORAGE_KEY, cloneDefaultState, DEFAULT_STATE } from './constants.js';
import { uuid } from './utils.js';

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

export const loadState = () => {
  if (!storage) {
    return cloneDefaultState();
  }

  try {
    const raw = storage.getItem(STORAGE_KEY);
    if (!raw) return cloneDefaultState();
    const parsed = JSON.parse(raw);
    return normalizeState(parsed);
  } catch (error) {
    console.warn('Unable to load saved expense state', error);
    return normalizeState(DEFAULT_STATE);
  }
};

export const saveState = (state, { mode = 'draft' } = {}) => {
  if (!storage) return state;

  const nextState = {
    ...state,
    meta: {
      ...state.meta,
      draftId: state.meta?.draftId || uuid(),
      lastSavedMode: mode,
      lastSavedAt: new Date().toISOString(),
    },
  };

  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(nextState));
  } catch (error) {
    console.warn('Unable to persist expense state', error);
  }

  return nextState;
};

export const clearDraft = () => {
  if (!storage) return;
  try {
    storage.removeItem(STORAGE_KEY);
  } catch (error) {
    console.warn('Unable to clear saved expense state', error);
  }
};

export const createFreshState = () => {
  const state = cloneDefaultState();
  state.meta.draftId = uuid();
  return state;
};
