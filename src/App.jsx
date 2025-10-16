import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import HeaderForm from './components/HeaderForm.jsx';
import PolicyReference from './components/PolicyReference.jsx';
import ExpensesTable from './components/ExpensesTable.jsx';
import TotalsPanel from './components/TotalsPanel.jsx';
import ReportPreview from './components/ReportPreview.jsx';
import { loadState, saveState, createFreshState } from './storage.js';
import buildReportPayload, { calculateTotals } from './reportPayload.js';
import { buildApiUrl } from './config.js';
import {
  buildPreview,
  createExpense,
  evaluateAllExpenses,
  evaluateExpense,
  mergeReceiptMetadata,
} from './logic/expenses.js';
import { formatFileSize } from './utils.js';

const SUBMIT_ENDPOINT = buildApiUrl('/api/reports');
const RECEIPT_UPLOAD_ENDPOINT = buildApiUrl('/api/receipts');
const MAX_RECEIPT_BYTES = 10 * 1024 * 1024;
const ACCEPTED_RECEIPT_TYPES = new Set(['application/pdf']);
const ACCEPTED_RECEIPT_PREFIXES = ['image/'];

const isAllowedReceiptType = (mime) => {
  if (!mime) return false;
  if (ACCEPTED_RECEIPT_TYPES.has(mime)) return true;
  return ACCEPTED_RECEIPT_PREFIXES.some((prefix) => mime.startsWith(prefix));
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

const useCopyFeedback = () => {
  const [message, setMessage] = useState('');
  const timeoutRef = useRef(null);

  const showMessage = useCallback((text) => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setMessage(text);
    timeoutRef.current = setTimeout(() => {
      setMessage('');
      timeoutRef.current = null;
    }, 3000);
  }, []);

  useEffect(() => () => timeoutRef.current && clearTimeout(timeoutRef.current), []);

  return [message, showMessage];
};

