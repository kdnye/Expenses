import { STORAGE_KEY, cloneDefaultState, DEFAULT_STATE } from './constants.js';

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
    return {
      header: { ...DEFAULT_STATE.header, ...(parsed.header || {}) },
      expenses: Array.isArray(parsed.expenses) ? parsed.expenses : [],
    };
  } catch (error) {
    console.warn('Unable to load saved expense state', error);
    return cloneDefaultState();
  }
};

export const saveState = (state) => {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (error) {
    console.warn('Unable to persist expense state', error);
  }
};
