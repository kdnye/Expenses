import { afterEach, describe, expect, it, vi } from 'vitest';
import { STORAGE_KEY } from '../src/constants.js';

const setupModule = async ({
  initialStore = {},
  generatedIds = [],
}: {
  initialStore?: Record<string, string>;
  generatedIds?: string[];
} = {}) => {
  vi.resetModules();
  vi.doUnmock('../src/utils.js');

  const store = new Map<string, string>(Object.entries(initialStore));
  const getItem = vi.fn((key: string) => store.get(key) ?? null);
  const setItem = vi.fn((key: string, value: string) => {
    store.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    store.delete(key);
  });

  const localStorage = { getItem, setItem, removeItem };
  vi.stubGlobal('window', { localStorage });

  let callIndex = 0;
  vi.doMock('../src/utils.js', async () => {
    const actual = await vi.importActual<typeof import('../src/utils.js')>('../src/utils.js');
    return {
      ...actual,
      uuid: vi.fn(() => {
        const value = generatedIds[callIndex] ?? `mock-id-${callIndex}`;
        callIndex += 1;
        return value;
      }),
    };
  });

  const module = await import('../src/storage.js');
  return { ...module, store, getItem, setItem, removeItem };
};

afterEach(() => {
  vi.doUnmock('../src/utils.js');
  vi.unstubAllGlobals();
  vi.resetModules();
  vi.clearAllMocks();
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
      generatedIds: ['expense-123', 'draft-123'],
    });

    const state = loadState();

    expect(state.header).toMatchObject({
      name: 'Saved User',
      department: '',
    });
    expect(state.meta.draftId).toBe('draft-123');
    expect(state.expenses[0].id).toBe('expense-123');
    expect(state.expenses[0].receipts).toEqual([]);
    expect(state.expenses[1].receipts).toEqual([{ id: 'receipt-2' }]);
  });

  it('falls back to defaults when parsing fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const { loadState } = await setupModule({
      initialStore: { [STORAGE_KEY]: '{not-json}' },
      generatedIds: ['draft-fallback'],
    });

    const state = loadState();

    expect(state.meta.draftId).toBe('draft-fallback');
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('Unable to load saved expense state'), expect.anything());

    warn.mockRestore();
  });
});

describe('saveState and clearDraft', () => {
  it('persists state updates with timestamps and draft identifiers', async () => {
    const { loadState, saveState, setItem } = await setupModule({
      generatedIds: ['new-draft-id'],
    });

    const state = loadState();

    const updated = saveState(state, { mode: 'final' });

    expect(updated).not.toBe(state);
    expect(updated.meta.draftId).toBe('new-draft-id');
    expect(updated.meta.lastSavedMode).toBe('final');
    expect(updated.meta.lastSavedAt).toMatch(/\d{4}-\d{2}-\d{2}T/);
    expect(state.meta.draftId).not.toBe('new-draft-id');
    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.stringContaining('"lastSavedMode":"final"'));
  });

  it('removes persisted draft data when clearing', async () => {
    const { clearDraft, removeItem } = await setupModule();

    clearDraft();

    expect(removeItem).toHaveBeenCalledWith(STORAGE_KEY);
  });
});

describe('createFreshState', () => {
  it('generates a new draft identifier on each invocation', async () => {
    const { createFreshState } = await setupModule({
      generatedIds: ['draft-a', 'draft-b'],
    });

    const first = createFreshState();
    const second = createFreshState();

    expect(first.meta.draftId).toBe('draft-a');
    expect(second.meta.draftId).toBe('draft-b');
    expect(first).not.toBe(second);
  });
});
