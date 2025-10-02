import { buildApiUrl } from './config.js';

const loginForm = document.querySelector('#loginForm');
const loginCard = document.querySelector('#loginCard');
const loginStatus = document.querySelector('#loginStatus');
const loginSubmit = document.querySelector('#loginSubmit');
const exportCard = document.querySelector('#exportCard');
const exportForm = document.querySelector('#exportForm');
const downloadBtn = document.querySelector('#downloadBtn');
const exportStatus = document.querySelector('#exportStatus');
const logoutBtn = document.querySelector('#logoutBtn');
const adminUserLabel = document.querySelector('#adminUser');
const startDateInput = document.querySelector('#startDate');
const endDateInput = document.querySelector('#endDate');
const employeeFilterInput = document.querySelector('#employeeFilter');
const approvalsCard = document.querySelector('#approvalsCard');
const approvalsList = document.querySelector('#approvalsList');
const approvalsEmpty = document.querySelector('#approvalsEmpty');
const approvalsStatus = document.querySelector('#approvalsStatus');
const approvalStageSelect = document.querySelector('#approvalStage');
const approvalStatusSelect = document.querySelector('#approvalStatus');
const approvalsRefreshBtn = document.querySelector('#refreshApprovals');
const approvalsHint = document.querySelector('#approvalsHint');

const statusClasses = {
  success: 'success',
  error: 'error',
  info: 'info'
};

const financeRoles = new Set(['CFO', 'SUPER', 'FINANCE']);
const managerRoles = new Set(['MANAGER', 'ANALYST', 'CFO', 'SUPER']);
const approvalRoles = new Set([...managerRoles, ...financeRoles]);

const currencyFormatter = new Intl.NumberFormat(undefined, {
  style: 'currency',
  currency: 'USD'
});
const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short'
});

let currentUser = null;
let currentApprovalStage = 'MANAGER';
let approvalsLoading = false;

function showStatus(element, message, type = 'info') {
  element.textContent = message;
  element.classList.remove('hidden', statusClasses.success, statusClasses.error, statusClasses.info);
  element.classList.add(statusClasses[type] ?? statusClasses.info);
}

function hideStatus(element) {
  element.textContent = '';
  element.classList.add('hidden');
  element.classList.remove(statusClasses.success, statusClasses.error, statusClasses.info);
}

function safeNumber(value) {
  if (value === null || typeof value === 'undefined') return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function formatCurrencyValue(value) {
  const numberValue = safeNumber(value);
  return numberValue === null ? '—' : currencyFormatter.format(numberValue);
}

function formatDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return dateFormatter.format(date);
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return dateTimeFormatter.format(date);
}

function formatStageLabel(stage) {
  return stage === 'FINANCE' ? 'Finance approval' : 'Manager review';
}

function canActOnStage(role, stage) {
  if (!role) return false;
  return stage === 'FINANCE' ? financeRoles.has(role) : managerRoles.has(role);
}

function resetApprovalsUI() {
  if (!approvalsCard) return;
  approvalsList.innerHTML = '';
  approvalsEmpty?.classList.add('hidden');
  hideStatus(approvalsStatus);
}

function updateApprovalsHint() {
  if (!approvalsHint) return;
  approvalsHint.textContent =
    currentApprovalStage === 'FINANCE'
      ? 'Finalize reimbursements that have already cleared manager review so payroll can be scheduled.'
      : 'Review submitted reports, confirm policy compliance, and record your decision.';
}

