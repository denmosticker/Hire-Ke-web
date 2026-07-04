const API_BASE_URL = `${window.location.origin}/api`;
const tokenKey = 'adminToken';

let usersData = []; // Global storage for filtering
let currentStats = {}; // Global storage for PDF report
let jobTrendsChart = null;
let revenueGrowthChart = null;
let jobTrendsCharts = {};
let revenueGrowthCharts = {};
let selectedContextUserId = null;
let lastErrorTimestamp = null;
let importedOpportunities = [];
const adminReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const nativeAlert = window.alert.bind(window);

function showAdminToast(message, error = false) {
  const stack = document.getElementById('adminToastStack') || document.body.appendChild(Object.assign(document.createElement('div'), {
    id: 'adminToastStack',
    className: 'admin-toast-stack',
  }));
  const toast = document.createElement('div');
  toast.className = `admin-toast ${error ? 'is-error' : 'is-success'}`;
  toast.textContent = String(message || '');
  stack.appendChild(toast);
  window.setTimeout(() => toast.classList.add('is-leaving'), 2600);
  window.setTimeout(() => toast.remove(), 3050);
}

window.alert = (message) => showAdminToast(message, /fail|error|unable|invalid|denied/i.test(String(message || '')));

function adminSkeletonRows(count = 4) {
  return `<div class="admin-skeleton-stack">${Array.from({ length: count }, () => `
    <div class="admin-skeleton-row"><span></span><span></span><span></span></div>
  `).join('')}</div>`;
}

function setContainerLoading(id, count = 4) {
  const container = document.getElementById(id);
  if (container) container.innerHTML = adminSkeletonRows(count);
}

function animateAdminValue(id, value, formatter = (item) => Math.round(item).toLocaleString()) {
  const node = document.getElementById(id);
  if (!node) return;
  const finalValue = Number(value || 0);
  if (adminReduceMotion || node.dataset.animated === 'true') {
    node.textContent = formatter(finalValue);
    return;
  }
  node.dataset.animated = 'true';
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 820);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = formatter(finalValue * eased);
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setAdminSkeletons() {
  ['pendingRecruitersContainer', 'pendingJobsContainer', 'recentTransactionsContainer', 'usersContainer', 'allJobsContainer', 'pendingPaymentsContainer', 'approvedPaymentsContainer', 'userVerificationQueueContainer', 'importedOpportunitiesContainer', 'trustedSourcesContainer'].forEach((id) => setContainerLoading(id));
  document.querySelectorAll('.stat-value').forEach((node) => {
    node.classList.add('admin-skeleton-text');
  });
}

function clearAdminStatSkeletons() {
  document.querySelectorAll('.admin-skeleton-text').forEach((node) => node.classList.remove('admin-skeleton-text'));
}

function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  }[char]));
}

function sanitizeRecord(value) {
  if (Array.isArray(value)) return value.map(sanitizeRecord);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? escapeHTML(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeRecord(item)]));
}

// Global Exports (Ensures buttons work even if data fetch fails)
window.showAddAdminModal = () => { const m = document.getElementById('addAdminModal'); if(m) m.style.display = 'grid'; };
window.closeAddAdminModal = () => { const m = document.getElementById('addAdminModal'); if(m) m.style.display = 'none'; };
window.triggerTestEmail = typeof triggerTestEmail === 'function' ? triggerTestEmail : undefined;
window.navigateAdminPage = navigateAdminPage;

window.handleAddAdmin = handleAddAdmin;
window.approveRecruiter = approveRecruiter;
window.rejectRecruiter = rejectRecruiter;
window.approveJob = approveJob;
window.rejectJob = rejectJob;
window.deleteAdminJob = deleteAdminJob;
window.handleImportUrl = handleImportUrl;
window.handleOpportunitySubmit = handleOpportunitySubmit;
window.resetOpportunityForm = resetOpportunityForm;
window.editImportedOpportunity = editImportedOpportunity;
window.approveImportedOpportunity = approveImportedOpportunity;
window.rejectImportedOpportunity = rejectImportedOpportunity;
window.markImportedDuplicate = markImportedDuplicate;
window.deleteImportedOpportunity = deleteImportedOpportunity;
window.saveOpportunityAsApproved = saveOpportunityAsApproved;
window.handleSourceSubmit = handleSourceSubmit;
window.approvePayment = approvePayment;
window.rejectPayment = rejectPayment;
window.approveVerificationRequest = approveVerificationRequest;
window.rejectVerificationRequest = rejectVerificationRequest;
window.updateUserRole = updateUserRole;
window.exportRecentTransactions = exportRecentTransactions;
window.exportDetailedStatement = exportDetailedStatement;
window.downloadPDFReport = downloadPDFReport;
window.reconnectDB = reconnectDB;
window.clearLogs = clearLogs;
window.deleteUser = deleteUser;
window.handleBulkDelete = handleBulkDelete;
window.closeProfileModal = closeProfileModal;
window.resendAdminVerification = resendAdminVerification;
window.toggleUserSuspension = toggleUserSuspension;
window.viewUserProfile = viewUserProfile;
window.resetUserPassword = resetUserPassword;
window.changeAdminEmail = changeAdminEmail;
window.showAdminsOverview = showAdminsOverview;



function getToken() {
  return localStorage.getItem(tokenKey);
}

function saveToken(token) {
  localStorage.setItem(tokenKey, token);
}

function clearToken() {
  localStorage.removeItem(tokenKey);
}

function createAdminTable(rows, columns) {
  if (!rows || rows.length === 0) {
    return '<p class="placeholder-text">No records found.</p>';
  }

  const headerRow = `<tr>${columns.map((col) => `<th>${col}</th>`).join('')}</tr>`;
  const bodyRows = rows
    .map((row) => `<tr>${columns.map((col) => `<td>${row[col] ?? ''}</td>`).join('')}</tr>`)
    .join('');

  return `<table class="data-table">${headerRow}${bodyRows}</table>`;
}

function setPageHeading(page) {
  const pageTitle = document.getElementById('currentPageTitle');
  const pageSubtitle = document.getElementById('currentPageSubtitle');
  const titles = {
    overview: ['Dashboard Overview', "Welcome back. Here's what's happening with your platform today."],
    analytics: ['Analytics', 'Track platform growth, jobs, payments, and recruiter activity.'],
    jobs: ['Jobs Management', 'Review pending jobs and monitor all platform listings.'],
    'opportunity-importer': ['Opportunity Importer', 'Add trusted opportunities, review imports, and manage source lists.'],
    recruiters: ['Recruiters', 'Manage recruiter accounts and company verification status.'],
    users: ['Users', 'Search, inspect, update, and manage all platform users.'],
    payments: ['Payments', 'Verify M-Pesa payments and export payment statements.'],
    reports: ['Reports', 'Send daily reports and export platform summaries.'],
    verification: ['Verification', 'Approve or reject recruiter and payment verification requests.'],
    messages: ['Messages', 'Review recent platform notifications.'],
    logs: ['System Logs', 'Monitor database health and live server activity.'],
    settings: ['Settings', 'Manage admin access and platform service checks.']
  };
  const copy = titles[page] || titles.overview;
  if (pageTitle) pageTitle.textContent = copy[0];
  if (pageSubtitle) pageSubtitle.textContent = copy[1];
}

function syncContainer(sourceId, targetIds) {
  const source = document.getElementById(sourceId);
  if (!source) return;
  targetIds.forEach((id) => {
    const target = document.getElementById(id);
    if (target) target.innerHTML = source.innerHTML;
  });
}

function renderRecruitersPanel() {
  const container = document.getElementById('recruitersContainer');
  if (!container) return;
  const recruiters = (usersData || []).filter((user) => user.role === 'recruiter');
  if (!recruiters.length) {
    container.innerHTML = '<p class="placeholder-text">No recruiter accounts found.</p>';
    return;
  }
  container.innerHTML = `<table class="data-table">
    <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Status</th><th>Actions</th></tr></thead>
    <tbody>${recruiters.map((user) => `
      <tr>
        <td>${user.name || 'N/A'}</td>
        <td>${user.email}</td>
        <td>${user.company_name || 'N/A'}</td>
        <td style="text-transform: capitalize;">${user.status || 'pending'}</td>
        <td>
          <button class="btn btn-primary" onclick="viewUserProfile(${user.id})" style="min-height:30px; padding:0 10px; font-size:12px;">View</button>
          <button class="btn ${user.status === 'rejected' ? 'btn-success' : 'btn-warning'}" onclick="toggleUserSuspension(${user.id})" style="min-height:30px; padding:0 10px; font-size:12px;">${user.status === 'rejected' ? 'Activate' : 'Suspend'}</button>
        </td>
      </tr>
    `).join('')}</tbody>
  </table>`;
}

function attachUserCheckboxListeners() {
  document.querySelectorAll('.user-checkbox').forEach(cb => {
    cb.addEventListener('change', updateBulkDeleteVisibility);
  });
}

