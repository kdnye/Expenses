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

const statusClasses = {
  success: 'success',
  error: 'error',
  info: 'info'
};

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

function setAuthenticated(user) {
  loginCard.classList.add('hidden');
  exportCard.classList.remove('hidden');
  adminUserLabel.textContent = `Signed in as ${user.username} (${user.role})`;
  hideStatus(loginStatus);
}

function setLoggedOut(message) {
  loginCard.classList.remove('hidden');
  exportCard.classList.add('hidden');
  adminUserLabel.textContent = '';
  if (message) {
    showStatus(loginStatus, message, 'info');
  } else {
    hideStatus(loginStatus);
  }
  hideStatus(exportStatus);
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

  startDateInput.value = isoStart;
  endDateInput.value = isoEnd;
}

async function fetchSession() {
  try {
    const response = await fetch('/api/admin/session', {
      credentials: 'include',
      headers: { 'accept': 'application/json' }
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
    const response = await fetch('/api/admin/login', {
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
      defaultDateRange();
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
  downloadBtn.disabled = false;

  try {
    const response = await fetch('/api/admin/logout', {
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

  const start = startDateInput.value;
  const end = endDateInput.value;

  if (!start || !end) {
    showStatus(exportStatus, 'Start and end dates are required.', 'error');
    return;
  }

  if (new Date(start) > new Date(end)) {
    showStatus(exportStatus, 'Start date must be before the end date.', 'error');
    return;
  }

  const employees = parseEmployees(employeeFilterInput.value);

  const params = new URLSearchParams({ start, end });
  for (const employee of employees) {
    params.append('employees', employee);
  }

  downloadBtn.disabled = true;
  showStatus(exportStatus, 'Preparing download…', 'info');

  try {
    const response = await fetch(`/api/admin/reports?${params.toString()}`, {
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
    downloadBtn.disabled = false;
  }
});

defaultDateRange();
fetchSession();
