import { uuid } from './utils.js';

const DB_NAME = 'fsi-expenses-receipts';
const DB_VERSION = 1;
const STORE_NAME = 'receipts';
const INDEX_NAME = 'draftExpense';
const FS_ROOT_DIRECTORY = 'fsi-expenses-receipts';

const hasIndexedDb = () => typeof indexedDB !== 'undefined';
const hasFileSystemAccess = () => typeof navigator !== 'undefined' && !!navigator.storage?.getDirectory;

let dbPromise = null;
let fsRootPromise = null;

const openIndexedDb = () => {
  if (!hasIndexedDb()) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: 'id' });
        store.createIndex(INDEX_NAME, ['draftId', 'expenseId'], { unique: false });
      }
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      console.warn('Unable to open receipt storage database', request.error);
      reject(request.error || new Error('Unable to open receipt storage database'));
    };
  }).catch((error) => {
    console.warn('Receipt storage disabled due to initialization failure', error);
    return null;
  });

  return dbPromise;
};

const openFileSystemRoot = () => {
  if (!hasFileSystemAccess()) {
    return Promise.resolve(null);
  }

  if (fsRootPromise) return fsRootPromise;

  fsRootPromise = navigator.storage
    .getDirectory()
    .then((root) => root)
    .catch((error) => {
      console.warn('Unable to open receipt file system storage', error);
      return null;
    });

  return fsRootPromise;
};

const closeDatabase = () => {
  if (!dbPromise) return;
  dbPromise.then((db) => db?.close?.()).catch(() => {});
  dbPromise = null;
};

const closeFileSystemRoot = () => {
  fsRootPromise = null;
};

const requestToPromise = (request) =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('IndexedDB request failed'));
  });

const transactionDone = (transaction) =>
  new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error || new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error || new Error('IndexedDB transaction failed'));
  });

const normalizeMetadata = (record) => ({
  id: record.id,
  draftId: record.draftId,
  expenseId: record.expenseId,
  fileName: record.fileName,
  fileSize: record.fileSize,
  contentType: record.contentType,
  lastModified: record.lastModified,
});

const getBaseDirectoryHandle = async ({ create = true } = {}) => {
  const root = await openFileSystemRoot();
  if (!root) return null;
  try {
    return await root.getDirectoryHandle(FS_ROOT_DIRECTORY, { create });
  } catch (error) {
    if (!create && (error?.name === 'NotFoundError' || error?.code === 8)) {
      return null;
    }
    console.warn('Unable to access receipt storage directory', error);
    if (create) throw error;
    return null;
  }
};

const getDraftDirectoryHandle = async (draftId, { create = true } = {}) => {
  const base = await getBaseDirectoryHandle({ create });
  if (!base) return null;
  try {
    return await base.getDirectoryHandle(draftId, { create });
  } catch (error) {
    if (!create && (error?.name === 'NotFoundError' || error?.code === 8)) {
      return null;
    }
    console.warn('Unable to access draft receipt directory', error);
    if (create) throw error;
    return null;
  }
};

const getExpenseDirectoryHandle = async (draftId, expenseId, { create = true } = {}) => {
  const draftDir = await getDraftDirectoryHandle(draftId, { create });
  if (!draftDir) return null;
  try {
    return await draftDir.getDirectoryHandle(expenseId, { create });
  } catch (error) {
    if (!create && (error?.name === 'NotFoundError' || error?.code === 8)) {
      return null;
    }
    console.warn('Unable to access expense receipt directory', error);
    if (create) throw error;
    return null;
  }
};

const removeDirectory = async (parent, name) => {
  if (!parent || !parent.removeEntry) return;
  try {
    await parent.removeEntry(name, { recursive: true });
  } catch (error) {
    if (error?.name !== 'NotFoundError' && error?.code !== 8) {
      console.warn('Unable to remove receipt storage directory', error);
    }
  }
};

const removeExpenseDirectory = async (draftId, expenseId) => {
  const draftDir = await getDraftDirectoryHandle(draftId, { create: false });
  if (!draftDir) return;
  await removeDirectory(draftDir, expenseId);
};

const removeDraftDirectory = async (draftId) => {
  const base = await getBaseDirectoryHandle({ create: false });
  if (!base) return;
  await removeDirectory(base, draftId);
};

const removeBaseDirectory = async () => {
  const root = await openFileSystemRoot();
  if (!root) return;
  await removeDirectory(root, FS_ROOT_DIRECTORY);
};

const writeMetadataFile = async (expenseDir, metadata) => {
  if (!expenseDir?.getFileHandle) return;
  const handle = await expenseDir.getFileHandle('__metadata.json', { create: true });
  const writable = await handle.createWritable();
  await writable.write(JSON.stringify(metadata));
  await writable.close();
};