function navigateAdminPage(page) {
  const targetSection = document.getElementById(page);
  if (!targetSection) return;

  document.querySelectorAll('.page-section').forEach(section => section.classList.remove('active'));
  targetSection.classList.add('active');
  targetSection.classList.add('page-enter');
  window.setTimeout(() => targetSection.classList.remove('page-enter'), 260);
  document.querySelectorAll('.menu-link').forEach(link => {
    link.parentElement.classList.toggle('active', link.dataset.page === page);
  });
  setPageHeading(page);

  if (page === 'overview' || page === 'analytics') {
    loadStats();
    loadPendingRecruiters();
    loadPendingJobs();
  }
  if (page === 'jobs') {
    loadPendingJobs();
    loadAllJobs();
  }
  if (page === 'opportunity-importer') {
    loadImportedOpportunities();
    loadTrustedSources();
  }
  if (page === 'recruiters' || page === 'users') {
    loadUsers();
  }
  if (page === 'payments') {
    loadPendingPayments();
    loadApprovedPayments();
  }
  if (page === 'reports') {
    loadStats();
  }
  if (page === 'verification') {
    loadPendingRecruiters();
    loadPendingPayments();
    loadVerificationQueue();
  }
  if (page === 'messages') {
    loadAdminMessages();
  }
  if (page === 'logs') {
    checkServerStatus();
    fetchLogs();
  }
}