function configureApprovalsForUser(user) {
  if (!approvalsCard || !approvalStageSelect || !approvalStatusSelect) {
    return;
  }

  resetApprovalsUI();

  const allowedStages = [];
  if (managerRoles.has(user.role)) {
    allowedStages.push('MANAGER');
  }
  if (financeRoles.has(user.role)) {
    allowedStages.push('FINANCE');
  }

  const uniqueStages = [...new Set(allowedStages)];

  approvalStageSelect.innerHTML = '';

  if (!uniqueStages.length) {
    approvalsCard.classList.add('hidden');
    return;
  }

  uniqueStages.forEach((stage) => {
    const option = document.createElement('option');
    option.value = stage;
    option.textContent = formatStageLabel(stage);
    approvalStageSelect.append(option);
  });

  approvalStageSelect.disabled = uniqueStages.length === 1;
  currentApprovalStage = uniqueStages.includes(currentApprovalStage) ? currentApprovalStage : uniqueStages[0];
  approvalStageSelect.value = currentApprovalStage;
  approvalStatusSelect.value = 'pending';
  approvalsCard.classList.remove('hidden');
  updateApprovalsHint();
  void refreshApprovals();
}

function describeDecision(decision) {
  const status = decision?.status ?? 'PENDING';
  const statusLabels = {
    PENDING: 'Pending review',
    APPROVED: 'Approved',
    REJECTED: 'Returned for updates'
  };
  const summaryParts = [statusLabels[status] ?? status];

  if (decision?.decidedBy) {
    summaryParts.push(`by ${decision.decidedBy}`);
  }

  if (decision?.decidedAt) {
    const formatted = formatDateTime(decision.decidedAt);
    if (formatted) {
      summaryParts.push(`on ${formatted}`);
    }
  }

  return {
    status,
    summary: summaryParts.join(' '),
    note: decision?.note ?? null
  };
}

function decisionBadgeClass(status) {
  if (status === 'APPROVED') return 'status-approved';
  if (status === 'REJECTED') return 'status-rejected';
  return 'status-pending';
}

function appendDecisionRow(container, label, decision) {
  const dt = document.createElement('dt');
  dt.textContent = label;
  const dd = document.createElement('dd');
  dd.textContent = decision.summary;
  if (decision.note) {
    const note = document.createElement('div');
    note.className = 'hint';
    note.textContent = `Note: ${decision.note}`;
    dd.append(note);
  }
  container.append(dt, dd);
}

function formatExpenseLine(expense) {
  const amount = formatCurrencyValue(expense.amount);
  const description = expense.description ? expense.description.trim() : 'No description provided';
  const dateLabel = formatDate(expense.incurredAt);
  return `${dateLabel} • ${expense.category} • ${amount} • ${description}`;
}

