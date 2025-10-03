import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { STORAGE_KEY } from '../src/constants.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const htmlPath = path.resolve(__dirname, '../index.html');
const htmlTemplate = fs.readFileSync(htmlPath, 'utf-8');

describe('finalizeSubmit (offline mode)', () => {
  let dom;
  let finalizeSubmit;

  beforeEach(async () => {
    vi.resetModules();
    dom = new JSDOM(htmlTemplate, { url: 'https://expenses.test/' });

    global.window = dom.window;
    global.document = dom.window.document;
    global.navigator = dom.window.navigator;

    Object.defineProperty(window, 'fetch', {
      value: vi.fn(() => Promise.resolve()),
      configurable: true,
      writable: true,
    });
    global.fetch = window.fetch;

    window.__FSI_EXPENSES_CONFIG__ = { offlineOnly: true };

    const storedState = {
      header: {
        name: 'Casey Commuter',
        email: 'casey@example.com',
        managerEmail: 'manager@example.com',
        department: 'Logistics',
        focus: '',
        purpose: '',
        je: '',
        dates: '',
        tripLength: '',
      },
      expenses: [
        {
          id: 'exp-1',
          type: 'office_supplies',
          account: '62090',
          description: 'Printer paper',
          payment: 'personal',
          amount: 25.5,
          reimbursable: 25.5,
          hasReceipt: true,
          policy: 'default',
          receipts: [],
          messages: [],
          date: '2024-01-15',
        },
      ],
      history: [],
      meta: { draftId: 'draft-123', lastSavedMode: 'draft', lastSavedAt: null },
    };

    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(storedState));

    ({ finalizeSubmit } = await import('../src/main.js'));
  });

  afterEach(() => {
    dom.window.close();
    delete global.window;
    delete global.document;
    delete global.navigator;
    delete global.fetch;
    vi.restoreAllMocks();
  });

  it('stores the finalized payload locally and skips network submission', async () => {
    await finalizeSubmit();

    expect(window.fetch).not.toHaveBeenCalled();

    const saved = window.localStorage.getItem(STORAGE_KEY);
    expect(saved).toBeTruthy();
    const parsed = JSON.parse(saved);

    expect(parsed.history).toHaveLength(1);
    const [entry] = parsed.history;
    expect(entry.offline).toBe(true);
    expect(entry.offlinePayload).toEqual(expect.any(String));

    const payload = JSON.parse(entry.offlinePayload);
    expect(payload.reportId).toBe('draft-123');
    expect(payload.expenses).toHaveLength(1);

    expect(parsed.meta.lastSavedMode).toBe('finalized-offline');

    const feedback = document.getElementById('submissionFeedback');
    expect(feedback?.textContent).toMatch(/saved locally/i);
    expect(feedback?.dataset.variant).toBe('success');
  });
});