async function fetchCurrentUser() {
  const token = getToken();
  if (!token) {
    window.location.href = 'admin-login.html';
    return null;
  }

  const response = await fetch(`${API_BASE_URL}/auth/me`, {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!response.ok) {
    clearToken();
    window.location.href = 'admin-login.html';
    return null;
  }

  const user = await response.json();
  if (!user || user.role !== 'admin') {
    clearToken();
    window.location.href = 'admin-login.html';
    return null;
  }

  return user;
}

async function loginAdmin(event) {
  if (event) {
    event.preventDefault();
    event.stopPropagation();
  }

  console.log('Admin login submit fired');

  const loginError = document.getElementById('loginError');
  const submitButton = document.getElementById('admin-submit-btn');
  const submitLabel = submitButton?.querySelector('.btn-label');

  const adminEmailInput = document.getElementById('adminEmail');
  const adminPasswordInput = document.getElementById('adminPassword');

  if (loginError) loginError.textContent = '';
  const email = adminEmailInput?.value.trim();
  const password = adminPasswordInput?.value;

  if (!email || !password) {
    if (loginError) loginError.textContent = 'Please enter both email and password.';
    return;
  }

  if (submitButton) {
    submitButton.disabled = true;
    submitButton.classList.add('is-loading');
    if (submitLabel) submitLabel.textContent = 'Signing in...';
  }

  try {
    console.log('Login clicked');
    console.log('Email:', email);
    console.log('Password length:', password?.length);

    const response = await fetch(`${API_BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });

    console.log('Login response status:', response.status);


    if (!response.ok) {
      let errorData = {};
      try {
        errorData = await response.json();
      } catch (_) {
        // ignore
      }

      if (errorData.unverified) {
        if (loginError) loginError.textContent = 'Admin account not verified. Please contact support.';
        return;
      }

      const msg = errorData.error || `Login failed (${response.status}).`;
      if (loginError) loginError.textContent = msg;
      return;
    }

    const result = await response.json();
    if (!result?.user || result.user.role !== 'admin') {
      if (loginError) loginError.textContent = 'Only admin users may log in here.';
      return;
    }

    saveToken(result.token);
    window.location.href = 'admin-dashboard.html';
  } catch (error) {
    if (loginError) loginError.textContent = 'Login failed. Check server connection and try again.';
    console.error(error);
  } finally {
    if (submitButton) {
      submitButton.disabled = false;
      submitButton.classList.remove('is-loading');
      if (submitLabel) submitLabel.textContent = 'Sign in';
    }
  }
}

async function loadStats() {
  const token = getToken();
  try {
    const response = await fetch(`${API_BASE_URL}/admin/stats`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const stats = sanitizeRecord(await response.json());
    if (stats.error) throw new Error(stats.error);
    currentStats = stats;
    
    clearAdminStatSkeletons();
    animateAdminValue('statRevenue', stats.revenue || 0, (value) => `KES ${Math.round(value).toLocaleString()}`);
    animateAdminValue('statUsers', stats.totalUsers || 0);
    animateAdminValue('statRecruiters', stats.totalRecruiters || 0);
    animateAdminValue('statJobs', stats.totalJobs || 0);
    
    const activeEl = document.getElementById('statMostActive');
    if (activeEl) {
      activeEl.textContent = `${stats.mostActiveRecruiter.name} (${stats.mostActiveRecruiter.count})`;
    }
    
    initJobTrendsChart(stats.trends);
    initRevenueGrowthChart(stats.revenueTrends);
    renderRecentTransactions(stats.recentPayments);
    renderRevenueBySource(stats.revenueBySource || []);
    renderTopRecruiters(stats.topRecruiters || []);
    renderAdminBadges(stats.counts || {});
  } catch (e) { console.error(e); }
}

function renderAdminBadges(counts = {}) {
  const setBadge = (id, value) => {
    const node = document.getElementById(id);
    if (!node) return;
    const count = Number(value || 0);
    node.textContent = count;
    node.style.display = count > 0 ? 'inline-grid' : 'none';
  };
  setBadge('notificationBadge', counts.notifications);
  setBadge('verificationBadge', counts.verificationRequests);
  setBadge('pendingVerificationInlineBadge', counts.verificationRequests);
  setBadge('messagesBadge', counts.unreadMessages);
}

function renderTopRecruiters(rows = []) {
  const container = document.getElementById('topRecruitersContainer');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="placeholder-text">No recruiters found.</p>';
    return;
  }
  container.innerHTML = rows.map((row, index) => `
    <div class="list-card"><strong>${index + 1}&nbsp;&nbsp; ${escapeHTML(row.name || 'Recruiter')}</strong><span class="placeholder-text">${Number(row.count || 0)} jobs</span></div>
  `).join('');
}

function renderRevenueBySource(rows = []) {
  const container = document.getElementById('revenueBySourceContainer');
  if (!container) return;
  if (!rows.length) {
    container.innerHTML = '<p class="placeholder-text">No revenue data yet.</p>';
    return;
  }
  const colors = {
    'Job Posting': 'var(--blue)',
    'Featured Jobs': 'var(--green)',
    'Premium Packages': 'var(--amber)',
    Others: 'var(--purple)',
  };
  const stops = [];
  let cursor = 0;
  rows.forEach((row) => {
    const pct = Number(row.percentage || 0);
    const color = colors[row.source] || 'var(--purple)';
    stops.push(`${color} ${cursor}% ${Math.min(100, cursor + pct)}%`);
    cursor += pct;
  });
  container.innerHTML = `
    <div class="donut" style="background: conic-gradient(${stops.join(', ')});"></div>
    <div class="legend">
      ${rows.map((row) => `
        <div class="legend-row"><span class="legend-dot" style="background:${colors[row.source] || 'var(--purple)'};"></span><span>${escapeHTML(row.source)}</span><strong>${Number(row.percentage || 0)}%</strong></div>
      `).join('')}
    </div>
  `;
}

async function loadAdminMessages() {
  const container = document.getElementById('adminMessagesContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(3);
  try {
    const response = await fetch(`${API_BASE_URL}/messages`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const conversations = sanitizeRecord(await response.json().catch(() => []));
    if (!response.ok) throw new Error(conversations.error || 'Unable to load messages');
    if (!conversations.length) {
      container.innerHTML = '<p class="placeholder-text">No messages yet.</p>';
      return;
    }
    container.innerHTML = conversations.map((item) => `
      <div class="list-card">
        <div><strong>${item.other_name || item.other_email || 'Conversation'}</strong><p>${item.subject || item.body || 'No messages yet.'}</p></div>
        <span class="placeholder-text">${item.last_message_at ? new Date(item.last_message_at).toLocaleString() : ''}</span>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="placeholder-text">Unable to load messages.</p>';
  }
}

async function triggerTestEmail() {
  const token = getToken();
  try {
    const response = await fetch(`${API_BASE_URL}/admin/test-daily-report`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error || 'Failed to send report.');
      return;
    }
    alert(data.message || 'Report sent successfully.');
  } catch (e) {
    console.error(e);
    alert('Unable to send report. Check the server connection.');
  }
}

function renderRecentTransactions(payments = []) {
  const container = document.getElementById('recentTransactionsContainer');
  if (!container) return;

  if (payments.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No transactions recorded.</p>';
    return;
  }

  const searchTerm = document.getElementById('transactionSearch')?.value.toLowerCase() || '';
  
  const filtered = payments.filter(p => 
    (p.transaction_id && p.transaction_id.toLowerCase().includes(searchTerm)) ||
    (p.recruiter_name && p.recruiter_name.toLowerCase().includes(searchTerm))
  );

  const rows = filtered.map(p => {
    const statusColor = p.status === 'success' ? '#22c55e' : (p.status === 'pending' ? '#f59e0b' : '#ef4444');
    return `
      <tr>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">${new Date(p.created_at).toLocaleDateString()}</td>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">${p.recruiter_name || 'System'}</td>
        <td style="padding: 12px; border-bottom: 1px solid #eee;">${p.package_name || 'N/A'}</td>
        <td style="padding: 12px; border-bottom: 1px solid #eee; font-weight: bold;">KES ${p.amount}</td>
        <td style="padding: 12px; border-bottom: 1px solid #eee;"><span style="color: ${statusColor}; font-weight: 600; text-transform: capitalize;">${p.status}</span></td>
      </tr>`;
  }).join('');

  container.innerHTML = `<table class="data-table" style="width:100%;"><thead><tr><th>Date</th><th>Recruiter</th><th>Plan</th><th>Amount</th><th>Status</th></tr></thead><tbody>${rows}</tbody></table>`;
}

async function checkServerStatus() {
  const indicator = document.getElementById('serverStatusIndicator');
  const alertBanner = document.getElementById('dbDisconnectAlert');
  if (!indicator) return;
  const token = getToken();
  
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/health`, { headers: { Authorization: `Bearer ${token}` } });
    if (resp.ok) {
      indicator.className = 'status-badge status-online';
      indicator.innerHTML = '<div class="pulse pulse-online"></div> <span>DB Connected</span>';
      if (alertBanner) alertBanner.style.display = 'none';
    } else { throw new Error(); }
  } catch (e) {
    indicator.className = 'status-badge status-offline';
    indicator.innerHTML = '<div class="pulse pulse-offline"></div> <span onclick="reconnectDB()" style="cursor:pointer; text-decoration: underline;">Disconnected - Reconnect?</span>';
    if (alertBanner) alertBanner.style.display = 'flex';
  }
}

function clearLogs() {
  const terminal = document.getElementById('logTerminal');
  if (terminal) terminal.innerHTML = '<div style="color: #64748b;">Terminal cleared...</div>';
}

async function fetchLogs() {
  const terminal = document.getElementById('logTerminal');
  if (!terminal) return;
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/system-logs`, {
        headers: { Authorization: `Bearer ${getToken()}` }
    });
    const logs = sanitizeRecord(await resp.json());

    // Check for new errors to play sound
    const errorLogs = logs.filter(l => l.type === 'error');
    if (errorLogs.length > 0) {
      const latestError = errorLogs[errorLogs.length - 1];
      if (lastErrorTimestamp && latestError.timestamp > lastErrorTimestamp) {
        const sound = document.getElementById('errorNotificationSound');
        if (sound) sound.play().catch(e => console.warn('Sound blocked by browser policy until interaction.'));
      }
      lastErrorTimestamp = latestError.timestamp;
    }

    terminal.innerHTML = logs.map(l => `
        <div style="margin-bottom: 4px; color: ${l.type === 'error' ? '#f87171' : '#38bdf8'}">
            <span style="color: #64748b;">[${l.timestamp.split('T')[1].split('.')[0]}]</span> ${l.message}
        </div>
    `).join('') || 'No logs found.';
    terminal.scrollTop = terminal.scrollHeight;
  } catch (e) { terminal.innerHTML = 'Error loading logs.'; }
}
function downloadCSV(csvContent, fileName) {
  const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.setAttribute("href", url);
  link.setAttribute("download", fileName);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

function exportRecentTransactions() {
  if (!currentStats || !currentStats.recentPayments || currentStats.recentPayments.length === 0) {
    alert("No transactions available to export.");
    return;
  }
  
  const headers = ["Date", "Recruiter", "Plan", "Amount", "Status"];
  const rows = currentStats.recentPayments.map(p => [
    `"${new Date(p.created_at).toLocaleDateString()}"`,
    `"${p.recruiter_name || 'System'}"`,
    `"${p.package_name || 'N/A'}"`,
    p.amount,
    `"${p.status}"`
  ]);
  
  const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
  downloadCSV(csvContent, "hireke_recent_transactions.csv");
}

async function exportDetailedStatement() {
  const startDate = document.getElementById('statementStartDate').value;
  const endDate = document.getElementById('statementEndDate').value;
  const token = getToken();
  
  try {
    const url = new URL(`${API_BASE_URL}/admin/payments/statement`);
    if (startDate) url.searchParams.append('startDate', startDate);
    if (endDate) url.searchParams.append('endDate', endDate);
    
    const resp = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
    const payments = sanitizeRecord(await resp.json());
    
    if (!payments || payments.length === 0) {
      alert("No payment records found for the selected period.");
      return;
    }
    
    const headers = ["Timestamp", "Recruiter Name", "Recruiter Email", "Package", "Amount (KES)", "Transaction ID", "Status"];
    const rows = payments.map(p => [
      `"${new Date(p.created_at).toLocaleString()}"`,
      `"${p.recruiter_name || 'N/A'}"`,
      `"${p.recruiter_email || 'N/A'}"`,
      `"${p.package_name || 'N/A'}"`,
      p.amount,
      `"${p.transaction_id || 'N/A'}"`,
      `"${p.status}"`
    ]);
    
    const csvContent = [headers.join(","), ...rows.map(r => r.join(","))].join("\n");
    downloadCSV(csvContent, `HireKe_Statement_${startDate || 'all'}_to_${endDate || 'today'}.csv`);
  } catch (e) {
    console.error(e);
    alert("Failed to generate statement. Check connection.");
  }
}

async function reconnectDB() {
  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/reconnect-db`, { 
      method: 'POST', 
      headers: { Authorization: `Bearer ${token}` } 
    });
    if (resp.ok) { alert('Database connection re-verified successfully.'); checkServerStatus(); }
  } catch (e) { alert('Reconnection failed: ' + e.message); }
}

function initJobTrendsChart(dbTrends = []) {
  // Map the last 7 days
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    // Format label as "Mon", "Tue", etc.
    labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    const dayMatch = dbTrends.find(t => t.day === dateStr);
    data.push(dayMatch ? dayMatch.count : 0);
  }

  ['jobTrendsChart', 'jobTrendsChartAnalytics'].forEach((canvasId) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (jobTrendsCharts[canvasId]) jobTrendsCharts[canvasId].destroy();

    jobTrendsCharts[canvasId] = new Chart(ctx, {
      type: 'line',
      data: {
        labels: labels,
        datasets: [{
          label: 'New Job Postings',
          data: data,
          borderColor: '#2475ff',
          backgroundColor: 'rgba(36, 117, 255, 0.14)',
          borderWidth: 3,
          fill: true,
          tension: 0.4,
          pointRadius: 5,
          pointBackgroundColor: '#2475ff',
          pointBorderColor: '#fff',
          pointBorderWidth: 2
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: jobTrendsCharts[canvasId] ? false : { duration: adminReduceMotion ? 0 : 850, easing: 'easeOutQuart' },
        plugins: { legend: { display: false } },
        scales: {
          y: { beginAtZero: true, grid: { color: 'rgba(15, 35, 70, 0.08)' } },
          x: { grid: { display: false } }
        }
      }
    });
  });
  jobTrendsChart = jobTrendsCharts.jobTrendsChart || null;
}

function initRevenueGrowthChart(dbTrends = []) {
  const labels = [];
  const data = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date();
    date.setDate(date.getDate() - i);
    const dateStr = date.toISOString().split('T')[0];
    
    labels.push(date.toLocaleDateString('en-US', { weekday: 'short' }));
    const dayMatch = dbTrends.find(t => t.day === dateStr);
    data.push(dayMatch ? dayMatch.total : 0);
  }

  ['revenueGrowthChart', 'revenueGrowthChartAnalytics'].forEach((canvasId) => {
    const canvas = document.getElementById(canvasId);
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (revenueGrowthCharts[canvasId]) revenueGrowthCharts[canvasId].destroy();

    revenueGrowthCharts[canvasId] = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [{
          label: 'Daily Revenue (KES)',
          data: data,
          backgroundColor: 'rgba(19, 185, 129, 0.86)',
          borderColor: '#13b981',
          borderWidth: 1,
          borderRadius: 5
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: revenueGrowthCharts[canvasId] ? false : { duration: adminReduceMotion ? 0 : 850, easing: 'easeOutQuart' },
        plugins: { legend: { display: false } },
        scales: {
          y: {
              beginAtZero: true,
              grid: { color: 'rgba(15, 35, 70, 0.08)' },
              ticks: { callback: (val) => 'KES ' + val.toLocaleString() }
          },
          x: { grid: { display: false } }
        },
      }
    });
  });
  revenueGrowthChart = revenueGrowthCharts.revenueGrowthChart || null;
}

function setupContextMenu() {
  const menu = document.getElementById('userContextMenu');
  const usersContainer = document.getElementById('usersContainer');
  if (!menu || !usersContainer) return;
  
  // Close menu on normal click
  document.addEventListener('click', () => { menu.style.display = 'none'; });

  const resetBtn = document.getElementById('ctxResetPassword');
  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (selectedContextUserId) resetUserPassword(selectedContextUserId);
    });
  }

  const viewBtn = document.getElementById('ctxViewProfile');
  if (viewBtn) {
    viewBtn.addEventListener('click', () => {
      if (selectedContextUserId) viewUserProfile(selectedContextUserId);
    });
  }

  const suspendBtn = document.getElementById('ctxSuspendUser');
  if (suspendBtn) {
    suspendBtn.addEventListener('click', () => {
      if (selectedContextUserId) toggleUserSuspension(selectedContextUserId);
    });
  }

  // Intercept right-clicks on the user container
  usersContainer.addEventListener('contextmenu', (e) => {
    const row = e.target.closest('tr');
    if (row) {
      const checkbox = row.querySelector('.user-checkbox');
      if (checkbox) {
        e.preventDefault();
        selectedContextUserId = checkbox.dataset.id;
        menu.style.display = 'block';
        menu.style.left = `${e.pageX}px`;
        menu.style.top = `${e.pageY}px`;
      }
    }
  });
}

function setupMenuNavigation() {
  const menuLinks = document.querySelectorAll('.menu-link');

  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      navigateAdminPage(link.dataset.page);
    });
  });
}

function setImportStatus(message, type = 'info') {
  const box = document.getElementById('importStatus');
  if (!box) return;
  box.style.display = message ? 'block' : 'none';
  box.className = `notice ${type === 'warning' ? 'warning' : ''}`;
  box.textContent = message || '';
}

function opportunityFormData() {
  const method = document.getElementById('oppApplicationMethod')?.value || 'external_website';
  const target = document.getElementById('oppApplicationTarget')?.value.trim() || '';
  return {
    title: document.getElementById('oppTitle')?.value.trim(),
    organization: document.getElementById('oppOrganization')?.value.trim(),
    category: document.getElementById('oppCategory')?.value || 'Jobs',
    location: document.getElementById('oppLocation')?.value.trim(),
    deadline: document.getElementById('oppDeadline')?.value || null,
    description: document.getElementById('oppDescription')?.value.trim(),
    requirements: document.getElementById('oppRequirements')?.value,
    application_method: method,
    application_url: method === 'external_website' ? target : '',
    application_email: method === 'email' ? target : '',
    application_whatsapp: method === 'whatsapp' ? target : '',
    application_target: target,
    source_url: document.getElementById('oppSourceUrl')?.value.trim(),
    source_name: document.getElementById('oppSourceName')?.value.trim(),
    source_type: document.getElementById('oppSourceType')?.value.trim(),
    is_verified: document.getElementById('oppVerified')?.value === '1',
    status: document.getElementById('oppStatus')?.value || 'pending_review',
    imported_from_url: Boolean(document.getElementById('oppSourceUrl')?.value.trim()),
    overrideDuplicate: document.getElementById('opportunityOverrideDuplicate')?.value === '1',
  };
}

function fillOpportunityForm(data = {}) {
  const setVal = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.value = value ?? '';
  };
  setVal('opportunityId', data.id || '');
  setVal('opportunityOverrideDuplicate', '0');
  setVal('oppTitle', data.title || '');
  setVal('oppOrganization', data.organization || data.company_external || data.source_name || '');
  setVal('oppCategory', data.category || 'Jobs');
  setVal('oppLocation', data.location || '');
  setVal('oppDeadline', data.deadline ? String(data.deadline).slice(0, 10) : '');
  setVal('oppDescription', data.description || '');
  setVal('oppRequirements', Array.isArray(data.requirements) ? data.requirements.join('\n') : (data.requirements || ''));
  setVal('oppApplicationMethod', data.application_method || 'external_website');
  setVal('oppApplicationTarget', data.application_url || data.application_email || data.application_whatsapp || '');
  setVal('oppSourceUrl', data.source_url || '');
  setVal('oppSourceName', data.source_name || '');
  setVal('oppSourceType', data.source_type || '');
  setVal('oppVerified', data.is_verified ? '1' : '0');
  setVal('oppStatus', data.status === 'pending' ? 'pending_review' : (data.status || 'pending_review'));
  showDuplicateWarning([]);
  const badge = document.getElementById('opportunityModeBadge');
  if (badge) badge.innerHTML = `<span>${data.id ? `Editing #${data.id}` : 'New draft'}</span>`;
}

function resetOpportunityForm() {
  const form = document.getElementById('opportunityForm');
  if (form) form.reset();
  fillOpportunityForm({});
  setImportStatus('');
}

function showDuplicateWarning(duplicates = []) {
  const box = document.getElementById('duplicateWarning');
  if (!box) return;
  if (!duplicates.length) {
    box.style.display = 'none';
    box.innerHTML = '';
    return;
  }
  box.style.display = 'block';
  box.className = 'notice warning';
  box.innerHTML = `
    <strong>Possible duplicate found.</strong>
    <div style="margin-top:8px;">${duplicates.map((item) => `
      <div>#${item.id} - ${item.title || 'Untitled'} (${item.source_name || item.company_external || 'Unknown'}) ${item.deadline ? `- ${String(item.deadline).slice(0, 10)}` : ''}</div>
    `).join('')}</div>
    <button type="button" class="btn btn-warning" style="margin-top:10px;" onclick="document.getElementById('opportunityOverrideDuplicate').value='1'; handleOpportunitySubmit(event)">
      Save Anyway
    </button>
  `;
}

async function handleImportUrl() {
  const sourceUrl = document.getElementById('importSourceUrl')?.value.trim();
  if (!sourceUrl) return setImportStatus('Enter a source URL first.', 'warning');
  const button = document.getElementById('importUrlBtn');
  if (button) button.disabled = true;
  setImportStatus('Fetching source page and extracting available fields...');

  try {
    const response = await fetch(`${API_BASE_URL}/admin/opportunities/import-url`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify({ source_url: sourceUrl }),
    });
    const data = sanitizeRecord(await response.json().catch(() => ({})));
    fillOpportunityForm({ ...(data.extracted || {}), imported_from_url: 1 });
    showDuplicateWarning(data.duplicates || []);
    setImportStatus(data.message || data.error || 'Extraction finished. Review before saving.', data.success ? 'info' : 'warning');
  } catch (e) {
    console.error(e);
    fillOpportunityForm({ source_url: sourceUrl, application_url: sourceUrl });
    setImportStatus('Could not extract this URL. Complete the form manually.', 'warning');
  } finally {
    if (button) button.disabled = false;
  }
}

async function submitOpportunity(body) {
  const id = document.getElementById('opportunityId')?.value;
  const url = id ? `${API_BASE_URL}/admin/opportunities/${id}` : `${API_BASE_URL}/admin/opportunities/manual`;
  const response = await fetch(url, {
    method: id ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
    body: JSON.stringify(body),
  });
  const data = sanitizeRecord(await response.json().catch(() => ({})));
  if (response.status === 409) {
    showDuplicateWarning(data.duplicates || []);
    throw new Error(data.error || 'Possible duplicate found.');
  }
  if (!response.ok) throw new Error(data.error || 'Unable to save opportunity.');
  return data;
}

async function handleOpportunitySubmit(event) {
  if (event?.preventDefault) event.preventDefault();
  const body = opportunityFormData();
  if (!body.title || !body.organization || !body.location || !body.description) {
    return setImportStatus('Complete title, organization, location, and description before saving.', 'warning');
  }

  try {
    const data = await submitOpportunity(body);
    setImportStatus(data.message || 'Opportunity saved.');
    resetOpportunityForm();
    await loadImportedOpportunities();
    await loadAllJobs();
  } catch (e) {
    setImportStatus(e.message, 'warning');
  }
}

async function saveOpportunityAsApproved() {
  const status = document.getElementById('oppStatus');
  if (status) status.value = 'approved';
  await handleOpportunitySubmit(new Event('submit'));
}

async function loadImportedOpportunities() {
  const container = document.getElementById('importedOpportunitiesContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(5);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/opportunities/pending`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const rows = sanitizeRecord(await response.json().catch(() => []));
    if (!response.ok) throw new Error(rows.error || 'Unable to load imported opportunities.');
    importedOpportunities = rows;
    if (!rows.length) {
      container.innerHTML = '<p class="placeholder-text">No imported opportunities yet.</p>';
      return;
    }

    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Opportunity</th><th>Category</th><th>Status</th><th>Source</th><th>Actions</th></tr></thead>
      <tbody>${rows.map((item) => `
        <tr>
          <td><strong>${item.title}</strong><br><span class="placeholder-text">${item.organization || item.source_name || 'Unknown'} - ${item.location || 'No location'}</span></td>
          <td>${item.category || 'Jobs'}<br><span class="placeholder-text">${item.deadline ? String(item.deadline).slice(0, 10) : 'No deadline'}</span></td>
          <td style="text-transform:capitalize;">${String(item.status || '').replace('_', ' ')}</td>
          <td>${item.source_url ? `<a class="source-link" href="${item.source_url}" target="_blank" rel="noopener">${item.source_name || 'Source'}</a>` : 'Manual'}</td>
          <td>
            <div class="action-buttons">
              <button class="btn btn-secondary" onclick="editImportedOpportunity(${item.id})">Edit</button>
              <button class="approve-btn" onclick="approveImportedOpportunity(${item.id})">Approve</button>
              <button class="reject-btn" onclick="rejectImportedOpportunity(${item.id})">Reject</button>
              <button class="btn btn-warning" onclick="markImportedDuplicate(${item.id})">Duplicate</button>
              <button class="btn btn-danger" onclick="deleteImportedOpportunity(${item.id})">Delete</button>
            </div>
          </td>
        </tr>
      `).join('')}</tbody></table>`;
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="placeholder-text">Unable to load imported opportunities.</p>';
  }
}

function editImportedOpportunity(id) {
  const item = importedOpportunities.find((row) => String(row.id) === String(id));
  if (!item) return;
  fillOpportunityForm(item);
  document.getElementById('opportunityForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function opportunityAction(id, action, confirmText) {
  if (confirmText && !confirm(confirmText)) return;
  try {
    const response = await fetch(`${API_BASE_URL}/admin/opportunities/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Action failed.');
    setImportStatus(data.message || 'Opportunity updated.');
    await loadImportedOpportunities();
    await loadAllJobs();
    await loadStats();
  } catch (e) {
    setImportStatus(e.message, 'warning');
  }
}

