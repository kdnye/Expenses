import 'fake-indexeddb/auto';
import { afterEach, describe, expect, it, vi } from 'vitest';

let cachedReceiptStorage: typeof import('../src/receiptStorage.js') | null = null;

const setup = async ({ forceReload = false } = {}) => {
  if (forceReload) {
    cachedReceiptStorage = null;
    vi.resetModules();
  }
  if (!cachedReceiptStorage) {
    cachedReceiptStorage = await import('../src/receiptStorage.js');
  }
  return cachedReceiptStorage!;
};

afterEach(async () => {
  vi.doUnmock('../src/utils.js');
  vi.clearAllMocks();
  const { teardownReceiptStorage } = await import('../src/receiptStorage.js');
  await teardownReceiptStorage();
});

describe('receiptStorage', () => {
  it('persists and retrieves receipt blobs keyed by draft and expense', async () => {
    const {
      saveReceiptsForExpense,
      getStoredReceipts,
      listReceiptMetadataForDraft,
      deleteReceipts,
      clearReceiptsForDraft,
    } = await setup();

    const fileA = new File(['alpha'], 'alpha.pdf', { type: 'application/pdf' });
    const fileB = new File(['beta'], 'beta.png', { type: 'image/png' });

    const metadata = await saveReceiptsForExpense('draft-1', 'expense-1', [fileA, fileB]);

    expect(metadata).toHaveLength(2);
    expect(metadata[0].id).not.toBe(metadata[1].id);
    expect(metadata.every((item) => item.fileName)).toBe(true);

    const stored = await getStoredReceipts('draft-1', 'expense-1');
    expect(stored).toHaveLength(2);
    const names = stored.map((item) => item.metadata.fileName);
    expect(new Set(names)).toEqual(new Set(['alpha.pdf', 'beta.png']));
    const alphaEntry = stored.find((item) => item.metadata.fileName === 'alpha.pdf');
    expect(alphaEntry).toBeTruthy();
    await expect(alphaEntry!.blob.text()).resolves.toBe('alpha');

    const map = await listReceiptMetadataForDraft('draft-1');
    expect(map.get('expense-1')).toHaveLength(2);

    await deleteReceipts('draft-1', 'expense-1', [metadata[0].id]);
    const remaining = await getStoredReceipts('draft-1', 'expense-1');
    expect(remaining).toHaveLength(1);
    expect(remaining[0].metadata.fileName).toBe('beta.png');

    await clearReceiptsForDraft('draft-1');
    const cleared = await getStoredReceipts('draft-1', 'expense-1');
    expect(cleared).toHaveLength(0);
  });

  it('falls back to file system access when indexedDB is unavailable', async () => {
    const originalIndexedDb = globalThis.indexedDB;
    const originalNavigator = globalThis.navigator as any;

    class MockFileHandle {
      name: string;
      kind = 'file';
      private data: Blob;

      constructor(name: string) {
        this.name = name;
        this.data = new Blob([]);
      }

      async createWritable() {
        return {
          write: async (value: Blob | string) => {
            if (typeof value === 'string') {
              this.data = new Blob([value], { type: 'application/json' });
            } else {
              this.data = value;
            }
          },
          close: async () => {},
        };
      }

      async getFile() {
        return this.data;
      }
    }

    class MockDirectoryHandle {
      name: string;
      kind = 'directory';
      private directories = new Map<string, MockDirectoryHandle>();
      private files = new Map<string, MockFileHandle>();

      constructor(name: string) {
        this.name = name;
      }

      async getDirectoryHandle(name: string, { create = false } = {}) {
        let dir = this.directories.get(name);
        if (!dir && create) {
          dir = new MockDirectoryHandle(name);
          this.directories.set(name, dir);
        }
        if (!dir) {
          const error: any = new Error('NotFoundError');
          error.name = 'NotFoundError';
          error.code = 8;
          throw error;
        }
        return dir;
      }

      async getFileHandle(name: string, { create = false } = {}) {
        let file = this.files.get(name);
        if (!file && create) {
          file = new MockFileHandle(name);
          this.files.set(name, file);
        }
        if (!file) {
          const error: any = new Error('NotFoundError');
          error.name = 'NotFoundError';
          error.code = 8;
          throw error;
        }
        return file;
      }

      async removeEntry(name: string) {
        if (this.directories.delete(name)) return;
        if (this.files.delete(name)) return;
        const error: any = new Error('NotFoundError');
        error.name = 'NotFoundError';
        error.code = 8;
        throw error;
      }

      async *entries() {
        for (const [name, handle] of this.directories.entries()) {
          yield [name, handle] as const;
        }
      }
    }

    const rootHandle = new MockDirectoryHandle('root');

    Object.defineProperty(globalThis, 'indexedDB', {
      configurable: true,
      writable: true,
      value: undefined,
    });

    Object.defineProperty(globalThis, 'navigator', {
      configurable: true,
      writable: true,
      value: {
        storage: {
          getDirectory: async () => rootHandle,
        },
      },
    });

    try {
      const {
        saveReceiptsForExpense,
        getStoredReceipts,
        listReceiptMetadataForDraft,
        deleteReceipts,
        clearReceiptsForDraft,
      } = await setup({ forceReload: true });

      const file = new File(['fallback'], 'fallback.pdf', { type: 'application/pdf' });
      const metadata = await saveReceiptsForExpense('draft-fs', 'expense-fs', [file]);
      expect(metadata).toHaveLength(1);

      const stored = await getStoredReceipts('draft-fs', 'expense-fs');
      expect(stored).toHaveLength(1);
      await expect(stored[0].blob.text()).resolves.toBe('fallback');

      const map = await listReceiptMetadataForDraft('draft-fs');
      expect(map.get('expense-fs')).toHaveLength(1);

      await deleteReceipts('draft-fs', 'expense-fs', [metadata[0].id]);
      const cleared = await getStoredReceipts('draft-fs', 'expense-fs');
      expect(cleared).toHaveLength(0);

      await saveReceiptsForExpense('draft-fs', 'expense-fs', [file]);
      await clearReceiptsForDraft('draft-fs');
      const afterClear = await getStoredReceipts('draft-fs', 'expense-fs');
      expect(afterClear).toHaveLength(0);
    } finally {
      Object.defineProperty(globalThis, 'indexedDB', {
        configurable: true,
        writable: true,
        value: originalIndexedDb,
      });
      if (originalNavigator === undefined) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        delete (globalThis as any).navigator;
      } else {
        Object.defineProperty(globalThis, 'navigator', {
          configurable: true,
          writable: true,
          value: originalNavigator,
        });
      }
      cachedReceiptStorage = null;
      vi.resetModules();
    }
  });
});