const readMetadataFile = async (expenseDir) => {
  if (!expenseDir?.getFileHandle) return [];
  try {
    const handle = await expenseDir.getFileHandle('__metadata.json');
    const file = await handle.getFile();
    const text = await file.text();
    const parsed = JSON.parse(text);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    if (error?.name !== 'NotFoundError' && error?.code !== 8) {
      console.warn('Unable to read receipt metadata file', error);
    }
    return [];
  }
};

const buildMetadataRecord = (draftId, expenseId, file, id) => ({
  id,
  draftId,
  expenseId,
  fileName: file.name || 'receipt',
  fileSize: typeof file.size === 'number' ? file.size : 0,
  contentType: file.type || 'application/octet-stream',
  lastModified: typeof file.lastModified === 'number' ? file.lastModified : Date.now(),
});

const writeFileToHandle = async (directory, fileName, blob) => {
  const handle = await directory.getFileHandle(fileName, { create: true });
  const writable = await handle.createWritable();
  await writable.write(blob);
  await writable.close();
};

const saveReceiptsToFileSystem = async (draftId, expenseId, files = []) => {
  await removeExpenseDirectory(draftId, expenseId);
  const expenseDir = await getExpenseDirectoryHandle(draftId, expenseId, { create: true });
  if (!expenseDir) {
    throw new Error('Receipt storage is unavailable in this environment.');
  }

  const metadata = [];
  for (const file of files) {
    const id = uuid();
    const record = buildMetadataRecord(draftId, expenseId, file, id);
    await writeFileToHandle(expenseDir, id, file);
    metadata.push(record);
  }

  await writeMetadataFile(expenseDir, metadata);
  return metadata.map((record) => normalizeMetadata(record));
};

const listReceiptMetadataFromFileSystem = async (draftId) => {
  const map = new Map();
  const draftDir = await getDraftDirectoryHandle(draftId, { create: false });
  if (!draftDir?.entries) return map;

  // eslint-disable-next-line no-restricted-syntax
  for await (const [name, handle] of draftDir.entries()) {
    if (handle.kind !== 'directory') continue;
    const metadata = await readMetadataFile(handle);
    if (!Array.isArray(metadata) || !metadata.length) continue;
    map.set(
      name,
      metadata
        .filter((item) => item?.id)
        .map((item) => normalizeMetadata({ ...item, draftId, expenseId: name }))
    );
  }

  return map;
};

const getStoredReceiptsFromFileSystem = async (draftId, expenseId, receiptIds) => {
  const expenseDir = await getExpenseDirectoryHandle(draftId, expenseId, { create: false });
  if (!expenseDir) return [];

  const ids = Array.isArray(receiptIds) && receiptIds.length ? receiptIds : null;
  const metadata = await readMetadataFile(expenseDir);
  const filtered = metadata.filter((item) => item?.id && (ids ? ids.includes(item.id) : true));
  const results = [];
  for (const item of filtered) {
    try {
      const fileHandle = await expenseDir.getFileHandle(item.id);
      const blob = await fileHandle.getFile();
      results.push({ metadata: normalizeMetadata({ ...item, draftId, expenseId }), blob });
    } catch (error) {
      console.warn('Unable to read stored receipt from file system', error);
    }
  }
  return results;
};

const deleteReceiptsFromFileSystem = async (draftId, expenseId, receiptIds) => {
  const ids = Array.isArray(receiptIds) && receiptIds.length ? receiptIds : null;
  if (!ids) {
    await removeExpenseDirectory(draftId, expenseId);
    return;
  }

  const expenseDir = await getExpenseDirectoryHandle(draftId, expenseId, { create: false });
  if (!expenseDir) return;

  const metadata = await readMetadataFile(expenseDir);
  const remaining = metadata.filter((item) => item && !ids.includes(item.id));

  for (const id of ids) {
    try {
      await expenseDir.removeEntry(id);
    } catch (error) {
      if (error?.name !== 'NotFoundError' && error?.code !== 8) {
        console.warn('Unable to delete stored receipt file', error);
      }
    }
  }

  if (!remaining.length) {
    await removeExpenseDirectory(draftId, expenseId);
    return;
  }

  await writeMetadataFile(expenseDir, remaining);
};

const clearReceiptsForDraftFileSystem = async (draftId) => {
  await removeDraftDirectory(draftId);
};

const ensureDraftAndExpense = (draftId, expenseId) => {
  if (!draftId) {
    throw new Error('A draft identifier is required to store receipts.');
  }
  if (!expenseId) {
    throw new Error('An expense identifier is required to store receipts.');
  }
};

export const isReceiptStorageAvailable = () => hasIndexedDb() || hasFileSystemAccess();