function approveImportedOpportunity(id) {
  return opportunityAction(id, 'approve', 'Approve and publish this opportunity?');
}

function rejectImportedOpportunity(id) {
  return opportunityAction(id, 'reject', 'Reject this opportunity?');
}

function markImportedDuplicate(id) {
  return opportunityAction(id, 'duplicate', 'Mark this opportunity as a duplicate?');
}

async function deleteImportedOpportunity(id) {
  if (!confirm('Delete this imported opportunity?')) return;
  try {
    const response = await fetch(`${API_BASE_URL}/admin/opportunities/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Delete failed.');
    setImportStatus(data.message || 'Opportunity deleted.');
    await loadImportedOpportunities();
    await loadAllJobs();
  } catch (e) {
    setImportStatus(e.message, 'warning');
  }
}

async function loadTrustedSources() {
  const container = document.getElementById('trustedSourcesContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(3);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/sources`, {
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const sources = sanitizeRecord(await response.json().catch(() => []));
    if (!response.ok) throw new Error(sources.error || 'Unable to load sources.');
    if (!sources.length) {
      container.innerHTML = '<p class="placeholder-text">No trusted sources saved.</p>';
      return;
    }
    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Name</th><th>Type</th><th>Status</th></tr></thead>
      <tbody>${sources.map((source) => `
        <tr>
          <td><a class="source-link" href="${source.url}" target="_blank" rel="noopener">${source.name}</a><br><span class="placeholder-text">${source.category || 'General'}${source.last_imported_at ? ` - Imported ${new Date(source.last_imported_at).toLocaleDateString()}` : ''}</span></td>
          <td>${source.type || 'Website'}</td>
          <td>${source.is_active ? 'Active' : 'Inactive'}</td>
        </tr>
      `).join('')}</tbody></table>`;
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="placeholder-text">Unable to load trusted sources.</p>';
  }
}

async function handleSourceSubmit(event) {
  event.preventDefault();
  const body = {
    name: document.getElementById('sourceName')?.value.trim(),
    url: document.getElementById('sourceUrl')?.value.trim(),
    type: document.getElementById('sourceType')?.value.trim(),
    category: document.getElementById('sourceCategory')?.value.trim(),
    is_active: document.getElementById('sourceActive')?.value === '1',
  };
  try {
    const response = await fetch(`${API_BASE_URL}/admin/sources`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to save source.');
    document.getElementById('sourceForm')?.reset();
    setImportStatus(data.message || 'Trusted source saved.');
    loadTrustedSources();
  } catch (e) {
    setImportStatus(e.message, 'warning');
  }
}

async function loadPendingPayments() {
  const token = getToken();
  const container = document.getElementById('pendingPaymentsContainer');
  if (container) container.innerHTML = adminSkeletonRows(3);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/pending-payments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payments = sanitizeRecord(await response.json());

    if (payments.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No pending payments to verify.</p>';
      syncContainer('pendingPaymentsContainer', ['pendingPaymentsContainerVerification']);
      return;
    }

    container.innerHTML = payments.map(p => `
      <div class="list-card" style="border-left: 4px solid #f59e0b;">
        <div>
          <strong>Code: ${p.transaction_id}</strong>
          <p>Package: ${p.package_name} (KES ${p.amount})</p>
          <p>Recruiter: ${p.recruiter_name} (${p.recruiter_email})</p>
          <p style="font-size: 11px;">Submitted: ${new Date(p.created_at).toLocaleString()}</p>
        </div>
        <div class="action-buttons">
          <button class="approve-btn" onclick="approvePayment(${p.id})">Verify & Approve</button>
          <button class="reject-btn" onclick="rejectPayment(${p.id})" style="background-color: #ef4444;">Reject</button>
        </div>
      </div>
    `).join('');
    syncContainer('pendingPaymentsContainer', ['pendingPaymentsContainerVerification']);
  } catch (e) { console.error(e); }
}

async function loadApprovedPayments() {
  const token = getToken();
  const container = document.getElementById('approvedPaymentsContainer');
  if (container) container.innerHTML = adminSkeletonRows(4);
  try {
    const response = await fetch(`${API_BASE_URL}/admin/approved-payments`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const payments = sanitizeRecord(await response.json());

    if (payments.length === 0) {
      container.innerHTML = '<p class="placeholder-text">No approved payments found.</p>';
      return;
    }

    container.innerHTML = `<table class="data-table">
      <thead><tr><th>Date</th><th>Recruiter</th><th>Package</th><th>Amount</th><th>M-Pesa Code</th></tr></thead>
      <tbody>${payments.map(p => `
        <tr>
          <td>${new Date(p.created_at).toLocaleDateString()}</td>
          <td>${p.recruiter_name || p.recruiter_email}</td>
          <td>${p.package_name}</td>
          <td>KES ${p.amount}</td>
          <td style="font-family: monospace; font-weight: bold; color: #22c55e;">${p.transaction_id}</td>
        </tr>`).join('')}</tbody></table>`;
  } catch (e) { console.error(e); }
}

async function approvePayment(id) {
  if (!confirm('Have you confirmed this code on your M-Pesa statement?')) return;
  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/approve-payment/${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      alert('Payment approved! Recruiter account upgraded.');
      loadPendingPayments();
      loadStats();
      loadUsers();
    }
  } catch (e) { alert('Error approving payment'); }
}

async function rejectPayment(id) {
  if (!confirm('Are you sure you want to reject this payment? The recruiter will need to submit a new code.')) return;
  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/reject-payment/${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      alert('Payment rejected.');
      loadPendingPayments();
    }
  } catch (e) { alert('Error rejecting payment'); }
}

async function loadVerificationQueue() {
  const token = getToken();
  const container = document.getElementById('userVerificationQueueContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(3);

  try {
    const response = await fetch(`${API_BASE_URL}/admin/verification-queue`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const requests = sanitizeRecord(await response.json());
    if (!response.ok) throw new Error(requests.error || 'Unable to load verification queue');

    if (!requests.length) {
      container.innerHTML = '<p class="placeholder-text">No user verification requests pending.</p>';
      return;
    }

    container.innerHTML = requests.map((request) => `
      <div class="list-card" style="border-left: 4px solid #2475ff;">
        <div>
          <strong>${request.name || request.email}</strong>
          <p>${request.email} - ${request.role}</p>
          <p>Plan: ${request.plan_code} | Requested: ${request.level_requested || 'L1'} | Amount: KES ${request.amount || 0}</p>
          <p>Payment: ${request.payment_status || (Number(request.amount || 0) === 0 ? 'free' : 'pending')}</p>
          <p style="font-size: 11px;">Submitted: ${new Date(request.submitted_at).toLocaleString()}</p>
        </div>
        <div class="action-buttons">
          <select id="verificationLevel${request.id}" class="field input" style="min-height:32px; padding:0 8px;">
            <option value="L1" ${request.level_requested === 'L1' ? 'selected' : ''}>L1</option>
            <option value="L2" ${request.level_requested === 'L2' ? 'selected' : ''}>L2</option>
            <option value="L3" ${request.level_requested === 'L3' ? 'selected' : ''}>L3</option>
          </select>
          <button class="approve-btn" onclick="approveVerificationRequest(${request.id})">Approve</button>
          <button class="reject-btn" onclick="rejectVerificationRequest(${request.id})">Reject</button>
        </div>
      </div>
    `).join('');
  } catch (e) {
    console.error(e);
    container.innerHTML = '<p class="placeholder-text">Unable to load user verification requests.</p>';
  }
}

async function approveVerificationRequest(id) {
  const level = document.getElementById(`verificationLevel${id}`)?.value || 'L1';
  if (!confirm(`Approve this verification as ${level}?`)) return;
  const token = getToken();

  try {
    const response = await fetch(`${API_BASE_URL}/admin/verification-requests/${id}/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ level }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Approval failed');
    alert(data.message || 'Verification approved.');
    loadVerificationQueue();
    loadUsers();
  } catch (e) {
    alert(e.message || 'Error approving verification.');
  }
}

async function rejectVerificationRequest(id) {
  const reason = prompt('Reason for rejection:') || 'Rejected by admin';
  const token = getToken();

  try {
    const response = await fetch(`${API_BASE_URL}/admin/verification-requests/${id}/reject`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ reason }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Rejection failed');
    alert(data.message || 'Verification rejected.');
    loadVerificationQueue();
    loadUsers();
  } catch (e) {
    alert(e.message || 'Error rejecting verification.');
  }
}

async function approveRecruiter(id) {
  if (!confirm('Approve this recruiter?')) return;
  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/approve-recruiter/${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      alert('Recruiter approved successfully.');
      await loadPendingRecruiters();
      await loadUsers();
      await loadStats();
    } else {
      alert('Failed to approve recruiter.');
    }
  } catch (e) {
    console.error('Error connecting to server:', e);
    alert('Connection error. Please ensure the server is running.');
  }
}

