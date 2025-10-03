import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../src/constants.js';

const baseLocalStorage = {
  __store: new Map<string, string>(),
  getItem(key: string) {
    return this.__store.get(key) ?? null;
  },
  setItem(key: string, value: string) {
    this.__store.set(key, value);
  },
  removeItem(key: string) {
    this.__store.delete(key);
  },
};

vi.stubGlobal('window', { localStorage: baseLocalStorage });

let cachedStorageModule: typeof import('../src/storage.js') | null = null;
let cachedReceiptStorage: typeof import('../src/receiptStorage.js') | null = null;

const setupModule = async ({
  initialStore = {},
}: {
  initialStore?: Record<string, string>;
} = {}) => {
  await import('fake-indexeddb/auto');

  baseLocalStorage.__store = new Map<string, string>(Object.entries(initialStore));
  const getItem = vi.fn(baseLocalStorage.getItem.bind(baseLocalStorage));
  const setItem = vi.fn(baseLocalStorage.setItem.bind(baseLocalStorage));
  const removeItem = vi.fn(baseLocalStorage.removeItem.bind(baseLocalStorage));
  baseLocalStorage.getItem = getItem;
  baseLocalStorage.setItem = setItem;
  baseLocalStorage.removeItem = removeItem;

  if (!cachedStorageModule) {
    cachedStorageModule = await import('../src/storage.js');
  }
  if (!cachedReceiptStorage) {
    cachedReceiptStorage = await import('../src/receiptStorage.js');
  }

  return { ...cachedStorageModule!, ...cachedReceiptStorage!, getItem, setItem, removeItem };
};

afterEach(async () => {
  vi.doUnmock('../src/utils.js');
  vi.clearAllMocks();
  baseLocalStorage.__store.clear();
  const { teardownReceiptStorage } = await import('../src/receiptStorage.js');
  await teardownReceiptStorage();
});

describe('loadState', () => {
  it('normalizes saved data and fills in missing identifiers', async () => {
    const savedState = {
      header: { name: 'Saved User' },
      expenses: [
        { description: 'Taxi ride', receipts: null },
        { id: 'existing-exp', receipts: [{ id: 'receipt-2' }] },
      ],
      meta: { lastSavedMode: 'submitted' },
    };

    const { loadState } = await setupModule({
      initialStore: { [STORAGE_KEY]: JSON.stringify(savedState) },
    });

    const state = await loadState();

    expect(state.header).toMatchObject({
      name: 'Saved User',
      department: '',
    });
    expect(typeof state.meta.draftId).toBe('string');
    expect(state.meta.draftId).toBeTruthy();
    expect(typeof state.expenses[0].id).toBe('string');
    expect(state.expenses[0].id).not.toBe('');
    expect(state.expenses[0].receipts).toEqual([]);
    expect(state.expenses[1].receipts).toEqual([{ id: 'receipt-2' }]);
  });

  it('falls back to defaults when parsing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { loadState } = await setupModule({
      initialStore: { [STORAGE_KEY]: '{not-json}' },
    });

    const state = await loadState();

    expect(typeof state.meta.draftId).toBe('string');
    expect(state.meta.draftId).toBeTruthy();
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unable to load saved expense state'), expect.anything());

    warn.mockRestore();
  });

  it('hydrates stored receipt metadata from indexedDB', async () => {
    const savedState = {
      expenses: [{ id: 'expense-1', description: 'Taxi' }],
      meta: { draftId: 'draft-123' },
    };

    const { loadState, saveReceiptsForExpense, listReceiptMetadataForDraft } = await setupModule({
      initialStore: { [STORAGE_KEY]: JSON.stringify(savedState) },
    });

    expect(typeof indexedDB).toBe('object');
    const file = new File(['test'], 'receipt.pdf', { type: 'application/pdf' });
    await saveReceiptsForExpense('draft-123', 'expense-1', [file]);

    const state = await loadState();

    expect(state.meta.storedReceipts?.['expense-1']).toHaveLength(1);
    const expense = state.expenses.find((item) => item.id === 'expense-1');
    expect(expense?.receipts?.some((receipt) => receipt.draftReceiptId)).toBe(true);

    const metadataMap = await listReceiptMetadataForDraft('draft-123');
    expect(metadataMap.get('expense-1')).toHaveLength(1);
  });
});

describe('saveState and clearDraft', () => {
  it('persists state updates with timestamps and draft identifiers', async () => {
    const { loadState, saveState, setItem } = await setupModule();

    const state = await loadState();

    await saveState(state, { mode: 'final' });

    expect(state.meta.draftId).toBeTruthy();
    expect(state.meta.lastSavedMode).toBe('final');
    expect(state.meta.lastSavedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.stringContaining('"lastSavedMode":"final"'));
  });

  it('removes persisted draft data when clearing', async () => {
    const { clearDraft, removeItem } = await setupModule();

    await clearDraft();

    expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

describe('createFreshState', () => {
  it('generates a new draft identifier on each invocation', async () => {
    const { createFreshState } = await setupModule();

    const first = createFreshState();
    const second = createFreshState();

    expect(first.meta.draftId).toBeTruthy();
    expect(second.meta.draftId).toBeTruthy();
    expect(first).not.toBe(second);
    expect(first.meta.draftId).not.toBe(second.meta.draftId);
  });
});