function buildApprovalItem(report) {
  const item = document.createElement('article');
  item.className = 'approval-item';
  item.dataset.reportId = report.reportId;

  const header = document.createElement('div');
  header.className = 'approval-header';

  const identity = document.createElement('div');
  const title = document.createElement('h3');
  title.textContent = report.header?.name || report.employeeEmail;
  const subtitle = document.createElement('p');
  subtitle.textContent = report.employeeEmail;
  identity.append(title, subtitle);

  const stageKey = currentApprovalStage === 'FINANCE' ? 'finance' : 'manager';
  const stageDecision = describeDecision(report.approvals?.[stageKey]);
  const badge = document.createElement('span');
  badge.className = `status-badge ${decisionBadgeClass(stageDecision.status)}`;
  const badgeLabels = {
    PENDING: 'Pending',
    APPROVED: 'Approved',
    REJECTED: 'Returned'
  };
  badge.textContent = badgeLabels[stageDecision.status] ?? stageDecision.status;

  header.append(identity, badge);
  item.append(header);

  const meta = document.createElement('dl');
  meta.className = 'approval-meta';

  const addMetaRow = (label, value) => {
    const dt = document.createElement('dt');
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.textContent = value;
    meta.append(dt, dd);
  };

  addMetaRow('Report ID', report.reportId);
  addMetaRow('Finalized on', formatDateTime(report.finalizedAt) || '—');
  addMetaRow('Manager', report.managerEmail || '—');
  addMetaRow('Total submitted', formatCurrencyValue(report.totals?.submitted));
  addMetaRow('Due to employee', formatCurrencyValue(report.totals?.employee));

  const managerDecision = describeDecision(report.approvals?.manager);
  const financeDecision = describeDecision(report.approvals?.finance);
  appendDecisionRow(meta, 'Manager decision', managerDecision);
  appendDecisionRow(meta, 'Finance decision', financeDecision);

  item.append(meta);

  const expensesDetails = document.createElement('details');
  expensesDetails.className = 'approval-expenses';
  expensesDetails.open = true;
  const summary = document.createElement('summary');
  const expenseCount = Array.isArray(report.expenses) ? report.expenses.length : 0;
  summary.textContent = `Expenses (${expenseCount})`;
  expensesDetails.append(summary);

  const list = document.createElement('ul');
  if (expenseCount === 0) {
    const li = document.createElement('li');
    li.textContent = 'No expenses submitted.';
    list.append(li);
  } else {
    report.expenses.forEach((expense) => {
      const li = document.createElement('li');
      li.textContent = formatExpenseLine(expense);
      list.append(li);
    });
  }
  expensesDetails.append(list);
  item.append(expensesDetails);

  if (currentUser && canActOnStage(currentUser.role, currentApprovalStage)) {
    if (stageDecision.status === 'PENDING') {
      const actions = document.createElement('div');
      actions.className = 'approval-actions';

      const approveBtn = document.createElement('button');
      approveBtn.type = 'button';
      approveBtn.dataset.reportId = report.reportId;
      approveBtn.dataset.approvalAction = 'approve';
      approveBtn.dataset.approvalStage = currentApprovalStage;
      approveBtn.textContent = currentApprovalStage === 'FINANCE' ? 'Approve for payroll' : 'Approve';

      const rejectBtn = document.createElement('button');
      rejectBtn.type = 'button';
      rejectBtn.dataset.reportId = report.reportId;
      rejectBtn.dataset.approvalAction = 'reject';
      rejectBtn.dataset.approvalStage = currentApprovalStage;
      rejectBtn.textContent = 'Request changes';

      actions.append(approveBtn, rejectBtn);
      item.append(actions);
    }
  }

  return item;
}

function renderApprovals(reports) {
  approvalsList.innerHTML = '';

  if (!reports.length) {
    approvalsEmpty?.classList.remove('hidden');
    return;
  }

  approvalsEmpty?.classList.add('hidden');
  reports.forEach((report) => {
    approvalsList.append(buildApprovalItem(report));
  });
}

async function refreshApprovals({ suppressStatus = false } = {}) {
  if (!approvalsCard || approvalsCard.classList.contains('hidden') || !approvalRoles.has(currentUser?.role ?? '')) {
    return;
  }

  if (approvalsLoading) {
    return;
  }

  approvalsLoading = true;

  if (!suppressStatus) {
    showStatus(approvalsStatus, 'Loading reports…', 'info');
  }

  approvalsList.innerHTML = '';
  approvalsEmpty?.classList.add('hidden');

  const params = new URLSearchParams({
    stage: currentApprovalStage,
    status: approvalStatusSelect?.value ?? 'pending'
  });

  try {
    const response = await fetch(buildApiUrl(`/api/admin/approvals?${params.toString()}`), {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = body?.message || 'Unable to load approvals.';
      showStatus(approvalsStatus, message, 'error');
      return;
    }

    const body = await response.json().catch(() => ({}));
    const reports = Array.isArray(body?.reports) ? body.reports : [];
    renderApprovals(reports);

    if (!reports.length) {
      if (!suppressStatus) {
        showStatus(approvalsStatus, 'No reports match the selected filters.', 'info');
      }
    } else {
      hideStatus(approvalsStatus);
    }
  } catch (error) {
    console.error(error);
    showStatus(approvalsStatus, 'Network error while loading approvals.', 'error');
  } finally {
    approvalsLoading = false;
  }
}

async function submitApprovalDecision(reportId, action, stage, note, triggerButton) {
  if (!reportId || !action || !stage) {
    return;
  }

  if (!canActOnStage(currentUser?.role ?? '', stage)) {
    showStatus(approvalsStatus, 'You are not authorized to act on this report.', 'error');
    return;
  }

  triggerButton?.setAttribute('disabled', 'disabled');

  const payload = { stage, action };
  if (note) {
    payload.note = note;
  }

  try {
    const response = await fetch(
      buildApiUrl(`/api/admin/approvals/${encodeURIComponent(reportId)}/decision`),
      {
        method: 'POST',
        credentials: 'include',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json'
        },
        body: JSON.stringify(payload)
      }
    );

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = body?.message || 'Unable to record your decision.';
      showStatus(approvalsStatus, message, 'error');
      return;
    }

    const successMessage =
      action === 'approve'
        ? 'Approval recorded successfully.'
        : 'Report returned to the submitter with your notes.';
    showStatus(approvalsStatus, successMessage, 'success');
    await refreshApprovals({ suppressStatus: true });
  } catch (error) {
    console.error(error);
    showStatus(approvalsStatus, 'Network error while saving your decision.', 'error');
  } finally {
    triggerButton?.removeAttribute('disabled');
  }
}