export const saveReceiptsForExpense = async (draftId, expenseId, files = []) => {
  ensureDraftAndExpense(draftId, expenseId);
  if (!files.length) return [];

  const db = await openIndexedDb();
  if (!db) {
    if (hasFileSystemAccess()) {
      return saveReceiptsToFileSystem(draftId, expenseId, files);
    }
    throw new Error('Receipt storage is unavailable in this environment.');
  }

  const metadata = [];
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(INDEX_NAME);
  const range = IDBKeyRange.only([draftId, expenseId]);
  const keys = await requestToPromise(index.getAllKeys(range));
  keys.forEach((key) => store.delete(key));

  files.forEach((file) => {
    const id = uuid();
    const record = { ...buildMetadataRecord(draftId, expenseId, file, id), blob: file };
    store.put(record);
    metadata.push(normalizeMetadata(record));
  });

  await transactionDone(tx);
  return metadata;
};

export const listReceiptMetadataForDraft = async (draftId) => {
  if (!draftId) return new Map();
  const db = await openIndexedDb();
  if (!db) {
    if (hasFileSystemAccess()) {
      return listReceiptMetadataFromFileSystem(draftId);
    }
    return new Map();
  }

  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(INDEX_NAME);
  const lower = IDBKeyRange.bound([draftId, ''], [draftId, '\uffff']);
  const records = await requestToPromise(index.getAll(lower));
  await transactionDone(tx);

  const map = new Map();
  records
    .filter(Boolean)
    .forEach((record) => {
      const meta = normalizeMetadata(record);
      const list = map.get(meta.expenseId) || [];
      list.push(meta);
      map.set(meta.expenseId, list);
    });
  return map;
};

export const getStoredReceipts = async (draftId, expenseId, receiptIds) => {
  ensureDraftAndExpense(draftId, expenseId);
  const db = await openIndexedDb();
  if (!db) {
    if (hasFileSystemAccess()) {
      return getStoredReceiptsFromFileSystem(draftId, expenseId, receiptIds);
    }
    return [];
  }

  const ids = Array.isArray(receiptIds) && receiptIds.length ? receiptIds : null;
  const tx = db.transaction(STORE_NAME, 'readonly');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(INDEX_NAME);
  const range = IDBKeyRange.only([draftId, expenseId]);
  const records = await requestToPromise(index.getAll(range));
  await transactionDone(tx);

  return records
    .filter((record) => (ids ? ids.includes(record.id) : true))
    .map((record) => ({ metadata: normalizeMetadata(record), blob: record.blob }));
};

export const deleteReceipts = async (draftId, expenseId, receiptIds) => {
  ensureDraftAndExpense(draftId, expenseId);
  const db = await openIndexedDb();
  if (!db) {
    if (hasFileSystemAccess()) {
      await deleteReceiptsFromFileSystem(draftId, expenseId, receiptIds);
    }
    return;
  }

  const ids = Array.isArray(receiptIds) && receiptIds.length ? receiptIds : null;
  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  if (ids) {
    ids.forEach((id) => store.delete(id));
  } else {
    const index = store.index(INDEX_NAME);
    const range = IDBKeyRange.only([draftId, expenseId]);
    const keys = await requestToPromise(index.getAllKeys(range));
    keys.forEach((key) => store.delete(key));
  }
  await transactionDone(tx);
};

export const clearReceiptsForDraft = async (draftId) => {
  if (!draftId) return;
  const db = await openIndexedDb();
  if (!db) {
    if (hasFileSystemAccess()) {
      await clearReceiptsForDraftFileSystem(draftId);
    }
    return;
  }

  const tx = db.transaction(STORE_NAME, 'readwrite');
  const store = tx.objectStore(STORE_NAME);
  const index = store.index(INDEX_NAME);
  const range = IDBKeyRange.bound([draftId, ''], [draftId, '\uffff']);
  const keys = await requestToPromise(index.getAllKeys(range));
  keys.forEach((key) => store.delete(key));
  await transactionDone(tx);
};

export const teardownReceiptStorage = async () => {
  if (hasIndexedDb()) {
    closeDatabase();
    await new Promise((resolve, reject) => {
      const request = indexedDB.deleteDatabase(DB_NAME);
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error || new Error('Unable to delete receipt storage database'));
    }).catch(() => {});
  }

  if (hasFileSystemAccess()) {
    await removeBaseDirectory();
    closeFileSystemRoot();
  }
};

export const createObjectUrlForReceipt = (blob) => {
  if (!blob || typeof URL === 'undefined' || typeof URL.createObjectURL !== 'function') return null;
  try {
    return URL.createObjectURL(blob);
  } catch (error) {
    console.warn('Unable to create object URL for receipt blob', error);
    return null;
  }
};

export const revokeObjectUrl = (url) => {
  if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
  try {
    URL.revokeObjectURL(url);
  } catch (error) {
    console.warn('Unable to revoke object URL', error);
  }
};

export default {
  saveReceiptsForExpense,
  listReceiptMetadataForDraft,
  getStoredReceipts,
  deleteReceipts,
  clearReceiptsForDraft,
  createObjectUrlForReceipt,
  revokeObjectUrl,
  teardownReceiptStorage,
  isReceiptStorageAvailable,
};