async function rejectRecruiter(id) {
  if (!confirm('Reject this recruiter?')) return;
  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/reject-recruiter/${id}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (resp.ok) {
      alert('Recruiter rejected.');
      await loadPendingRecruiters();
    }
  } catch (e) { alert('Error rejecting recruiter.'); }
}

async function loadPendingRecruiters() {
  const token = getToken();
  const container = document.getElementById('pendingRecruitersContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(3);
  const response = await fetch(`${API_BASE_URL}/admin/pending-recruiters`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    container.innerHTML = '<p class="placeholder-text">Unable to load recruiters.</p>';
    return;
  }

  const recruiters = sanitizeRecord(await response.json());
  if (recruiters.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No pending recruiters.</p>';
    syncContainer('pendingRecruitersContainer', ['pendingRecruitersContainerVerification']);
    return;
  }

  container.innerHTML = recruiters
    .map((recruiter) => `
      <div class="list-card">
        <div>
          <strong>${recruiter.name}</strong>
          <p>${recruiter.email}</p>
          <p>${recruiter.company_name || 'No company name'}</p>
        </div>
        <div class="action-buttons">
          <button class="approve-btn" onclick="approveRecruiter(${recruiter.id})">Approve</button>
          <button class="reject-btn" onclick="rejectRecruiter(${recruiter.id})">Reject</button>
        </div>
      </div>
    `)
    .join('');
  syncContainer('pendingRecruitersContainer', ['pendingRecruitersContainerVerification']);
}

async function loadPendingJobs() {
  const token = getToken();
  const container = document.getElementById('pendingJobsContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(3);
  const response = await fetch(`${API_BASE_URL}/admin/pending-jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    container.innerHTML = '<p class="placeholder-text">Unable to load pending jobs.</p>';
    return;
  }

  const jobs = sanitizeRecord(await response.json());
  if (jobs.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No pending jobs.</p>';
    syncContainer('pendingJobsContainer', ['pendingJobsContainerJobs']);
    return;
  }

  container.innerHTML = jobs
    .map((job) => `
      <div class="list-card">
        <div>
          <strong>${job.title}</strong>
          <p>${job.company_name || 'Unknown company'}</p>
          <p>${job.location}</p>
          <p>Status: ${job.status}</p>
        </div>
        <div class="action-buttons">
          <button class="approve-btn" onclick="approveJob(${job.id})">Approve</button>
          <button class="reject-btn" onclick="rejectJob(${job.id})">Reject</button>
        </div>
      </div>
    `)
    .join('');
  syncContainer('pendingJobsContainer', ['pendingJobsContainerJobs']);
}

async function loadAllJobs() {
  const token = getToken();
  const container = document.getElementById('allJobsContainer');
  if (!container) return;
  container.innerHTML = adminSkeletonRows(4);
  const response = await fetch(`${API_BASE_URL}/admin/jobs`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    container.innerHTML = '<p class="placeholder-text">Unable to load jobs.</p>';
    return;
  }

  const jobs = sanitizeRecord(await response.json());
  if (jobs.length === 0) {
    container.innerHTML = '<p class="placeholder-text">No jobs found.</p>';
    return;
  }

  container.innerHTML = jobs
    .map((job) => `
      <div class="list-card">
        <div>
          <strong>${job.title}</strong>
          <p>${job.company_name || 'Unknown company'}</p>
          <p>${job.location} • ${job.status}</p>
          <p>Posted by: ${job.recruiter_name || 'N/A'}</p>
        </div>
        <div class="action-buttons">
          <button class="btn btn-danger" onclick="deleteAdminJob(${job.id})">Delete / Archive</button>
        </div>
      </div>
    `)
    .join('');
}

async function approveJob(id) {
  const token = getToken();
  await fetch(`${API_BASE_URL}/admin/approve-job/${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  await loadPendingJobs();
  await loadAllJobs();
}

async function rejectJob(id) {
  const token = getToken();
  await fetch(`${API_BASE_URL}/admin/reject-job/${id}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  });
  await loadPendingJobs();
  await loadAllJobs();
}

async function deleteAdminJob(id) {
  if (!confirm('Delete this job? Approved jobs or jobs with applicants will be archived and hidden publicly.')) return;
  try {
    const response = await fetch(`${API_BASE_URL}/admin/jobs/${id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${getToken()}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Delete failed');
    alert(data.message || 'Job removed.');
    await loadAllJobs();
    await loadStats();
  } catch (error) {
    alert(error.message || 'Unable to delete job.');
  }
}

async function updateUserRole(userId, selectElement) {
  const newRole = selectElement.value;
  if (!confirm(`Are you sure you want to change user ID ${userId}'s role to "${newRole}"?`)) {
    selectElement.value = selectElement.dataset.currentRole; // Revert selection
    return;
  }

  const token = getToken();
  try {
    const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/role`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ newRole }),
    });

    if (response.ok) {
      alert(`User ID ${userId} role updated to ${newRole}`);
      await loadUsers(); // Reload users to reflect changes
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to update user role');
      selectElement.value = selectElement.dataset.currentRole; // Revert selection
    }
  } catch (error) {
    console.error('Error updating user role:', error);
    alert('Error updating user role.');
    selectElement.value = selectElement.dataset.currentRole; // Revert selection
  }
}

async function deleteUser(userId) {
  if (!confirm(`Are you sure you want to DELETE user ID ${userId}? This action cannot be undone.`)) {
    return;
  }

  const token = getToken();
  try {
    const response = await fetch(`${API_BASE_URL}/admin/users/${userId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      alert(`User ID ${userId} deleted successfully.`);
      await loadUsers(); // Reload users to reflect changes
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to delete user');
    }
  } catch (error) {
    console.error('Error deleting user:', error);
    alert('Error deleting user.');
  }
}

function formatUserRow(user, index) {
  const details = `
    <p>${user.email}</p>
    <p>Name: ${user.name || ''}</p>
    <p>Status: ${user.status || ''}</p>
    ${user.role === 'recruiter' ? `<p>Company: ${user.company_name || 'No company'}</p><p>Company URL: ${user.company_url || ''}</p>` : ''}
    <p>Email verified: ${user.email_verified ? 'Yes' : 'No'}</p>
  `;

  const roleLabel = user.role === 'recruiter' ? 'Recruiter' : (user.role === 'jobseeker' ? 'Job Seeker' : user.role);

  return `
    <div class="list-card">
      <div style="display:flex; align-items:center; gap:10px;">
        <input type="checkbox" class="user-checkbox" data-id="${user.id}">
        <div>
          <strong>#${index} - ${user.name || user.email}</strong>
          ${details}
        </div>
      </div>
      <div class="action-buttons">
        <select onchange="updateUserRole(${user.id}, this)" data-current-role="${user.role}">
          <option value="jobseeker" ${user.role === 'jobseeker' ? 'selected' : ''}>Job Seeker</option>
          <option value="recruiter" ${user.role === 'recruiter' ? 'selected' : ''}>Recruiter</option>
          <option value="admin" ${user.role === 'admin' ? 'selected' : ''}>Admin</option>
        </select>
        <button class="reset-btn" onclick="resetUserPassword(${user.id})">Reset Password</button>
        <button class="reject-btn" onclick="deleteUser(${user.id})" style="background-color: #ef4444;">Delete User</button>
      </div>
    </div>
  `;
}

function renderUsers(usersList) {
  const usersContainer = document.getElementById('usersContainer');
  if (!usersList || usersList.length === 0) {
    usersContainer.innerHTML = '<p class="placeholder-text">No users match your search.</p>';
    return;
  }

  const admins = usersList.filter(u => u.role === 'admin');
  const recruiters = usersList.filter(u => u.role === 'recruiter');
  const jobseekers = usersList.filter(u => u.role === 'jobseeker');

  const tableTemplate = (title, list) => `
    <div class="users-flex-item" style="flex: 1; min-width: 450px; margin-bottom: 2rem;">
        <h3 class="section-title">${title} (${list.length})</h3>
        <div style="overflow-x: auto; background: white; border-radius: 10px; box-shadow: 0 2px 10px rgba(0,0,0,0.05);">
            <table class="data-table" style="width:100%; border-collapse: collapse;">
                <thead style="background: #f8fafc;">
                    <tr>
                        <th style="padding: 1rem; text-align: left;">#</th>
                        <th style="padding: 1rem; text-align: left;">Name</th>
                        <th style="padding: 1rem; text-align: left;">Email</th>
                        ${title === 'Recruiters' ? '<th style="padding: 1rem; text-align: left;">Company</th>' : ''}
                        <th style="padding: 1rem; text-align: left;">Action</th>
                    </tr>
                </thead>
                <tbody>
                    ${list.map((u, i) => {
                      const isAdmin = title === 'Admins';
                      return `
                        <tr>
                            <td style="padding: 1rem; border-top: 1px solid #eee;">
                                <input type="checkbox" class="user-checkbox" data-id="${u.id}"> ${i + 1}
                            </td>
                            <td style="padding: 1rem; border-top: 1px solid #eee;">${u.name || 'N/A'}</td>
                            <td style="padding: 1rem; border-top: 1px solid #eee;">${u.email}</td>
                            ${title === 'Recruiters' ? `<td style="padding: 1rem; border-top: 1px solid #eee;">${u.company_name || 'N/A'}</td>` : ''}
                            <td style="padding: 1rem; border-top: 1px solid #eee; white-space: nowrap;">
                                <button class="btn btn-primary" onclick="viewUserProfile(${u.id})" style="padding: 4px 8px; font-size: 0.7rem;">View</button>
                                <button class="btn" onclick="resetUserPassword(${u.id})" style="padding: 4px 8px; font-size: 0.7rem; background: #64748b; color: white;">PW</button>
                                ${isAdmin ? `
                                  <button class="btn" onclick="changeAdminEmail(${u.id})" style="padding: 4px 8px; font-size: 0.7rem; background:#0ea5e9; color: white; margin-left:6px;">Change Email</button>
                                ` : `
                                  <button class="btn ${u.status === 'rejected' ? 'btn-success' : 'btn-warning'}" onclick="toggleUserSuspension(${u.id})" style="padding: 5px 8px; font-size: 0.75rem;">
                                      ${u.status === 'rejected' ? 'Live' : 'Ban'}
                                  </button>
                                  <button class="btn btn-danger" onclick="deleteUser(${u.id})" style="padding: 4px 8px; font-size: 0.7rem;">Del</button>
                                `}
                            </td>
                        </tr>
                    `;
                    }).join('')}
                </tbody>
            </table>
        </div>
    </div>`;

  const adminsTable = admins.length ? tableTemplate('Admins', admins) : '';
  const recruitersTable = recruiters.length ? tableTemplate('Recruiters', recruiters) : '';
  const jobseekersTable = jobseekers.length ? tableTemplate('Job Seekers', jobseekers) : '';

  usersContainer.innerHTML = adminsTable + recruitersTable + jobseekersTable;
}




async function handleBulkDelete() {
  const selected = Array.from(document.querySelectorAll('.user-checkbox:checked')).map(cb => cb.dataset.id);
  if (selected.length === 0) return;
  
  if (!confirm(`Are you sure you want to delete ${selected.length} users?`)) return;

  const token = getToken();
  try {
    const resp = await fetch(`${API_BASE_URL}/admin/users/bulk-delete`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ userIds: selected }),
    });
    if (resp.ok) {
      alert('Users deleted successfully');
      loadUsers();
      const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
      if (bulkDeleteBtn) bulkDeleteBtn.classList.add('hidden');
    }
  } catch (e) { alert('Bulk delete failed'); }
}

function updateBulkDeleteVisibility() {
    const anyChecked = document.querySelectorAll('.user-checkbox:checked').length > 0;
    const bulkDeleteBtn = document.getElementById('bulkDeleteBtn');
    if (bulkDeleteBtn) bulkDeleteBtn.classList.toggle('hidden', !anyChecked);
}

async function showAdminsOverview() {
  const searchInput = document.getElementById('userSearchInput');

  const term = '';
  if (searchInput) {
    searchInput.value = term;
  }

  if (!usersData || usersData.length === 0) {
    await loadUsers();
  }

  // Ensure the page is visible.
  document.querySelectorAll('.page-section').forEach(s => s.classList.remove('active'));
  const usersSection = document.getElementById('users');
  if (usersSection) usersSection.classList.add('active');
  document.querySelectorAll('.menu-link').forEach(link => {
    link.parentElement.classList.toggle('active', link.dataset.page === 'users');
  });
  setPageHeading('users');
  renderUsers((usersData || []).filter(u => u.role === 'admin'));
  attachUserCheckboxListeners();
}


async function loadUsers() {

  const token = getToken();
  const usersContainer = document.getElementById('usersContainer');
  if (!usersContainer) return;
  usersContainer.innerHTML = adminSkeletonRows(5);
  const response = await fetch(`${API_BASE_URL}/admin/users`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    usersContainer.innerHTML = '<p class="placeholder-text">Unable to load users.</p>';
    return;
  }

  usersData = sanitizeRecord(await response.json());
  renderUsers(usersData);
  renderRecruitersPanel();
  attachUserCheckboxListeners();
}

async function downloadPDFReport() {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const selectedMonth = document.getElementById('reportMonth').value || 'Current';
  const logo = await loadPdfLogo();
  const watermark = await loadPdfWatermark();
  const drawReportWatermark = () => {
    if (!watermark) return;

    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const maxWidth = pageWidth * 0.72;
    const maxHeight = pageHeight * 0.26;
    const ratio = Math.min(maxWidth / watermark.width, maxHeight / watermark.height);
    const width = watermark.width * ratio;
    const height = watermark.height * ratio;
    const x = (pageWidth - width) / 2;
    const y = (pageHeight * 0.55) - (height / 2);

    doc.addImage(watermark.dataUrl, watermark.format, x, y, width, height);
  };
  const drawReportHeader = () => {
    const pageWidth = doc.internal.pageSize.getWidth();

    doc.setFontSize(22);
    doc.setTextColor(11, 20, 73); // HireKe Blue
    doc.text('HireKe Platform Analytics Report', 20, 20);

    if (logo) {
      const maxWidth = 34;
      const maxHeight = 28;
      const ratio = Math.min(maxWidth / logo.width, maxHeight / logo.height);
      const width = logo.width * ratio;
      const height = logo.height * ratio;
      doc.addImage(logo.dataUrl, logo.format, pageWidth - 20 - width, 8, width, height);
    }
  };

  // Header
  drawReportWatermark();
  drawReportHeader();
  
  doc.setFontSize(12);
  doc.setTextColor(100);
  doc.text(`Filter Month: ${selectedMonth} | Generated: ${new Date().toLocaleString()}`, 20, 30);

  // Stats Table
  doc.autoTable({
    startY: 40,
    head: [['Metric', 'Value']],
    body: [
      ['Total Revenue', `KES ${currentStats.revenue?.toLocaleString() || 0}`],
      ['Total Registered Users', currentStats.totalUsers || 0],
      ['Approved Recruiters', currentStats.totalRecruiters || 0],
      ['Job Seekers', currentStats.totalSeekers || 0],
      ['Approved Job Postings', currentStats.totalJobs || 0],
    ],
    theme: 'striped',
    headStyles: { fillColor: [23, 46, 134] },
    margin: { top: 40 },
    willDrawPage: (data) => {
      if (data.pageNumber > 1) drawReportWatermark();
    },
    didDrawPage: drawReportHeader
  });

  // User Summary
  const lastY = doc.lastAutoTable.finalY;
  doc.setFontSize(14);
  doc.text('User Distribution Summary', 20, lastY + 20);
  
  const seekerPct = ((currentStats.totalSeekers / currentStats.totalUsers) * 100).toFixed(1);
  doc.setFontSize(11);
  doc.text(`Job Seekers make up ${seekerPct}% of the user base.`, 20, lastY + 30);

  doc.save(`HireKe_Report_${new Date().toISOString().split('T')[0]}.pdf`);
}

async function loadPdfLogo() {
  return loadPdfImage(['hireke-logo.png', '/hireke-logo.png', 'clear logo(1).png', '/clear logo(1).png', 'logo.png', '/logo.png', 'assets/logo.png', '/assets/logo.png']);
}

async function loadPdfWatermark() {
  return loadPdfImage(['watermark.png', '/watermark.png', 'assets/watermark.png', '/assets/watermark.png', 'hireke-logo.png', '/hireke-logo.png', 'clear logo(1).png', '/clear logo(1).png', 'logo.png', '/logo.png']);
}

async function loadPdfImage(paths) {
  for (const imagePath of paths) {
    try {
      const response = await fetch(imagePath, { cache: 'force-cache' });
      if (!response.ok) continue;

      const blob = await response.blob();
      const dataUrl = await blobToDataUrl(blob);
      const dimensions = await getImageDimensions(dataUrl);
      const format = blob.type.includes('jpeg') || blob.type.includes('jpg') ? 'JPEG' : 'PNG';

      return {
        dataUrl,
        format,
        width: dimensions.width,
        height: dimensions.height
      };
    } catch (_error) {
      // Try the next known logo location.
    }
  }

  return null;
}

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}

function getImageDimensions(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve({ width: image.naturalWidth, height: image.naturalHeight });
    image.onerror = reject;
    image.src = src;
  });
}