function parseEmployees(value) {
  return value
    .split(/\n|,/)
    .map((token) => token.trim().toLowerCase())
    .filter(Boolean);
}

function defaultDateRange() {
  const today = new Date();
  const start = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  const end = new Date(today);

  const isoStart = start.toISOString().slice(0, 10);
  const isoEnd = end.toISOString().slice(0, 10);

  if (startDateInput) startDateInput.value = isoStart;
  if (endDateInput) endDateInput.value = isoEnd;
}

async function fetchSession() {
  try {
    const response = await fetch(buildApiUrl('/api/admin/session'), {
      credentials: 'include',
      headers: { accept: 'application/json' }
    });

    if (!response.ok) {
      setLoggedOut();
      return;
    }

    const body = await response.json();
    if (body?.user) {
      setAuthenticated(body.user);
    } else {
      setLoggedOut();
    }
  } catch (error) {
    console.error(error);
    setLoggedOut('Unable to verify session. Please sign in again.');
  }
}

function setAuthenticated(user) {
  currentUser = user;
  loginCard.classList.add('hidden');
  adminUserLabel.textContent = `Signed in as ${user.username} (${user.role})`;
  hideStatus(loginStatus);

  if (financeRoles.has(user.role)) {
    exportCard.classList.remove('hidden');
    defaultDateRange();
  } else {
    exportCard.classList.add('hidden');
  }

  configureApprovalsForUser(user);
}

function setLoggedOut(message) {
  currentUser = null;
  currentApprovalStage = 'MANAGER';
  loginCard.classList.remove('hidden');
  exportCard.classList.add('hidden');
  approvalsCard?.classList.add('hidden');
  approvalsList.innerHTML = '';
  approvalsEmpty?.classList.add('hidden');
  if (approvalStageSelect) {
    approvalStageSelect.innerHTML = '';
    approvalStageSelect.disabled = false;
  }
  if (approvalStatusSelect) {
    approvalStatusSelect.value = 'pending';
  }
  adminUserLabel.textContent = '';
  if (message) {
    showStatus(loginStatus, message, 'info');
  } else {
    hideStatus(loginStatus);
  }
  hideStatus(exportStatus);
  hideStatus(approvalsStatus);
}

loginForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideStatus(loginStatus);

  const formData = new FormData(loginForm);
  const username = (formData.get('username') ?? '').toString().trim();
  const password = (formData.get('password') ?? '').toString();

  if (!username || !password) {
    showStatus(loginStatus, 'Username and password are required.', 'error');
    return;
  }

  loginSubmit.disabled = true;

  try {
    const response = await fetch(buildApiUrl('/api/admin/login'), {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ username, password })
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = body?.message || 'Unable to sign in.';
      showStatus(loginStatus, message, 'error');
      return;
    }

    const body = await response.json();
    if (body?.user) {
      setAuthenticated(body.user);
      loginForm.reset();
    }
  } catch (error) {
    console.error(error);
    showStatus(loginStatus, 'Unexpected error while signing in.', 'error');
  } finally {
    loginSubmit.disabled = false;
  }
});