const App = () => {
  const initialState = useMemo(() => {
    const loaded = loadState();
    return { ...loaded, expenses: evaluateAllExpenses(loaded.expenses || [], loaded.header) };
  }, []);

  const [state, setState] = useState(initialState);
  const stateRef = useRef(state);
  const [submissionFeedback, setSubmissionFeedback] = useState({ message: '', variant: 'info' });
  const [submitting, setSubmitting] = useState(false);
  const [copyFeedback, showCopyFeedback] = useCopyFeedback();
  const pendingReceiptsRef = useRef(new Map());
  const [receiptStatusMap, setReceiptStatusMap] = useState({});

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const persistState = useCallback(
    (updater, options = { mode: 'draft' }) => {
      setState((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        return saveState(next, options);
      });
    },
    [],
  );

  useEffect(() => {
    if (!state.expenses.length) {
      persistState((prev) => {
        if (prev.expenses.length) return prev;
        const expense = evaluateExpense(createExpense(), prev.header);
        return { ...prev, expenses: [expense] };
      });
    }
  }, [state.expenses.length, state.header, persistState]);

  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        persistState((prev) => ({ ...prev, expenses: evaluateAllExpenses(prev.expenses, prev.header) }));
      }
    };

    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, [persistState]);

  const totals = useMemo(() => calculateTotals(state.expenses), [state.expenses]);
  const preview = useMemo(() => buildPreview(state, totals), [state, totals]);

  const setReceiptStatus = useCallback((expenseId, status) => {
    setReceiptStatusMap((prev) => {
      const next = { ...prev };
      if (!status) {
        delete next[expenseId];
      } else {
        next[expenseId] = status;
      }
      return next;
    });
  }, []);

  const getReceiptStatus = useCallback(
    (expense) => {
      const explicit = receiptStatusMap[expense.id];
      if (explicit) {
        return explicit;
      }
      const uploaded = Array.isArray(expense.receipts) ? expense.receipts.length : 0;
      if (uploaded) {
        return {
          status: 'success',
          message: uploaded === 1 ? '1 receipt uploaded' : `${uploaded} receipts uploaded`,
        };
      }
      return { status: 'info', message: 'No receipts attached' };
    },
    [receiptStatusMap],
  );

  const handleHeaderChange = useCallback(
    (key, value) => {
      persistState((prev) => {
        const header = { ...prev.header, [key]: value };
        const expenses = evaluateAllExpenses(prev.expenses, header);
        return { ...prev, header, expenses };
      });
    },
    [persistState],
  );

  const handleAddExpense = useCallback(() => {
    persistState((prev) => {
      const expense = evaluateExpense(createExpense(), prev.header);
      return { ...prev, expenses: [...prev.expenses, expense] };
    });
  }, [persistState]);

  const handleExpenseChange = useCallback(
    (id, patch) => {
      persistState((prev) => {
        const expenses = prev.expenses.map((expense) => {
          if (expense.id !== id) return expense;
          return evaluateExpense({ ...expense, ...patch }, prev.header);
        });
        return { ...prev, expenses };
      });
      if (patch.type) {
        pendingReceiptsRef.current.delete(id);
        setReceiptStatus(id, null);
      }
    },
    [persistState, setReceiptStatus],
  );

  const handleExpenseRemove = useCallback(
    (id) => {
      pendingReceiptsRef.current.delete(id);
      setReceiptStatus(id, null);
      persistState((prev) => {
        const expenses = prev.expenses.filter((expense) => expense.id !== id);
        return { ...prev, expenses };
      });
    },
    [persistState, setReceiptStatus],
  );

  const handleReceiptFiles = useCallback(
    (expenseId, files) => {
      if (!files.length) return;

      const invalidType = files.find((file) => !isAllowedReceiptType(file.type));
      if (invalidType) {
        pendingReceiptsRef.current.delete(expenseId);
        setReceiptStatus(expenseId, {
          status: 'error',
          message: `Unsupported file type: ${invalidType.type || invalidType.name}`,
        });
        return;
      }

      const oversize = files.find((file) => file.size > MAX_RECEIPT_BYTES);
      if (oversize) {
        const maxLabel = formatFileSize(MAX_RECEIPT_BYTES);
        pendingReceiptsRef.current.delete(expenseId);
        setReceiptStatus(expenseId, {
          status: 'error',
          message: `File exceeds ${maxLabel}: ${oversize.name}`,
        });
        return;
      }

      pendingReceiptsRef.current.set(expenseId, files);
      setReceiptStatus(expenseId, {
        status: 'info',
        message: files.length === 1 ? '1 receipt ready to upload' : `${files.length} receipts ready to upload`,
      });
    },
    [setReceiptStatus],
  );

  const copyPreview = useCallback(async () => {
    if (!navigator.clipboard || typeof navigator.clipboard.writeText !== 'function') {
      showCopyFeedback('Clipboard unavailable. Select the text and copy manually.');
      return;
    }

    try {
      await navigator.clipboard.writeText(preview);
      showCopyFeedback('Copied to clipboard!');
    } catch (error) {
      console.warn('Copy to clipboard failed', error);
      showCopyFeedback('Unable to copy automatically. Select and copy manually.');
    }
  }, [preview, showCopyFeedback]);

  const hasPendingReceiptUploads = useCallback(() => {
    for (const files of pendingReceiptsRef.current.values()) {
      if (Array.isArray(files) && files.length) {
        return true;
      }
    }
    return false;
  }, []);

  const uploadReceiptsForExpense = useCallback(async (expense, reportId) => {
    const files = pendingReceiptsRef.current.get(expense.id);
    if (!files?.length) return expense;

    setReceiptStatus(expense.id, {
      status: 'uploading',
      message: files.length === 1 ? 'Uploading 1 receipt…' : `Uploading ${files.length} receipts…`,
    });

    const formData = new FormData();
    formData.append('reportId', reportId);
    formData.append('expenseId', expense.id);
    files.forEach((file) => {
      formData.append('files', file, file.name);
    });

    let response;
    try {
      response = await fetch(RECEIPT_UPLOAD_ENDPOINT, {
        method: 'POST',
        headers: { accept: 'application/json' },
        body: formData,
      });
    } catch (error) {
      setReceiptStatus(expense.id, {
        status: 'error',
        message: 'Network error while uploading receipts. Try again.',
      });
      throw error;
    }

    if (!response.ok) {
      let errorMessage = `Upload failed (status ${response.status}). Check files and retry.`;
      try {
        const errorBody = await response.json();
        if (errorBody?.message) {
          errorMessage = errorBody.message;
        }
      } catch (error) {
        // ignore parse errors
      }
      setReceiptStatus(expense.id, {
        status: 'error',
        message: errorMessage,
      });
      throw new Error(`Receipt upload failed with status ${response.status}`);
    }

    let body = null;
    try {
      body = await response.json();
    } catch (error) {
      body = null;
    }

    const uploadedReceipts = Array.isArray(body?.receipts)
      ? body.receipts.map(normalizeReceiptResponse).filter(Boolean)
      : [];

    pendingReceiptsRef.current.delete(expense.id);
    const merged = mergeReceiptMetadata(expense, uploadedReceipts);

    setReceiptStatus(expense.id, {
      status: 'success',
      message:
        uploadedReceipts.length === 1
          ? 'Receipt uploaded successfully'
          : `${uploadedReceipts.length} receipts uploaded successfully`,
    });

    return merged;
  }, [setReceiptStatus]);

  const uploadPendingReceipts = useCallback(
    async (expenses, reportId) => {
      const uploadPromises = expenses.map((expense) => {
        if (pendingReceiptsRef.current.get(expense.id)?.length) {
          return uploadReceiptsForExpense(expense, reportId);
        }
        return expense;
      });

      const nextExpenses = await Promise.all(uploadPromises);

      if (nextExpenses.some((item, index) => item !== expenses[index])) {
        persistState((prev) => ({ ...prev, expenses: nextExpenses }));
      }
      return nextExpenses;
    },
    [persistState, uploadReceiptsForExpense],
  );

  const finalizeSubmit = useCallback(async () => {
    if (submitting) return;

    const currentState = stateRef.current;
    const evaluatedExpenses = evaluateAllExpenses(currentState.expenses, currentState.header);
    let workingState = saveState({ ...currentState, expenses: evaluatedExpenses });
    setState(workingState);

    const duplicate = workingState.history?.some((entry) => entry.reportId === workingState.meta?.draftId);
    if (duplicate) {
      setSubmissionFeedback({
        message: 'This report has already been submitted. Start a new report to submit again.',
        variant: 'info',
      });
      return;
    }

    const reportId = workingState.meta?.draftId;
    if (!reportId) {
      setSubmissionFeedback({
        message: 'Unable to determine report identifier. Reload and try again.',
        variant: 'error',
      });
      return;
    }

    const finalizedAt = new Date();
    setSubmitting(true);
    setSubmissionFeedback({
      message: hasPendingReceiptUploads() ? 'Uploading receipts…' : 'Preparing submission…',
      variant: 'info',
    });

    try {
      if (hasPendingReceiptUploads()) {
        const updatedExpenses = await uploadPendingReceipts(workingState.expenses, reportId);
        workingState = { ...workingState, expenses: updatedExpenses };
      }
    } catch (error) {
      console.error('Receipt upload failed', error);
      setSubmissionFeedback({
        message: 'Receipt upload failed. Check the highlighted expenses and try again.',
        variant: 'error',
      });
      setSubmitting(false);
      return;
    }

    let payload;
    try {
      payload = buildReportPayload(workingState, { reportId, finalizedAt });
    } catch (error) {
      setSubmissionFeedback({
        message: error.message || 'Unable to prepare submission. Check required fields and try again.',
        variant: 'error',
      });
      setSubmitting(false);
      return;
    }

    setSubmissionFeedback({ message: 'Submitting report…', variant: 'info' });

    try {
      const response = await fetch(SUBMIT_ENDPOINT, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(payload),
      });

      if (!response.ok) {
        const errorBody = await response.json().catch(() => null);
        const message = errorBody?.message
          ? `Submission failed: ${errorBody.message}`
          : `Submission failed with status ${response.status}. Try again.`;
        setSubmissionFeedback({ message, variant: 'error' });
        throw new Error(`Server responded with status ${response.status}`);
      }

      let responseBody = null;
      try {
        responseBody = await response.json();
      } catch (error) {
        responseBody = null;
      }

      const historyEntry = buildHistoryEntry(payload, responseBody);
      const freshState = createFreshState();
      const newExpenses = [evaluateExpense(createExpense(), freshState.header)];

      pendingReceiptsRef.current.clear();
      setReceiptStatusMap({});

      const nextState = saveState(
        {
          header: { ...freshState.header },
          expenses: newExpenses,
          history: [...(workingState.history || []), historyEntry],
          meta: { ...freshState.meta, lastSavedMode: 'finalized', lastSavedAt: new Date().toISOString() },
        },
        { mode: 'finalized' },
      );

      setState(nextState);

      const confirmationId = historyEntry.serverId
        ? `Confirmation ID: ${historyEntry.serverId}.`
        : 'Submission recorded.';
      setSubmissionFeedback({
        message: `Report submitted successfully. ${confirmationId}`,
        variant: 'success',
      });
    } catch (error) {
      console.error('Report submission failed', error);
      setSubmissionFeedback((current) =>
        current.variant === 'error'
          ? current
          : {
              message:
                'Submission failed. Check your connection and try again in a few moments. Your draft is still saved.',
              variant: 'error',
            },
      );
    } finally {
      setSubmitting(false);
    }
  }, [submitting, hasPendingReceiptUploads, uploadPendingReceipts, stateRef]);

  return (
    <>
      <header>
        <img className="logo" src="/fsi-logo.png" alt="Freight Services Inc. logo" />
        <div className="header-copy">
          <h1>Expense Report Builder</h1>
          <p className="tagline">
            Collect expenses, validate company policy, and prepare the month-end packet — even offline.
          </p>
        </div>
      </header>

      <main>
        <HeaderForm header={state.header} onChange={handleHeaderChange} />
        <PolicyReference />
        <ExpensesTable
          expenses={state.expenses}
          onAddExpense={handleAddExpense}
          onExpenseChange={handleExpenseChange}
          onExpenseRemove={handleExpenseRemove}
          onReceiptFiles={handleReceiptFiles}
          getReceiptStatus={getReceiptStatus}
        />
        <TotalsPanel totals={totals} />
        <ReportPreview
          preview={preview}
          onCopy={copyPreview}
          onSubmit={finalizeSubmit}
          copyFeedback={copyFeedback}
          submissionFeedback={submissionFeedback}
          submitting={submitting}
        />
      </main>
    </>
  );
};

export default App;