async function resetUserPassword(userId) {
  const token = getToken();
  const newPassword = prompt('Enter new password for user ID ' + userId);
  if (!newPassword) return;

  const response = await fetch(`${API_BASE_URL}/admin/users/reset-password`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ userId, newPassword }),
  });

  if (!response.ok) {
    const data = await response.json().catch(() => ({}));
    alert(data.error || 'Failed to reset password');
    return;
  }

  alert('Password reset successfully');
}

async function changeAdminEmail(userId) {
  const token = getToken();
  const currentAdmin = (usersData || []).find(u => u.id == userId);
  const currentEmail = currentAdmin?.email || '';

  const newEmail = prompt(`Enter new email for admin ID ${userId}${currentEmail ? ` (current: ${currentEmail})` : ''}:`);
  if (!newEmail) return;

  const email = newEmail.trim();
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    alert('Invalid email format');
    return;
  }

  try {
    const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/email`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ email }),
    });

    if (!response.ok) {
      const data = await response.json().catch(() => ({}));
      alert(data.error || 'Failed to change email');
      return;
    }

    alert('Email updated successfully');
    await loadUsers();
    showAdminsOverview();
  } catch (e) {
    console.error(e);
    alert('Error changing email');
  }
}


async function viewUserProfile(userId) {
  const user = usersData.find(u => u.id == userId);
  if (!user) return;
  
  document.getElementById('modalUserName').textContent = user.name || 'User Profile';
  const detailsContainer = document.getElementById('modalUserProfileDetails');
  
  detailsContainer.innerHTML = `
    <div class="detail-row"><span class="detail-label">Full Name</span><span>${user.name || 'N/A'}</span></div>
    <div class="detail-row"><span class="detail-label">Email</span><span>${user.email}</span></div>
    <div class="detail-row"><span class="detail-label">Role</span><span style="text-transform: capitalize;">${user.role}</span></div>
    <div class="detail-row"><span class="detail-label">Status</span><span style="color: ${user.status === 'approved' ? '#22c55e' : '#ef4444'}">${user.status}</span></div>
    <div class="detail-row"><span class="detail-label">Email Verified</span><span>${user.email_verified ? '✅ Yes' : '❌ No'}</span></div>
    ${!user.email_verified ? `
      <div class="detail-row" style="background: rgba(245, 158, 11, 0.1); padding: 10px; border-radius: 8px;">
        <span class="detail-label">Action</span>
        <button class="btn btn-warning" onclick="resendAdminVerification('${user.email}')" style="padding: 5px 10px; font-size: 0.75rem;">Resend Verification Email</button>
      </div>
    ` : ''}
    <div class="detail-row"><span class="detail-label">Joined On</span><span>${new Date(user.created_at).toLocaleDateString()}</span></div>
    ${user.role === 'recruiter' ? `
      <div class="detail-row" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;"><span class="detail-label">Company</span><span>${user.company_name || 'N/A'}</span></div>
      <div class="detail-row"><span class="detail-label">Website</span><a href="${user.company_url || '#'}" target="_blank" style="color: #60a5fa;">${user.company_url || 'N/A'}</a></div>
    ` : `
      <div class="detail-row" style="margin-top: 15px; border-top: 1px solid rgba(255,255,255,0.1); padding-top: 10px;">
        <span class="detail-label">Curriculum Vitae</span>
        <button onclick="downloadCV(${user.id})" style="background: none; border: none; color: #60a5fa; cursor: pointer; text-decoration: underline; padding: 0; font-size: inherit;">Download CV (PDF/Text)</button>
      </div>
    `}
  `;

  document.getElementById('userProfileModal').style.display = 'grid';
}

async function resendAdminVerification(email) {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/resend-verification-otp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
    });
    const data = await response.json();
    if (response.ok) {
      alert('Verification OTP has been resent to ' + email);
    } else {
      alert(data.error || 'Failed to resend email');
    }
  } catch (e) {
    alert('Error connecting to server.');
  }
}

function downloadCV(userId) {
  const user = usersData.find(u => u.id == userId);
  if (!user?.cv_url) return alert('No CV file is available for this user.');

  const a = document.createElement('a');
  a.href = user.cv_url;
  a.download = '';
  a.target = '_blank';
  a.rel = 'noopener';
  a.click();
}

function closeProfileModal() {
  document.getElementById('userProfileModal').style.display = 'none';
}

async function handleAddAdmin(event) {
  event.preventDefault();
  const name = document.getElementById('newAdminName').value;
  const email = document.getElementById('newAdminEmail').value;
  const password = document.getElementById('newAdminPassword').value;
  const role = document.getElementById('newAdminRole')?.value || 'admin';
  const token = getToken();

  try {
    const response = await fetch(`${API_BASE_URL}/admin/create-admin`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name,
        email,
        password,
        role
      }),
    });

    if (response.ok) {
      alert('Admin access account created successfully!');
      closeAddAdminModal();
      document.getElementById('addAdminForm').reset();
      loadUsers();
    } else {
      const data = await response.json();
      alert(data.error || 'Failed to create admin account');
    }
  } catch (e) {
    console.error(e);
    alert('Error connecting to server.');
  }
}

async function toggleUserSuspension(userId) {
  const user = usersData.find(u => u.id == userId);
  if (!user) return;

  const newStatus = user.status === 'approved' ? 'rejected' : 'approved';
  const actionLabel = newStatus === 'rejected' ? 'SUSPEND' : 'ACTIVATE';

  if (!confirm(`Are you sure you want to ${actionLabel} this user?`)) return;

  const token = getToken();
  try {
    const response = await fetch(`${API_BASE_URL}/admin/users/${userId}/status`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ status: newStatus }),
    });

    if (response.ok) {
      alert(`User account ${newStatus === 'rejected' ? 'suspended' : 'activated'}.`);
      loadUsers();
      loadStats();
    } else {
      const data = await response.json();
      alert(data.error || 'Update failed');
    }
  } catch (error) {
    console.error(error);
  }
}

async function initAdminDashboard() {
  try {
    const adminLoginForm = document.getElementById('adminLoginForm');
    if (adminLoginForm) return;
    const user = await fetchCurrentUser();
    if (!user) return;

    const adminNameLabel = document.getElementById('adminDisplayName');
    if(adminNameLabel) adminNameLabel.textContent = user.name || 'Administrator';
    
    // Load core services
    checkServerStatus();
    fetchLogs();
    setInterval(checkServerStatus, 30000);
    setInterval(fetchLogs, 10000);
    setupContextMenu();
    setAdminSkeletons();
    
    // Load data in parallel to prevent blocking
    await Promise.allSettled([
      loadStats(),
      loadPendingRecruiters(),
      loadPendingJobs(),
      loadPendingPayments(),
      loadVerificationQueue(),
      loadUsers(),
      loadAllJobs(),
      loadImportedOpportunities(),
      loadTrustedSources()
    ]);

    if (window.location.pathname === '/admin/opportunities/import') {
      navigateAdminPage('opportunity-importer');
    }
  } catch (err) {
    console.error("Dashboard Init Error:", err);
  }
}

function setupEventListeners() {
  const searchInput = document.getElementById('userSearchInput');
  const usersContainer = document.getElementById('usersContainer');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      const term = e.target.value.toLowerCase();
      const filtered = usersData.filter(u => u.email.toLowerCase().includes(term) || (u.name && u.name.toLowerCase().includes(term)));
      renderUsers(filtered);
    });
  }

  const txSearch = document.getElementById('transactionSearch');
  if (txSearch) {
    txSearch.addEventListener('input', () => {
        if (currentStats.recentPayments) renderRecentTransactions(currentStats.recentPayments);
    });
  }

  const downloadBtn = document.getElementById('downloadReportBtn');
  if (downloadBtn) {
    downloadBtn.addEventListener('click', downloadPDFReport);
  }
}

function setupAdminPage() {
  const adminLoginForm = document.getElementById('adminLoginForm');
  const adminLogoutBtn = document.getElementById('adminLogoutBtn');
  const adminPasswordInput = document.getElementById('adminPassword');

  if (adminLoginForm) {
    // Always bind the submit handler for the login page.
    // admin-login.html loads only this script; double-binding is harmless but we guard anyway.
    if (!adminLoginForm.dataset.listenerBound) {
      adminLoginForm.addEventListener('submit', loginAdmin);
      adminLoginForm.dataset.listenerBound = 'true';
    }

    const togglePasswordBtn = document.getElementById('togglePassword');
    if (togglePasswordBtn && adminPasswordInput && !togglePasswordBtn.dataset.listenerBound) {
      togglePasswordBtn.dataset.listenerBound = 'true';
      togglePasswordBtn.addEventListener('click', () => {
        const type = adminPasswordInput.type === 'password' ? 'text' : 'password';
        adminPasswordInput.type = type;
        const icon = togglePasswordBtn.querySelector('i');
        if (icon) {
          icon.classList.toggle('fa-eye');
          icon.classList.toggle('fa-eye-slash');
        }
      });
    }

    const existingToken = getToken();
    if (existingToken) {
      window.location.href = 'admin-dashboard.html';
    }
  }

  if (adminLogoutBtn) {
    if (!adminLogoutBtn.dataset.listenerBound) {
      adminLogoutBtn.dataset.listenerBound = 'true';
      adminLogoutBtn.addEventListener('click', () => {
        clearToken();
        window.location.href = 'admin-login.html';
      });
    }
    setupEventListeners();
    setupMenuNavigation();
    initAdminDashboard();
  }
}

// Ensure setup runs even if the script loads after DOMContentLoaded.
if (document.readyState === 'loading') {
  window.addEventListener('DOMContentLoaded', setupAdminPage);
} else {
  setupAdminPage();
}