logoutBtn?.addEventListener('click', async () => {
  hideStatus(exportStatus);
  hideStatus(approvalsStatus);
  if (downloadBtn) downloadBtn.disabled = false;

  try {
    const response = await fetch(buildApiUrl('/api/admin/logout'), {
      method: 'POST',
      credentials: 'include'
    });

    if (!response.ok && response.status !== 204) {
      showStatus(exportStatus, 'Sign out failed. Please try again.', 'error');
      return;
    }

    setLoggedOut('You have been signed out.');
  } catch (error) {
    console.error(error);
    showStatus(exportStatus, 'Network error while signing out.', 'error');
  }
});

function filenameFromHeaders(response, fallback) {
  const disposition = response.headers.get('content-disposition');
  if (!disposition) {
    return fallback;
  }

  const match = disposition.match(/filename="?([^";]+)"?/i);
  if (match?.[1]) {
    return match[1];
  }

  return fallback;
}

exportForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  hideStatus(exportStatus);

  const start = startDateInput?.value;
  const end = endDateInput?.value;

  if (!start || !end) {
    showStatus(exportStatus, 'Start and end dates are required.', 'error');
    return;
  }

  if (new Date(start) > new Date(end)) {
    showStatus(exportStatus, 'Start date must be before the end date.', 'error');
    return;
  }

  const employees = parseEmployees(employeeFilterInput?.value ?? '');

  const params = new URLSearchParams({ start, end });
  for (const employee of employees) {
    params.append('employees', employee);
  }

  if (downloadBtn) downloadBtn.disabled = true;
  showStatus(exportStatus, 'Preparing download…', 'info');

  try {
    const response = await fetch(buildApiUrl(`/api/admin/reports?${params.toString()}`), {
      method: 'GET',
      credentials: 'include'
    });

    if (!response.ok) {
      const body = await response.json().catch(() => ({}));
      const message = body?.message || 'Export failed. Check your session and filters.';
      showStatus(exportStatus, message, 'error');
      return;
    }

    const blob = await response.blob();
    const filename = filenameFromHeaders(response, `reports_${start}_${end}.zip`);

    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.append(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);

    showStatus(exportStatus, 'Export generated successfully.', 'success');
  } catch (error) {
    console.error(error);
    showStatus(exportStatus, 'Unexpected error while generating export.', 'error');
  } finally {
    if (downloadBtn) downloadBtn.disabled = false;
  }
});

approvalStageSelect?.addEventListener('change', () => {
  currentApprovalStage = approvalStageSelect.value || 'MANAGER';
  if (approvalStatusSelect) {
    approvalStatusSelect.value = 'pending';
  }
  updateApprovalsHint();
  void refreshApprovals();
});

approvalStatusSelect?.addEventListener('change', () => {
  void refreshApprovals();
});

approvalsRefreshBtn?.addEventListener('click', () => {
  void refreshApprovals();
});

approvalsList?.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const button = target.closest('button[data-approval-action]');
  if (!button) {
    return;
  }

  const reportId = button.dataset.reportId;
  const action = button.dataset.approvalAction;
  const stage = button.dataset.approvalStage;

  if (!reportId || !action || !stage) {
    return;
  }

  if (!currentUser || !canActOnStage(currentUser.role, stage)) {
    showStatus(approvalsStatus, 'You are not authorized to act on this report.', 'error');
    return;
  }

  if (action === 'approve') {
    const confirmed = window.confirm('Approve this report for the selected stage?');
    if (!confirmed) {
      return;
    }
    await submitApprovalDecision(reportId, action, stage, undefined, button);
  } else if (action === 'reject') {
    const input = window.prompt('Provide details for the submitter (optional):', '');
    if (input === null) {
      return;
    }
    const note = input.trim();
    await submitApprovalDecision(reportId, action, stage, note || undefined, button);
  }
});

defaultDateRange();
fetchSession();
