document.addEventListener('DOMContentLoaded', () => {
  const API_BASE_URL = `${window.location.origin}/api`;
  const tokenKey = 'token';

  const state = {
    user: null,
    dashboard: null,
    personal: null,
    profile: null,
    educationEntries: [],
    experienceEntries: [],
    networkRequests: { incoming: [], outgoing: [] },
    connections: [],
    messages: [],
    aiMatches: [],
    aiMatchesLoaded: false,
    consentPreferences: null,
    publicProfile: null,
    pendingPhotoFile: null,
    currentProfileSection: 'about',
    currentSettingsSection: 'account',
    saved: new Set(JSON.parse(localStorage.getItem('hirekeSavedOpportunityIds') || '[]')),
    savedOpportunities: [],
    selectedOpportunityTypes: new Set(),
    currentTab: 'new',
    currentView: 'dashboard',
    sidebarCollapsed: false,
    dashboardLoadError: null,
    countersAnimated: new Set(),
  };

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const el = (id) => document.getElementById(id);
  const themeKey = 'hirekeTheme';
  const modalBackdrop = el('modal-backdrop');
  const authModal = el('auth-modal');
  const roleModal = el('role-modal');
  const profileModal = el('profile-modal');
  const jobModal = el('job-modal');
  const policyModal = el('policy-modal');
  const verificationModal = el('verification-modal');
  const verificationState = {
    email: '',
  };

  function preferredTheme() {
    return 'light';
  }

  function applyTheme(theme) {
    const nextTheme = theme === 'dark' ? 'dark' : 'light';
    document.documentElement.dataset.theme = nextTheme;
    localStorage.setItem(themeKey, nextTheme);
    const isDark = nextTheme === 'dark';
    [el('theme-toggle'), el('mobile-theme-toggle')].forEach((button) => {
      if (!button) return;
      const label = isDark ? 'Light mode' : 'Dark mode';
      button.setAttribute('aria-label', label);
      button.setAttribute('title', label);
      button.innerHTML = `<i class="fa-regular ${isDark ? 'fa-sun' : 'fa-moon'}"></i>`;
    });
    if (el('settings-theme-toggle')) el('settings-theme-toggle').checked = isDark;
  }

  function toggleTheme() {
    applyTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  }

  function showToast(message, error = false) {
    if (typeof Toastify !== 'undefined') {
      Toastify({
        text: message,
        duration: 2600,
        gravity: 'top',
        position: 'right',
        className: `hk-toast ${error ? 'hk-toast-error' : 'hk-toast-success'}`,
        style: { background: error ? '#ef4444' : '#0b56d0' },
      }).showToast();
      return;
    }
    const stack = document.getElementById('hk-toast-stack') || document.body.appendChild(Object.assign(document.createElement('div'), {
      id: 'hk-toast-stack',
      className: 'hk-toast-stack',
    }));
    const toast = document.createElement('div');
    toast.className = `hk-native-toast ${error ? 'is-error' : 'is-success'}`;
    toast.textContent = message;
    stack.appendChild(toast);
    window.setTimeout(() => toast.classList.add('is-leaving'), 2400);
    window.setTimeout(() => toast.remove(), 2850);
  }

  function setButtonLoading(button, isLoading, loadingText) {
    if (!button) return;
    const label = button.querySelector('.btn-label');
    if (isLoading) {
      if (!button.dataset.originalLabel && label) button.dataset.originalLabel = label.textContent;
      if (label && loadingText) label.textContent = loadingText;
    } else if (label && button.dataset.originalLabel) {
      label.textContent = button.dataset.originalLabel;
      delete button.dataset.originalLabel;
    }
    button.classList.toggle('is-loading', isLoading);
    button.disabled = isLoading;
  }

  function toggleModal(modal, show) {
    if (!modal) return;
    modal.classList.toggle('hidden', !show);
    const anyOpen = [authModal, roleModal, profileModal, jobModal, policyModal, verificationModal].some((item) => item && !item.classList.contains('hidden'));
    modalBackdrop?.classList.toggle('hidden', !anyOpen);
  }

  function authHeaders() {
    const token = localStorage.getItem(tokenKey);
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function fetchJson(url, options = {}) {
    const response = await fetch(url, options);
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      throw new Error(`API returned ${contentType || 'a non-JSON response'}. Open HireKe through the Node server and confirm ${API_BASE_URL}/health is reachable.`);
    }
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(data.error || 'Request failed');
      error.data = data;
      error.status = response.status;
      throw error;
    }
    return data;
  }

  function requireAuth() {
    if (state.user) return true;
    openAuthModal('login');
    return false;
  }

  async function trackApplicationStart(job) {
    await fetchJson(`${API_BASE_URL}/jobs/${job.id}/application-start`, {
      method: 'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
  }

  function jobShareUrl(job) {
    const url = new URL(window.location.origin + window.location.pathname);
    if (job?.id) url.searchParams.set('job', job.id);
    return url.toString();
  }

  async function copyText(value) {
    if (navigator.clipboard?.writeText && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
  }

  async function shareOpportunity(job) {
    if (!job) return;
    const shareData = {
      title: `${job.title || 'Opportunity'} on HireKe`,
      text: `${job.title || 'Opportunity'} at ${job.company || 'HireKe partner'}`,
      url: jobShareUrl(job),
    };
    try {
      if (navigator.share) {
        await navigator.share(shareData);
        return;
      }
      await copyText(shareData.url);
      showToast('Job link copied. You can now share it.');
    } catch (error) {
      if (error?.name === 'AbortError') return;
      showToast('Could not share this job. Please try again.', true);
    }
  }

  function allDashboardOpportunities() {
    const dashboard = state.dashboard || {};
    return [
      ...(dashboard.opportunities || []),
      ...(dashboard.recommended || []),
      ...(dashboard.newOpportunities || []),
      ...(dashboard.trending || []),
      ...(dashboard.expiringSoon || []),
      ...(state.savedOpportunities || []),
    ];
  }

  function openSharedJobFromUrl() {
    const jobId = new URLSearchParams(window.location.search).get('job');
    if (!jobId || !state.dashboard) return;
    const job = allDashboardOpportunities().find((item) => String(item.id) === String(jobId));
    if (job) openJobModal(job);
  }

  let selectedRole = null;

  function openRoleModal() {
    selectedRole = null;
    toggleModal(roleModal, true);
    toggleModal(authModal, false);
  }

  function openAuthModal(mode) {
    const authForm = el('auth-form');
    authForm.dataset.mode = mode;
    authForm.reset();

    const isSignup = mode === 'signup';
    el('auth-title').textContent = isSignup ? 'Create your account' : 'Welcome back';
    el('auth-subtitle').textContent = isSignup
      ? `Signing up as ${selectedRole === 'recruiter' ? 'a recruiter' : 'a job seeker'}`
      : 'Log in to continue to HireKe.';
    el('auth-role-hint').textContent = isSignup ? 'Already have an account?' : 'Not signed up yet?';
    el('auth-switch').textContent = isSignup ? 'Log in' : 'Create account';
    el('forgot-password-link')?.classList.toggle('hidden', isSignup);
    el('auth-submit-btn')?.querySelector('.btn-label')?.replaceChildren(document.createTextNode(isSignup ? 'Create account' : 'Continue'));
    el('auth-back').classList.toggle('hidden', !isSignup);
    el('auth-name-container')?.classList.toggle('hidden', !isSignup);
    el('auth-phone-container')?.classList.toggle('hidden', !isSignup);
    el('auth-confirm-container')?.classList.toggle('hidden', !isSignup);
    el('auth-name')?.toggleAttribute('required', isSignup);
    el('auth-phone')?.toggleAttribute('required', isSignup);
    el('auth-confirm-password')?.toggleAttribute('required', isSignup);
    el('auth-privacy-container').classList.toggle('hidden', !isSignup);
    el('auth-marketing-container').classList.toggle('hidden', !isSignup);
    el('auth-county-container').classList.toggle('hidden', !isSignup);
    el('auth-industry-container').classList.toggle('hidden', !isSignup);
    el('auth-company-container').classList.toggle('hidden', !(isSignup && selectedRole === 'recruiter'));
    el('auth-company')?.toggleAttribute('required', isSignup && selectedRole === 'recruiter');

    toggleModal(authModal, true);
    toggleModal(roleModal, false);
  }

  function openVerificationModal(email) {
    verificationState.email = email;
    setText('verification-email-label', email);
    el('verification-form')?.reset();
    toggleModal(verificationModal, true);
    toggleModal(authModal, false);
    toggleModal(roleModal, false);
  }

  function greeting() {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good morning';
    if (hour < 17) return 'Good afternoon';
    return 'Good evening';
  }

  function initials(name) {
    return (name || 'Guest').trim().charAt(0).toUpperCase();
  }

  function splitList(value) {
    return String(value || '')
      .split(/[\n,]+/)
      .map((item) => item.trim())
      .filter(Boolean);
  }

  function setText(id, value) {
    const node = el(id);
    if (node) node.textContent = value;
  }

  function setBadge(id, value) {
    const node = el(id);
    if (!node) return;
    const count = Number(value || 0);
    node.textContent = count;
    node.classList.toggle('hk-count-empty', count === 0);
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

  function updatePersonalUI() {
    const loggedIn = Boolean(state.user);
    const personal = state.personal || {};
    const strength = loggedIn ? Number(personal.profileStrength || 0) : 0;
    const applications = loggedIn ? personal.applications || [] : [];
    const notifications = loggedIn ? personal.notifications || [] : [];
    const savedCount = loggedIn ? state.saved.size : 0;
    const unreadMessages = loggedIn ? state.messages.reduce((sum, item) => sum + Number(item.unread_count || 0), 0) : 0;

    setText('welcome-title', loggedIn ? `${greeting()}, ${state.user.name}!` : `${greeting()}!`);
    setText('welcome-subtitle', loggedIn ? 'Explore opportunities and take the next step in your career.' : 'Explore opportunities and take the next step in your career.');
    setText('sidebar-profile-score', `${strength}%`);
    const alertCount = notifications.filter((item) => Number(item.is_read || 0) === 0).length || notifications.length;
    setBadge('top-alert-count', alertCount);
    setBadge('sidebar-alert-count', alertCount);
    setBadge('top-inbox-count', unreadMessages);
    setBadge('sidebar-inbox-count', unreadMessages);
    setBadge('mobile-alert-count', alertCount);
    setBadge('mobile-inbox-count', unreadMessages);
    setBadge('mobile-bottom-inbox-count', unreadMessages);
    setText('home-applications-count', applications.length);
    setText('home-interviews-count', personal.analytics?.interviews || 0);
    setText('home-saved-count', savedCount);
    setText('home-profile-strength', `${strength}%`);
    setText('user-display-name', loggedIn ? state.user.name : 'Guest');
    setText('user-display-role', loggedIn ? (state.user.role === 'recruiter' ? 'Recruiter' : state.user.role === 'admin' ? 'Admin' : 'Jobseeker') : 'Visitor');
    setText('user-avatar', initials(loggedIn ? state.user.name : 'Guest'));

    el('loginBtn').textContent = loggedIn ? 'Logout' : 'Log In';
    el('signupBtn').classList.toggle('hidden', loggedIn);
    el('profileBtn').classList.toggle('hidden', !loggedIn);
    el('sidebar-login').classList.toggle('hidden', loggedIn);
    el('sidebar-signup').classList.toggle('hidden', loggedIn);
    el('open-recruiter-menu-btn')?.classList.toggle('hidden', !(loggedIn && state.user.role === 'recruiter'));
    el('home-create-profile-btn')?.classList.toggle('hidden', loggedIn);

    renderActivity(applications);
    renderApplications(applications);
    renderSavedOpportunities();
    renderAllAlerts();
    renderAnalytics(personal.analytics || {});
    renderAccountProfile();
    renderInboxPreview();
  }

  function empty(message) {
    return `<div class="hk-empty">${message}</div>`;
  }

  function listState(message, type = '') {
    return `<div class="hk-empty${type ? ` is-${type}` : ''}">${escapeHTML(message)}</div>`;
  }

  function skeletonCard(kind = 'opportunity') {
    if (kind === 'category') {
      return '<div class="hk-skeleton hk-skeleton-category"><span></span><strong></strong></div>';
    }
    if (kind === 'alert') {
      return '<div class="hk-skeleton hk-skeleton-row"><i></i><span></span><small></small></div>';
    }
    if (kind === 'activity') {
      return '<div class="hk-skeleton hk-skeleton-row"><i></i><span></span><small></small></div>';
    }
    return `
      <article class="hk-opportunity hk-skeleton hk-skeleton-opportunity" aria-hidden="true">
        <div class="hk-company-logo"></div>
        <div><h3></h3><p></p><div class="hk-badge-row"><span></span><span></span></div></div>
        <div class="hk-opportunity-meta"><span></span><span></span><button type="button" tabindex="-1"></button></div>
      </article>
    `;
  }

  function renderSkeletons(id, count = 4, kind = 'opportunity') {
    const container = el(id);
    if (!container) return;
    container.classList.add('is-loading');
    container.innerHTML = Array.from({ length: count }, () => skeletonCard(kind)).join('');
  }

  function clearLoading(container) {
    container?.classList.remove('is-loading');
  }

  function prepareReveal(root = document) {
    const targets = root.querySelectorAll('.hk-panel, .hk-opportunity, .hk-category, .hk-alert-item, .hk-activity-item, .hk-entry-card, .hk-tips-list button, .hk-welcome, .hk-profile-body-grid > article, .hk-profile-side article');
    targets.forEach((node, index) => {
      if (node.classList.contains('hk-revealed') || node.classList.contains('hk-skeleton')) return;
      node.classList.add('hk-reveal');
      node.style.setProperty('--reveal-delay', `${Math.min(index % 6, 5) * 42}ms`);
      revealObserver?.observe(node);
    });
  }

  let revealObserver = null;

  function setupRevealObserver() {
    if (reduceMotion) {
      document.querySelectorAll('.hk-reveal').forEach((node) => node.classList.add('hk-revealed'));
      return;
    }
    revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('hk-revealed');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -40px 0px' });
    prepareReveal();
  }

  function animateCounter(id, finalValue, options = {}) {
    const node = el(id);
    if (!node) return;
    const numeric = Number(finalValue || 0);
    const formatter = options.formatter || ((value) => Math.round(value).toLocaleString());
    if (reduceMotion || state.countersAnimated.has(id)) {
      node.textContent = formatter(numeric);
      return;
    }
    const run = () => {
      state.countersAnimated.add(id);
      const start = performance.now();
      const duration = 820;
      const tick = (now) => {
        const progress = Math.min(1, (now - start) / duration);
        const eased = 1 - Math.pow(1 - progress, 3);
        node.textContent = formatter(numeric * eased);
        if (progress < 1) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    };
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        observer.disconnect();
        run();
      }
    }, { threshold: 0.5 });
    observer.observe(node);
  }

  function setSidebarCollapsed(collapsed) {
    state.sidebarCollapsed = collapsed;
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    el('homepage-sidebar')?.setAttribute('aria-hidden', 'false');
    el('sidebar-collapse-btn')?.setAttribute('aria-expanded', String(!collapsed));
    el('sidebar-wake-btn')?.setAttribute('aria-expanded', String(!collapsed));
    el('sidebar-wake-btn')?.classList.toggle('hidden', !collapsed);
  }

  function isMobileLayout() {
    return window.matchMedia('(max-width: 720px)').matches;
  }

  function setSearchFiltersExpanded(expanded) {
    const body = el('search-filters-body');
    const toggle = el('search-filters-toggle');
    toggle?.setAttribute('aria-expanded', String(expanded));
    if (!body) return;
    if (expanded) {
      body.hidden = false;
      requestAnimationFrame(() => body.classList.add('is-open'));
    } else {
      body.classList.remove('is-open');
      window.setTimeout(() => { body.hidden = true; }, reduceMotion ? 0 : 180);
    }
  }

  function syncResponsiveDefaults() {
    setSearchFiltersExpanded(!isMobileLayout());
    document.body.classList.remove('mobile-nav-open');
    el('mobile-menu-btn')?.setAttribute('aria-expanded', 'false');
  }

  function relativeTime(dateValue) {
    if (!dateValue) return '';
    const then = new Date(dateValue).getTime();
    if (Number.isNaN(then)) return '';
    const minutes = Math.max(1, Math.round((Date.now() - then) / 60000));
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.round(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    return `${Math.round(hours / 24)}d ago`;
  }

  function deadlineLabel(dateValue) {
    if (!dateValue) return '';
    const date = new Date(dateValue);
    if (Number.isNaN(date.getTime())) return '';
    return `Deadline: ${date.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }

  function matchPercent(job) {
    const aiMatch = state.aiMatches.find((match) => String(match.opportunityId || match.id) === String(job?.id));
    if (aiMatch) return Number(aiMatch.matchScore || 0);
    const base = Number(job.featured) ? 88 : 78;
    return Math.min(96, base + (Number(job.id || 0) % 9));
  }

  function renderOpportunities(id, jobs) {
    const container = el(id);
    if (!container) return;
    clearLoading(container);

    if (!jobs || jobs.length === 0) {
      container.innerHTML = listState('No approved opportunities yet. Check back soon.');
      prepareReveal(container);
      return;
    }

    container.innerHTML = jobs.slice(0, 5).map((job) => {
      const hasCompensation = Boolean((job.salary && job.salary !== 'Not specified') || deadlineLabel(job.deadline));
      return `
      <article class="hk-opportunity ${hasCompensation ? '' : 'hk-no-comp'}">
        <div class="hk-company-logo">${escapeHTML(initials(job.company))}</div>
        <div>
          <h3>${escapeHTML(job.title || 'Untitled opportunity')}</h3>
          <p>${escapeHTML(job.company || 'HireKe partner')}</p>
          <small class="hk-opportunity-location">${escapeHTML(job.location || 'Kenya')} &bull; ${escapeHTML(job.job_type || job.type || 'Opportunity')}</small>
          <div class="hk-badge-row">
            <span class="hk-badge">${escapeHTML(job.category || 'Jobs')}</span>
            <span class="hk-badge">${escapeHTML(job.job_type || job.type || 'Opportunity')}</span>
            ${Number(job.featured || 0) ? '<span class="hk-badge hk-featured">Featured</span>' : ''}
          </div>
          ${state.user ? `<span class="hk-match-pill"><i class="fa-solid fa-wand-magic-sparkles"></i>${matchPercent(job)}% match</span>` : ''}
        </div>
        <div class="hk-opportunity-meta">
          <strong>${escapeHTML((job.salary && job.salary !== 'Not specified') ? job.salary : deadlineLabel(job.deadline))}</strong>
          <span class="${job.deadline ? 'hk-deadline' : ''}">${escapeHTML(deadlineLabel(job.deadline) || relativeTime(job.created_at))}</span>
          <span><i class="fa-solid fa-location-dot"></i> ${escapeHTML(job.location || 'Kenya')}</span>
          <div class="hk-opportunity-actions">
            <button class="hk-card-view-btn" type="button" data-job-id="${job.id}">View job</button>
            <button class="hk-card-apply-btn" type="button" data-apply-job-id="${job.id}">Apply</button>
            <button class="hk-card-share-btn" type="button" title="Share job" aria-label="Share ${escapeHTML(job.title || 'job')}" data-share-job-id="${job.id}">
              <i class="fa-solid fa-share-nodes"></i><span>Share</span>
            </button>
          </div>
          <button class="hk-save-inline" type="button" aria-label="Save opportunity" data-save-job-id="${job.id}">
            <i class="${state.saved.has(job.id) || state.saved.has(String(job.id)) ? 'fa-solid' : 'fa-regular'} fa-bookmark"></i>
          </button>
        </div>
      </article>
    `;
    }).join('');

    container.querySelectorAll('[data-job-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const job = allDashboardOpportunities().find((item) => String(item.id) === String(button.dataset.jobId));
        openJobModal(job);
      });
    });
    container.querySelectorAll('[data-apply-job-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const job = allDashboardOpportunities().find((item) => String(item.id) === String(button.dataset.applyJobId));
        openJobModal(job);
      });
    });
    container.querySelectorAll('[data-share-job-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const job = allDashboardOpportunities().find((item) => String(item.id) === String(button.dataset.shareJobId));
        await shareOpportunity(job);
      });
    });
    container.querySelectorAll('[data-save-job-id]').forEach((button) => {
      button.addEventListener('click', async () => {
        const job = allDashboardOpportunities().find((item) => String(item.id) === String(button.dataset.saveJobId));
        await saveOpportunity(job, button);
      });
    });
    prepareReveal(container);
  }

  function renderAiMatches() {
    const container = el('ai-matches-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to see AI-ranked opportunities.');
      return;
    }
    if (!state.aiMatchesLoaded) {
      container.innerHTML = empty('Loading your AI matches...');
      return;
    }
    if (state.consentPreferences?.aiMatchingEnabled === false) {
      container.innerHTML = empty('AI matching is turned off in Privacy settings.');
      return;
    }
    if (!state.aiMatches.length) {
      container.innerHTML = empty('No AI matches yet. Add skills, location, experience, or upload a readable CV.');
      return;
    }

    container.innerHTML = state.aiMatches.slice(0, 10).map((match) => `
      <article class="hk-opportunity">
        <div class="hk-company-logo">${escapeHTML(initials(match.company))}</div>
        <div>
          <h3>${escapeHTML(match.title || 'Opportunity')}</h3>
          <p>${escapeHTML(match.company || 'HireKe partner')}</p>
          <small class="hk-opportunity-location">${escapeHTML(match.location || 'Kenya')} &bull; ${escapeHTML(match.opportunityType || 'Opportunity')}</small>
          <span class="hk-match-pill"><i class="fa-solid fa-wand-magic-sparkles"></i>${Number(match.matchScore || 0)}% match</span>
          <ul class="hk-ai-inline-reasons">
            ${(match.matchReasons || []).slice(0, 2).map((reason) => `<li>${escapeHTML(reason)}</li>`).join('')}
          </ul>
        </div>
        <div class="hk-opportunity-meta">
          <strong>${escapeHTML(deadlineLabel(match.deadline) || 'Open')}</strong>
          <span>${escapeHTML((match.strongMatches || []).slice(0, 3).join(', ') || 'Profile based match')}</span>
          <button type="button" data-ai-job-id="${match.opportunityId}">View details</button>
        </div>
      </article>
    `).join('');
    container.querySelectorAll('[data-ai-job-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const job = state.dashboard?.opportunities?.find((item) => String(item.id) === String(button.dataset.aiJobId));
        if (job) openJobModal(job);
      });
    });
    prepareReveal(container);
  }

  async function loadAiMatches() {
    if (!state.user || state.user.role === 'recruiter') {
      state.aiMatches = [];
      state.aiMatchesLoaded = Boolean(state.user);
      renderAiMatches();
      return;
    }
    if (state.consentPreferences?.aiMatchingEnabled === false) {
      state.aiMatches = [];
      state.aiMatchesLoaded = true;
      renderAiMatches();
      return;
    }
    state.aiMatchesLoaded = false;
    renderAiMatches();
    try {
      state.aiMatches = await fetchJson(`${API_BASE_URL}/ai/job-seeker/matches`, { headers: authHeaders() });
    } catch (error) {
      state.aiMatches = [];
      showToast(error.message || 'Could not load AI matches.', true);
    } finally {
      state.aiMatchesLoaded = true;
      renderAiMatches();
      if (state.dashboard) renderOpportunities('recommended-list', state.dashboard.recommended || []);
    }
  }

  async function saveOpportunity(job, trigger) {
    if (!job || !requireAuth()) return;
    try {
      await fetchJson(`${API_BASE_URL}/jobs/${job.id}/save`, {
        method: 'POST',
        headers: authHeaders(),
      });
      state.saved.add(job.id);
      await loadSavedOpportunities();
      updatePersonalUI();
      renderSavedOpportunities();
      trigger?.querySelector('i')?.classList.replace('fa-regular', 'fa-solid');
      showToast('Opportunity saved.');
    } catch (error) {
      showToast(error.message || 'Could not save opportunity.', true);
    }
  }

  function renderCurrentTab() {
    if (!state.dashboard) return;
    const map = {
      new: state.dashboard.newOpportunities,
      trending: state.dashboard.trending,
      expiring: state.dashboard.expiringSoon,
    };
    const jobs = map[state.currentTab] || [];
    renderOpportunities('tab-opportunity-list', jobs);
    renderOpportunities('standalone-opportunity-list', jobs);
  }

  function renderAlerts() {
    const container = el('recent-alerts-list');
    if (!container) return;
    const alerts = state.user ? (state.personal?.notifications || []) : (state.dashboard?.recentAlerts || []);
    if (!alerts || alerts.length === 0) {
      container.innerHTML = empty('No alerts yet. Create an account to get personalized alerts.');
      prepareReveal(container);
      return;
    }
    container.innerHTML = alerts.slice(0, 5).map((alert) => `
      <div class="hk-alert-item">
        <i class="fa-regular fa-bell"></i>
        <span>${escapeHTML(alert.message)}</span>
        <small>${relativeTime(alert.created_at)}</small>
      </div>
    `).join('');
    prepareReveal(container);
  }

  function renderAllAlerts() {
    const container = el('all-alerts-list');
    if (!container) return;
    const alerts = state.user ? (state.personal?.notifications || []) : [];
    if (!state.user) {
      container.innerHTML = empty('Log in to manage personalized alerts.');
      prepareReveal(container);
      return;
    }
    if (!alerts || alerts.length === 0) {
      container.innerHTML = empty('No active alerts yet.');
      prepareReveal(container);
      return;
    }
    container.innerHTML = alerts.map((alert) => `
      <div class="hk-alert-item">
        <i class="fa-regular fa-bell"></i>
        <span>${escapeHTML(alert.message)}</span>
        <small>${relativeTime(alert.created_at)}</small>
      </div>
    `).join('');
    prepareReveal(container);
  }

  function renderApplications(applications) {
    const container = el('applications-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to view submitted applications.');
      prepareReveal(container);
      return;
    }
    if (!applications || applications.length === 0) {
      container.innerHTML = empty('No applications submitted yet.');
      prepareReveal(container);
      return;
    }
    container.innerHTML = applications.map((app) => `
      <div class="hk-activity-item">
        <i class="fa-regular fa-square-check"></i>
        <span>
          Applied to ${escapeHTML(app.title)} at ${escapeHTML(app.company)}
          ${app.ai_match_score ? `<strong class="hk-match-pill"><i class="fa-solid fa-wand-magic-sparkles"></i>${Number(app.ai_match_score)}% AI match</strong>` : ''}
        </span>
        <small>${app.ai_match_score ? 'Why this matches you' : relativeTime(app.applied_at)}</small>
      </div>
    `).join('');
    prepareReveal(container);
  }

  async function loadMessages() {
    if (!state.user) return;
    const container = el('messages-list');
    if (container) container.innerHTML = empty('Loading messages...');
    try {
      state.messages = await fetchJson(`${API_BASE_URL}/messages`, { headers: authHeaders() });
    } catch (error) {
      state.messages = [];
      if (container) container.innerHTML = empty('Could not load messages.');
      return;
    }
    renderMessages();
  }

  function renderMessages() {
    const container = el('messages-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to view messages.');
      return;
    }
    if (!state.messages.length) {
      container.innerHTML = empty('No messages yet.');
      return;
    }
    container.innerHTML = state.messages.map((conversation) => `
      <button type="button" class="hk-activity-item" data-open-conversation="${conversation.id}">
        <i class="fa-regular fa-envelope"></i>
        <span>${escapeHTML(conversation.other_name || conversation.other_email || 'Conversation')} - ${escapeHTML(conversation.subject || conversation.body || 'No messages yet')}</span>
        <small>${conversation.unread_count ? `${conversation.unread_count} unread` : relativeTime(conversation.last_message_at)}</small>
      </button>
    `).join('');
    container.querySelectorAll('[data-open-conversation]').forEach((button) => {
      button.addEventListener('click', () => openConversation(button.dataset.openConversation));
    });
    prepareReveal(container);
    renderInboxPreview();
  }

  function renderInboxPreview() {
    const container = el('inbox-preview-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to view your inbox.');
      return;
    }
    if (!state.messages.length) {
      container.innerHTML = empty('No messages yet.');
      return;
    }
    container.innerHTML = state.messages.slice(0, 5).map((conversation) => `
      <button type="button" class="hk-inbox-item" data-open-inbox-conversation="${conversation.id}">
        <span class="hk-inbox-avatar">${escapeHTML(initials(conversation.other_name || conversation.other_email))}</span>
        <span>
          <strong>${escapeHTML(conversation.other_name || conversation.other_email || 'Conversation')}</strong>
          <small>${escapeHTML(conversation.subject || conversation.body || 'No messages yet')}</small>
        </span>
        <em>${conversation.unread_count ? `${conversation.unread_count} unread` : relativeTime(conversation.last_message_at)}</em>
      </button>
    `).join('');
    container.querySelectorAll('[data-open-inbox-conversation]').forEach((button) => {
      button.addEventListener('click', () => {
        showView('messages');
        openConversation(button.dataset.openInboxConversation);
      });
    });
  }

  async function openConversation(conversationId) {
    const view = el('conversation-view');
    if (!view) return;
    view.innerHTML = empty('Loading conversation...');
    try {
      const data = await fetchJson(`${API_BASE_URL}/messages/conversations/${conversationId}`, { headers: authHeaders() });
      const messages = data.messages || [];
      const last = messages[messages.length - 1];
      const receiverId = last?.sender_id === state.user?.id ? last.receiver_id : last?.sender_id;
      view.innerHTML = `
        ${messages.map((message) => `
          <article class="hk-entry-card">
            <div>
              <h4>${escapeHTML(message.sender_name)}</h4>
              <p>${escapeHTML(message.body)}</p>
              <span>${relativeTime(message.created_at)}</span>
            </div>
          </article>
        `).join('') || empty('No messages yet.')}
        <form class="hk-support-form" data-reply-conversation="${conversationId}">
          <div class="input-group"><label>Reply</label><textarea name="reply" required></textarea></div>
          <button type="submit" class="primary-btn">Send Reply</button>
        </form>
      `;
      view.querySelector('[data-reply-conversation]')?.addEventListener('submit', async (event) => {
        event.preventDefault();
        const body = event.currentTarget.reply.value.trim();
        if (!receiverId || !body) return;
        try {
          await fetchJson(`${API_BASE_URL}/messages`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({
              receiver_id: receiverId,
              application_id: data.conversation.application_id,
              opportunity_id: data.conversation.opportunity_id,
              subject: 'Reply',
              body,
            }),
          });
          showToast('Reply sent.');
          await loadMessages();
          await openConversation(conversationId);
        } catch (error) {
          showToast(error.message || 'Could not send reply.', true);
        }
      });
      prepareReveal(view);
    } catch (error) {
      view.innerHTML = empty('Could not open conversation.');
    }
  }

  function renderSavedOpportunities() {
    const container = el('saved-opportunities-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to view saved opportunities.');
      return;
    }
    const jobs = state.savedOpportunities.length
      ? state.savedOpportunities
      : (state.dashboard?.opportunities || []).filter((job) => state.saved.has(job.id) || state.saved.has(String(job.id)));
    if (jobs.length === 0) {
      container.innerHTML = empty('No saved opportunities yet.');
      return;
    }
    renderOpportunities('saved-opportunities-list', jobs);
  }

  async function loadSavedOpportunities() {
    if (!state.user) {
      state.savedOpportunities = [];
      return;
    }
    const savedIds = new Set([...state.saved].map(String));
    state.savedOpportunities = (state.dashboard?.opportunities || [])
      .filter((job) => savedIds.has(String(job.id)))
      .map((job) => ({ ...job, company: job.company || job.company_name }));
    localStorage.setItem('hirekeSavedOpportunityIds', JSON.stringify([...state.saved]));
  }

  function setValue(id, value) {
    const node = el(id);
    if (node) node.value = value || '';
  }

  function profileValue(key, fallback = '') {
    return state.profile?.[key] || state.user?.[key] || fallback;
  }

  function profileCompletion() {
    return Number(state.profile?.profile_completion || state.personal?.profileStrength || 0);
  }

  function routeForView(view) {
    const profileRoutes = new Set(['skills', 'experience', 'education', 'documents', 'applications', 'messages', 'saved', 'alerts', 'settings']);
    if (view === 'help') return '/contact';
    if (view === 'settings' && state.currentSettingsSection !== 'account') return `/profile/me/settings/${state.currentSettingsSection}`;
    return profileRoutes.has(view) ? `/profile/me/${view}` : '/';
  }

  function viewFromPath() {
    if (/^\/contact(?:-me)?\/?$/.test(window.location.pathname)) return 'help';
    const publicMatch = window.location.pathname.match(/^\/profile\/(\d+)\/?$/);
    if (publicMatch) return 'public-profile';
    const settingsMatch = window.location.pathname.match(/^\/profile\/me\/settings\/([^/]+)\/?$/);
    if (settingsMatch) {
      state.currentSettingsSection = settingsMatch[1];
      return 'settings';
    }
    const match = window.location.pathname.match(/^\/profile\/me\/([^/]+)\/?$/);
    if (!match) return null;
    const view = match[1];
    return ['skills', 'experience', 'education', 'documents', 'applications', 'messages', 'saved', 'alerts', 'settings'].includes(view) ? view : 'profile';
  }

  function fillProfileForm() {
    const profile = state.profile || {};
    setValue('profile-name', profile.name || state.user?.name || '');
    setValue('profile-headline', profile.headline || '');
    setValue('profile-location', profile.location || '');
    setValue('profile-skills', profile.skills || '');
    setValue('profile-about', profile.about || '');
    setValue('profile-certifications', profile.certifications || '');
    setValue('profile-career-goals', profile.career_goals || '');
  }

  function renderChips(containerId, items, emptyText = 'Add skills') {
    const container = el(containerId);
    if (!container) return;
    if (!items.length) {
      container.innerHTML = `<span class="hk-muted-chip">${escapeHTML(emptyText)}</span>`;
      return;
    }
    container.innerHTML = items.slice(0, 10).map((item) => `<span>${escapeHTML(item)}</span>`).join('');
  }

  function renderDocuments() {
    const profile = state.profile || {};
    const containers = ['account-documents-display', 'profile-page-documents'];
    const cvUrl = profile.cv_url;
    const content = cvUrl
      ? `<a class="hk-document-item" href="${escapeHTML(cvUrl)}" target="_blank" rel="noopener"><i class="fa-regular fa-file-lines"></i><span>Current CV</span><small>Open file</small></a>`
      : empty('No CV uploaded yet.');
    containers.forEach((id) => {
      const container = el(id);
      if (container) container.innerHTML = content;
    });
  }

  function yearsLabel(item) {
    if (!item.year_from && !item.year_to && !item.currently_working) return '';
    const end = item.currently_working ? 'Present' : (item.year_to || '');
    return [item.year_from || '', end].filter(Boolean).join(' - ');
  }

  function renderEducationList(containerId, entries, editable = false) {
    const container = el(containerId);
    if (!container) return;
    if (!entries.length) {
      container.innerHTML = empty('No education entries yet.');
      return;
    }
    container.innerHTML = entries.map((entry) => `
      <article class="hk-entry-card">
        <div>
          <small>${escapeHTML(entry.education_level || 'Education')}</small>
          <h4>${escapeHTML(entry.institution_name || 'Institution')}</h4>
          <p>${escapeHTML(entry.course || '')}</p>
          <span>${escapeHTML(yearsLabel(entry))}</span>
          ${entry.description ? `<p>${escapeHTML(entry.description)}</p>` : ''}
        </div>
        ${editable ? `<div class="hk-entry-actions"><button type="button" data-edit-education="${entry.id}">Edit</button><button type="button" data-delete-education="${entry.id}">Delete</button></div>` : ''}
      </article>
    `).join('');
    if (editable) bindEducationEntryActions(container);
    prepareReveal(container);
  }

  function renderExperienceList(containerId, entries, editable = false) {
    const container = el(containerId);
    if (!container) return;
    if (!entries.length) {
      container.innerHTML = empty('No experience entries yet.');
      return;
    }
    container.innerHTML = entries.map((entry) => `
      <article class="hk-entry-card">
        <div>
          <small>${escapeHTML(entry.employment_type || 'Experience')}</small>
          <h4>${escapeHTML(entry.job_title || 'Role')}</h4>
          <p>${escapeHTML(entry.organization_name || 'Organization')}</p>
          <span>${escapeHTML(yearsLabel(entry))}</span>
          ${entry.description ? `<p>${escapeHTML(entry.description)}</p>` : ''}
        </div>
        ${editable ? `<div class="hk-entry-actions"><button type="button" data-edit-experience="${entry.id}">Edit</button><button type="button" data-delete-experience="${entry.id}">Delete</button></div>` : ''}
      </article>
    `).join('');
    if (editable) bindExperienceEntryActions(container);
    prepareReveal(container);
  }

  function renderStandaloneProfileSections() {
    const profile = state.profile || {};
    const skills = splitList(profile.skills);
    renderChips('profile-page-skills', skills);
    renderExperienceList('profile-page-experience', state.experienceEntries);
    renderEducationList('profile-page-education', state.educationEntries);
    renderDocuments();
  }

  function renderSettings() {
    setText('settings-name', state.user?.name || 'Not signed in');
    setText('settings-email', state.user?.email || 'Not signed in');
    setText('settings-role', state.user?.role || 'Visitor');
    renderSettingsSection(state.currentSettingsSection);
    const notifications = state.personal?.notifications || [];
    const notificationsList = el('settings-notifications-list');
    if (notificationsList) notificationsList.innerHTML = notifications.length ? notifications.map((alert) => `<div class="hk-alert-item"><i class="fa-regular fa-bell"></i><span>${escapeHTML(alert.message)}</span><small>${relativeTime(alert.created_at)}</small></div>`).join('') : empty('No notifications yet.');
    const docsList = el('settings-documents-list');
    if (docsList) docsList.innerHTML = el('profile-page-documents')?.innerHTML || empty('No documents uploaded yet.');
    const appsList = el('settings-applications-list');
    if (appsList) appsList.innerHTML = el('applications-list')?.innerHTML || empty('No applications submitted yet.');
    setText('settings-verification-status', el('verification-current-status')?.textContent || 'Not verified');
    const prefs = state.consentPreferences || {};
    if (el('settings-recruiter-visible')) el('settings-recruiter-visible').checked = Boolean(prefs.recruiterProfileVisible);
    if (el('settings-ai-matching')) el('settings-ai-matching').checked = prefs.aiMatchingEnabled !== false;
    if (el('settings-cv-consent')) el('settings-cv-consent').checked = Boolean(prefs.cvProcessingConsent || state.profile?.cv_processing_consent === 1);
    renderNetwork();
  }

  function renderSettingsSection(section) {
    const safeSection = document.querySelector(`[data-settings-panel="${section}"]`) ? section : 'account';
    state.currentSettingsSection = safeSection;
    const labels = {
      account: 'My Account',
      security: 'Security',
      privacy: 'Privacy',
      opportunities: 'Opportunity Preferences',
      notifications: 'Notifications',
      documents: 'Documents',
      networking: 'Networking',
      applications: 'Applications',
      recruiter: 'Recruiter Preferences',
      verification: 'Verification',
      appearance: 'Appearance',
      connected: 'Connected Accounts',
      data: 'Data & Privacy',
      billing: 'Billing',
    };
    setText('settings-current-label', labels[safeSection] || 'Settings');
    document.querySelectorAll('[data-settings-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.settingsSection === safeSection);
    });
    document.querySelectorAll('[data-settings-panel]').forEach((panel) => {
      panel.classList.toggle('hidden', panel.dataset.settingsPanel !== safeSection);
      panel.classList.toggle('hk-view-enter', panel.dataset.settingsPanel === safeSection);
    });
    prepareReveal(document.querySelector(`[data-settings-panel="${safeSection}"]`) || document);
  }

  function renderNetwork() {
    const requests = el('network-requests-list');
    const connections = el('network-connections-list');
    const incoming = state.networkRequests.incoming || [];
    const outgoing = state.networkRequests.outgoing || [];
    if (requests) {
      const incomingHtml = incoming.map((item) => `
        <article class="hk-entry-card">
          <div><h4>${escapeHTML(item.name || 'HireKe user')}</h4><p>${escapeHTML(item.headline || item.email || '')}</p><span>Wants to connect</span></div>
          <div class="hk-entry-actions"><button type="button" data-accept-network="${item.id}">Accept</button><button type="button" data-reject-network="${item.id}">Reject</button></div>
        </article>
      `).join('');
      const outgoingHtml = outgoing.map((item) => `
        <article class="hk-entry-card"><div><h4>${escapeHTML(item.name || 'HireKe user')}</h4><p>${escapeHTML(item.headline || item.email || '')}</p><span>Request pending</span></div><div class="hk-entry-actions"><button type="button" data-remove-network="${item.id}">Withdraw</button></div></article>
      `).join('');
      requests.innerHTML = incomingHtml || outgoingHtml ? incomingHtml + outgoingHtml : empty('No pending requests.');
    }
    if (connections) {
      connections.innerHTML = state.connections.length ? state.connections.map((item) => `
        <article class="hk-entry-card"><div><h4>${escapeHTML(item.name || 'HireKe user')}</h4><p>${escapeHTML(item.headline || item.email || '')}</p><span>Messaging allowed for connected users</span></div><div class="hk-entry-actions"><button type="button" data-remove-network="${item.id}">Remove</button></div></article>
      `).join('') : empty('No connections yet.');
    }
  }

  function resetEducationForm() {
    ['education-entry-id', 'education-level', 'education-institution', 'education-course', 'education-year-from', 'education-year-to', 'education-description'].forEach((id) => setValue(id, ''));
  }

  function resetExperienceForm() {
    ['experience-entry-id', 'experience-organization', 'experience-title', 'experience-type', 'experience-year-from', 'experience-year-to', 'experience-description'].forEach((id) => setValue(id, ''));
    const current = el('experience-current');
    if (current) current.checked = false;
    el('experience-year-to')?.removeAttribute('disabled');
  }

  function bindEducationEntryActions(container) {
    container.querySelectorAll('[data-edit-education]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = state.educationEntries.find((item) => String(item.id) === String(button.dataset.editEducation));
        if (!entry) return;
        setValue('education-entry-id', entry.id);
        setValue('education-level', entry.education_level);
        setValue('education-institution', entry.institution_name);
        setValue('education-course', entry.course);
        setValue('education-year-from', entry.year_from);
        setValue('education-year-to', entry.year_to);
        setValue('education-description', entry.description);
        el('education-level')?.focus();
      });
    });
    container.querySelectorAll('[data-delete-education]').forEach((button) => {
      button.addEventListener('click', () => deleteEducation(button.dataset.deleteEducation));
    });
  }

  function bindExperienceEntryActions(container) {
    container.querySelectorAll('[data-edit-experience]').forEach((button) => {
      button.addEventListener('click', () => {
        const entry = state.experienceEntries.find((item) => String(item.id) === String(button.dataset.editExperience));
        if (!entry) return;
        setValue('experience-entry-id', entry.id);
        setValue('experience-organization', entry.organization_name);
        setValue('experience-title', entry.job_title);
        setValue('experience-type', entry.employment_type);
        setValue('experience-year-from', entry.year_from);
        setValue('experience-year-to', entry.year_to);
        setValue('experience-description', entry.description);
        const current = el('experience-current');
        if (current) current.checked = Boolean(entry.currently_working);
        el('experience-year-to')?.toggleAttribute('disabled', Boolean(entry.currently_working));
        el('experience-organization')?.focus();
      });
    });
    container.querySelectorAll('[data-delete-experience]').forEach((button) => {
      button.addEventListener('click', () => deleteExperience(button.dataset.deleteExperience));
    });
  }

  async function saveEducation() {
    if (!requireAuth()) return;
    const id = el('education-entry-id')?.value;
    const body = {
      education_level: el('education-level')?.value,
      institution_name: el('education-institution')?.value.trim(),
      course: el('education-course')?.value.trim(),
      year_from: el('education-year-from')?.value,
      year_to: el('education-year-to')?.value,
      description: el('education-description')?.value.trim(),
    };
    try {
      await fetchJson(`${API_BASE_URL}/profile/me/education${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await loadEditableProfile();
      renderAccountProfile();
      resetEducationForm();
      showToast('Education saved.');
    } catch (error) {
      showToast(error.message || 'Could not save education.', true);
    }
  }

  async function deleteEducation(id) {
    if (!requireAuth()) return;
    try {
      await fetchJson(`${API_BASE_URL}/profile/me/education/${id}`, { method: 'DELETE', headers: authHeaders() });
      await loadEditableProfile();
      renderAccountProfile();
      showToast('Education removed.');
    } catch (error) {
      showToast(error.message || 'Could not delete education.', true);
    }
  }

  async function saveExperience() {
    if (!requireAuth()) return;
    const id = el('experience-entry-id')?.value;
    const body = {
      organization_name: el('experience-organization')?.value.trim(),
      job_title: el('experience-title')?.value.trim(),
      employment_type: el('experience-type')?.value,
      year_from: el('experience-year-from')?.value,
      year_to: el('experience-year-to')?.value,
      currently_working: el('experience-current')?.checked,
      description: el('experience-description')?.value.trim(),
    };
    try {
      await fetchJson(`${API_BASE_URL}/profile/me/experience${id ? `/${id}` : ''}`, {
        method: id ? 'PUT' : 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      await loadEditableProfile();
      renderAccountProfile();
      resetExperienceForm();
      showToast('Experience saved.');
    } catch (error) {
      showToast(error.message || 'Could not save experience.', true);
    }
  }

  async function deleteExperience(id) {
    if (!requireAuth()) return;
    try {
      await fetchJson(`${API_BASE_URL}/profile/me/experience/${id}`, { method: 'DELETE', headers: authHeaders() });
      await loadEditableProfile();
      renderAccountProfile();
      showToast('Experience removed.');
    } catch (error) {
      showToast(error.message || 'Could not delete experience.', true);
    }
  }

  async function refreshNetwork() {
    if (!state.user) return;
    const [requests, connections] = await Promise.all([
      fetchJson(`${API_BASE_URL}/network/requests`, { headers: authHeaders() }),
      fetchJson(`${API_BASE_URL}/network/connections`, { headers: authHeaders() }),
    ]);
    state.networkRequests = requests.data || { incoming: [], outgoing: [] };
    state.connections = connections.data || [];
    renderNetwork();
  }

  async function updateNetworkRequest(id, action) {
    if (!requireAuth()) return;
    try {
      const url = action === 'remove' ? `${API_BASE_URL}/network/${id}` : `${API_BASE_URL}/network/${id}/${action}`;
      await fetchJson(url, { method: action === 'remove' ? 'DELETE' : 'PUT', headers: authHeaders() });
      await refreshNetwork();
      showToast(action === 'accept' ? 'Connection accepted.' : action === 'reject' ? 'Connection rejected.' : 'Connection updated.');
    } catch (error) {
      showToast(error.message || 'Could not update connection.', true);
    }
  }

  async function loadPublicProfileFromPath() {
    const match = window.location.pathname.match(/^\/profile\/(\d+)\/?$/);
    if (!match) return;
    const userId = match[1];
    try {
      const data = await fetchJson(`${API_BASE_URL}/profile/${userId}`, { headers: authHeaders() });
      state.publicProfile = data.data;
      renderPublicProfile();
    } catch (error) {
      const container = document.querySelector('[data-view-section="public-profile"] .hk-panel');
      if (container) container.innerHTML = `<div class="hk-empty is-error">${escapeHTML(error.message || 'Could not load profile.')}</div>`;
    }
  }

  function connectionForPublicProfile() {
    const profileId = Number(state.publicProfile?.id);
    if (!state.user || !profileId) return null;
    const incoming = state.networkRequests.incoming || [];
    const outgoing = state.networkRequests.outgoing || [];
    const accepted = state.connections || [];
    return accepted.find((item) => Number(item.user_id) === profileId)
      || incoming.find((item) => Number(item.requester_id) === profileId)
      || outgoing.find((item) => Number(item.receiver_id) === profileId)
      || null;
  }

  function renderPublicProfile() {
    const profile = state.publicProfile || {};
    const name = profile.fullName || profile.name || 'HireKe user';
    setText('public-profile-name', name);
    setText('public-profile-headline', profile.headline || 'HireKe profile');
    setText('public-profile-location', profile.location || 'Kenya');
    setText('public-profile-about', profile.about || 'No profile summary yet.');
    const avatar = el('public-profile-avatar');
    if (avatar) {
      if (profile.avatarUrl) avatar.innerHTML = `<img src="${escapeHTML(profile.avatarUrl)}" alt="${escapeHTML(name)} profile photo" />`;
      else avatar.textContent = initials(name);
    }
    renderExperienceList('public-profile-experience', profile.experienceEntries || []);
    renderEducationList('public-profile-education', profile.educationEntries || []);

    const connectButton = el('public-connect-btn');
    const messageButton = el('public-message-btn');
    if (!connectButton) return;
    const isOwner = state.user && Number(state.user.id) === Number(profile.id);
    connectButton.classList.toggle('hidden', isOwner);
    messageButton?.classList.toggle('hidden', isOwner);
    if (isOwner) return;
    const connection = connectionForPublicProfile();
    if (messageButton) {
      messageButton.disabled = connection?.status !== 'accepted';
      messageButton.textContent = connection?.status === 'accepted' ? 'Message' : 'Message after connecting';
    }
    const label = connectButton.querySelector('.btn-label');
    if (!state.user) {
      if (label) label.textContent = 'Log in to Connect';
      connectButton.disabled = false;
      return;
    }
    if (connection?.status === 'accepted') {
      if (label) label.textContent = 'Connected';
      connectButton.disabled = true;
      return;
    }
    if (connection?.status === 'pending') {
      if (label) label.textContent = connection.receiver_id === state.user.id ? 'Respond in Networking' : 'Request Sent';
      connectButton.disabled = true;
      return;
    }
    if (label) label.textContent = 'Connect';
    connectButton.disabled = false;
  }

  async function connectToPublicProfile() {
    if (!state.publicProfile) return;
    if (!requireAuth()) return;
    const button = el('public-connect-btn');
    setButtonLoading(button, true, 'Sending...');
    try {
      await fetchJson(`${API_BASE_URL}/network/connect/${state.publicProfile.id}`, { method: 'POST', headers: authHeaders() });
      await refreshNetwork();
      showToast('Connection request sent.');
    } catch (error) {
      showToast(error.message || 'Could not send connection request.', true);
    } finally {
      setButtonLoading(button, false);
      renderPublicProfile();
    }
  }

  async function messagePublicProfile() {
    if (!state.publicProfile || !requireAuth()) return;
    try {
      const data = await fetchJson(`${API_BASE_URL}/network/can-message/${state.publicProfile.id}`, { headers: authHeaders() });
      if (!data.data?.canMessage) {
        showToast(data.data?.reason || 'Messaging is available after connecting.', true);
        return;
      }
      showToast('Messaging center Coming Soon.');
    } catch (error) {
      showToast(error.message || 'Could not check messaging access.', true);
    }
  }

  function renderProfilePhoto(name) {
    const avatarUrl = state.profile?.avatar_url || state.user?.avatar_url || '';
    const photo = el('account-avatar-large');
    const chip = el('user-avatar');
    if (photo) {
      if (avatarUrl) {
        photo.innerHTML = `<img src="${escapeHTML(avatarUrl)}" alt="${escapeHTML(name)} profile photo" />`;
      } else {
        photo.textContent = initials(name);
      }
    }
    if (chip) {
      if (avatarUrl) {
        chip.innerHTML = `<img src="${escapeHTML(avatarUrl)}" alt="" />`;
      } else {
        chip.textContent = initials(name);
      }
    }
  }

  function setProfileSection(section) {
    state.currentProfileSection = section || 'about';
    document.querySelectorAll('[data-profile-section]').forEach((node) => {
      node.classList.toggle('hidden', node.dataset.profileSection !== state.currentProfileSection);
    });
    document.querySelectorAll('[data-profile-tab]').forEach((button) => {
      button.classList.toggle('active', button.dataset.profileTab === state.currentProfileSection);
    });
    document.querySelectorAll('[data-account-section]').forEach((button) => {
      button.classList.toggle('active', button.dataset.accountSection === state.currentProfileSection);
    });
    prepareReveal(profileModal || document);
  }

  function renderAccountRecommendations() {
    const container = el('account-recommended-list');
    if (!container) return;
    const jobs = state.dashboard?.recommended || [];
    if (!jobs.length) {
      container.innerHTML = empty('No recommendations yet.');
      return;
    }
    container.innerHTML = jobs.slice(0, 3).map((job) => `
      <button type="button" data-job-id="${job.id}">
        <span class="hk-company-logo">${escapeHTML(initials(job.company))}</span>
        <span><strong>${job.title || 'Opportunity'}</strong><small>${job.company || 'HireKe partner'} · ${job.location || 'Kenya'}</small></span>
        <em>${matchPercent(job)}% Match</em>
      </button>
    `).join('');
    container.querySelectorAll('[data-job-id]').forEach((button) => {
      button.addEventListener('click', () => {
        const job = state.dashboard.opportunities.find((item) => String(item.id) === String(button.dataset.jobId));
        openJobModal(job);
      });
    });
  }

  function renderAccountProfile() {
    const profile = state.profile || {};
    const name = profile.name || state.user?.name || 'Your Name';
    const headline = profile.headline || 'Add a headline recruiters will remember.';
    const location = profile.location || 'Add location';
    const skills = splitList(profile.skills);
    const completion = profileCompletion();
    const missingTips = [
      ['Add your headline', profile.headline],
      ['Add your work experience', state.experienceEntries.length],
      ['Add your education', state.educationEntries.length],
      ['Add skills (3 more recommended)', profile.skills],
      ['Upload a CV', profile.cv_url],
    ];

    setText('account-profile-name', name);
    setText('account-profile-headline', headline);
    setText('account-profile-location', location);
    setText('account-profile-work', 'Add work preference');
    setText('account-profile-score', `${completion}%`);
    setText('account-profile-score-copy', completion >= 80 ? 'Very good. Complete a few more steps.' : 'Complete more profile details to improve matches.');
    setText('account-about-display', profile.about || 'Add a short summary about your background, goals, and strengths.');
    setText('account-fact-location', location);
    setText('account-fact-experience', state.experienceEntries.length ? 'Added' : 'Not set');
    renderExperienceList('account-experience-display', state.experienceEntries);
    renderEducationList('account-education-display', state.educationEntries);
    setText('account-goals-display', profile.career_goals || 'Add your short and long-term goals.');
    setText('account-ai-greeting', `Hi ${name.split(' ')[0]}! How can I help you today?`);
    setText('account-analytics-applications', state.personal?.analytics?.applications || 0);
    setText('account-analytics-interviews', state.personal?.analytics?.interviews || 0);
    setText('account-analytics-offers', state.personal?.analytics?.offers || 0);
    document.querySelectorAll('.hk-profile-ring').forEach((ring) => {
      ring.style.setProperty('--score', completion);
    });
    renderProfilePhoto(name);
    renderChips('account-skill-chips', skills.slice(0, 6));
    renderChips('account-skills-display', skills);
    renderStandaloneProfileSections();
    renderSettings();
    renderApplications(state.personal?.applications || []);
    const accountActivity = el('account-activity-display');
    if (accountActivity) accountActivity.innerHTML = el('applications-list')?.innerHTML || empty('No applications submitted yet.');
    const tips = el('account-profile-tips');
    if (tips) {
      tips.innerHTML = missingTips.map(([label, value]) => `
        <li class="${value ? 'complete' : ''}"><i class="fa-solid ${value ? 'fa-check' : 'fa-circle'}"></i>${label}</li>
      `).join('');
    }
    fillProfileForm();
    renderExperienceList('experience-editor-list', state.experienceEntries, true);
    renderEducationList('education-editor-list', state.educationEntries, true);
    renderAccountRecommendations();
    setProfileSection(state.currentProfileSection);
  }

  function toggleProfileEditor(show) {
    document.querySelector('.hk-account-layout')?.classList.toggle('hidden', show);
    el('profile-form')?.classList.toggle('hidden', !show);
    if (show) fillProfileForm();
  }

  function showView(view, options = {}) {
    state.currentView = view;
    document.querySelectorAll('[data-view-section]').forEach((section) => {
      section.classList.toggle('hidden', section.dataset.viewSection !== view);
      section.classList.toggle('hk-view-enter', section.dataset.viewSection === view);
    });
    document.querySelectorAll('[data-nav-view]').forEach((link) => {
      link.classList.toggle('active', link.dataset.navView === view);
    });
    if (view === 'opportunities') renderCurrentTab();
    if (view === 'saved') renderSavedOpportunities();
    if (view === 'applications') renderApplications(state.personal?.applications || []);
    if (view === 'messages') loadMessages();
    if (view === 'alerts') renderAllAlerts();
    if (view === 'assistant') {
      if (!state.aiMatchesLoaded) loadAiMatches();
      renderAiMatches();
    }
    if (['skills', 'experience', 'education', 'documents'].includes(view)) renderStandaloneProfileSections();
    if (view === 'settings') renderSettings();
    if (view === 'public-profile') loadPublicProfileFromPath();
    if (view === 'premium') loadVerificationStatus();
    if (!options.skipHistory) {
      const nextPath = routeForView(view);
      if (window.location.pathname !== nextPath) {
        window.history.pushState({ view }, '', nextPath);
      }
    }
    window.setTimeout(() => {
      document.querySelectorAll('.hk-view-enter').forEach((section) => section.classList.remove('hk-view-enter'));
    }, 280);
    prepareReveal(document.querySelector(`[data-view-section="${view}"]`) || document);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function loadVerificationStatus() {
    const status = el('verification-current-status');
    if (!status || !state.user) return;
    try {
      const data = await fetchJson(`${API_BASE_URL}/payments/verification`, { headers: authHeaders() });
      const verification = data.verification || {};
      const latest = data.requests?.[0];
      const label = verification.status && verification.status !== 'none'
        ? `${verification.status}${verification.badge_label ? ` · ${verification.badge_label}` : ''}`
        : latest
          ? `${latest.status} · ${latest.plan_code}`
          : 'Not verified';
      status.textContent = label;
    } catch (error) {
      status.textContent = 'Could not load status';
    }
  }

  function openPremiumView() {
    if (!requireAuth()) return;
    toggleModal(profileModal, false);
    showView('premium');
  }

  function renderCategories() {
    const container = el('category-list');
    if (!container) return;
    const categories = state.dashboard?.categories || [];
    clearLoading(container);
    container.innerHTML = categories.map((category) => `
      <button type="button" class="hk-category" data-category="${category.name}">
        <span>${category.name}</span>
        <strong>${category.count}</strong>
      </button>
    `).join('');

    container.querySelectorAll('[data-category]').forEach((button) => {
      button.addEventListener('click', () => {
        const category = button.dataset.category;
        const jobs = (state.dashboard?.opportunities || []).filter((job) => job.category === category);
        renderOpportunities('tab-opportunity-list', jobs);
        document.querySelectorAll('[data-tab]').forEach((tab) => tab.classList.remove('active'));
        el('opportunities-panel')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    });
    prepareReveal(container);
  }

  function renderActivity(applications) {
    const container = el('activity-list');
    if (!container) return;
    if (!state.user) {
      container.innerHTML = empty('Log in to see applications, saved opportunities, and profile updates.');
      prepareReveal(container);
      return;
    }
    if (!applications || applications.length === 0) {
      container.innerHTML = empty('No activity yet. Start by viewing an approved opportunity.');
      prepareReveal(container);
      return;
    }
    container.innerHTML = applications.slice(0, 4).map((app) => `
      <div class="hk-activity-item">
        <i class="fa-regular fa-square-check"></i>
        <span>Applied to ${app.title} at ${app.company}</span>
        <small>${relativeTime(app.applied_at)}</small>
      </div>
    `).join('');
    prepareReveal(container);
  }

  function renderAnalytics(analytics) {
    animateCounter('analytics-applications', analytics.applications || 0);
    animateCounter('analytics-responses', analytics.responses || 0);
    animateCounter('analytics-interviews', analytics.interviews || 0);
    animateCounter('analytics-offers', analytics.offers || 0);
  }

  function openJobModal(job) {
    if (!job) return;
    setText('job-modal-title', job.title || 'Opportunity');
    setText('job-modal-company', job.company || 'HireKe partner');
    setText('job-modal-location', `Location: ${job.location || 'Kenya'}`);
    setText('job-modal-salary', `Compensation: ${job.salary || 'Not specified'}`);
    setText('job-modal-description', job.description || 'No description provided yet.');

    const requirements = Array.isArray(job.requirements) ? job.requirements : [];
    el('job-modal-requirements').innerHTML = requirements.length
      ? requirements.map((item) => `<li>${item}</li>`).join('')
      : '<li>No requirements listed yet.</li>';
    const method = job.application_method || 'easy_apply';
    const methodLabels = {
      easy_apply: 'Apply with your HireKe Opportunity Passport.',
      external_website: 'This recruiter accepts applications on their official website.',
      email: 'This recruiter accepts applications by email.',
      whatsapp: 'This recruiter accepts applications on WhatsApp.',
    };
    el('job-modal-apply').textContent = state.user ? methodLabels[method] : 'Log in to apply, save, and track this opportunity.';
    renderJobAiMatch(job);

    const openExternalApplication = () => {
      if (method === 'email') {
        const email = job.application_email || job.recruiter_email || 'hello@hireke.co.ke';
        const body = `Name: ${state.user?.name || ''}\nPhone:\nEmail: ${state.user?.email || ''}\n\nPlease find my CV attached.`;
        window.location.href = `mailto:${email}?subject=${encodeURIComponent(`Application for ${job.title}`)}&body=${encodeURIComponent(body)}`;
        return;
      }

      if (method === 'whatsapp') {
        const phone = job.application_whatsapp || '';
        const profileLink = `${window.location.origin}/api/profile/${state.user.id}`;
        const text = `Hello,\n\nI am interested in applying for:\n${job.title}\n\nMy HireKe Profile:\n${profileLink}\n\nThank you.`;
        window.open(`https://wa.me/${phone}?text=${encodeURIComponent(text)}`, '_blank', 'noopener');
        return;
      }

      showToast(method === 'external_website' ? 'Use the official website button for this opportunity.' : 'Use Apply Now to submit in HireKe.');
    };

    el('job-modal-website').textContent = ({
      easy_apply: 'Apply Now',
      external_website: 'Apply on Official Website',
      email: 'Apply via Email',
      whatsapp: 'Apply via WhatsApp',
    })[method] || 'Apply Now';

    el('job-modal-email').textContent = state.saved.has(job.id) || state.saved.has(String(job.id)) ? 'Saved' : 'Save opportunity';

    el('job-modal-website').onclick = async () => {
      if (!requireAuth()) return;
      try {
        if (method === 'easy_apply') {
          await fetchJson(`${API_BASE_URL}/jobs/${job.id}/apply`, {
            method: 'POST',
            headers: { ...authHeaders(), 'Content-Type': 'application/json' },
            body: JSON.stringify({ cv_score: state.personal?.profileStrength || 0 }),
          });
          showToast('Application submitted to the recruiter.');
          await loadPersonalDashboard();
          return;
        }

        await trackApplicationStart(job);
        if (method === 'external_website') {
          window.open(job.application_url, '_blank', 'noopener');
        } else if (method === 'email') {
          openExternalApplication();
        } else if (method === 'whatsapp') {
          openExternalApplication();
        }
      } catch (error) {
        showToast(error.message || 'Could not start application.', true);
      }
    };

    el('job-modal-email').onclick = async () => {
      await saveOpportunity(job, el('job-modal-email'));
      el('job-modal-email').textContent = state.saved.has(job.id) || state.saved.has(String(job.id)) ? 'Saved' : 'Save opportunity';
    };

    toggleModal(jobModal, true);
  }

  async function renderJobAiMatch(job) {
    const panel = el('job-modal-ai-match');
    if (!panel) return;
    if (!state.user || state.user.role === 'recruiter') {
      panel.classList.add('hidden');
      panel.innerHTML = '';
      return;
    }
    const cached = state.aiMatches.find((match) => String(match.opportunityId || match.id) === String(job.id));
    if (cached) {
      panel.classList.remove('hidden');
      panel.innerHTML = `
        <h3>Your AI Match <span class="hk-ai-match-score">${Number(cached.matchScore || 0)}%</span></h3>
        <ul>${(cached.matchReasons || []).slice(0, 4).map((reason) => `<li>${escapeHTML(reason)}</li>`).join('')}</ul>
        ${(cached.missingSkills || []).length ? `<small>Missing or unclear: ${escapeHTML(cached.missingSkills.slice(0, 5).join(', '))}</small>` : '<small>Your profile covers the strongest signals we found.</small>'}
      `;
      return;
    }
    panel.classList.remove('hidden');
    panel.innerHTML = '<h3>Your AI Match <span class="hk-ai-match-score">...</span></h3><small>Calculating locally from your HireKe profile.</small>';
    try {
      const match = await fetchJson(`${API_BASE_URL}/ai/job-seeker/opportunities/${job.id}/match`, { headers: authHeaders() });
      panel.innerHTML = `
        <h3>Your AI Match <span class="hk-ai-match-score">${Number(match.matchScore || 0)}%</span></h3>
        <ul>${(match.matchReasons || []).slice(0, 4).map((reason) => `<li>${escapeHTML(reason)}</li>`).join('')}</ul>
        ${(match.improvementTips || []).length ? `<small>${escapeHTML(match.improvementTips.slice(0, 2).join(' '))}</small>` : ''}
      `;
    } catch (error) {
      panel.innerHTML = `<h3>Your AI Match</h3><small>${escapeHTML(error.message || 'Could not calculate this match yet.')}</small>`;
    }
  }

  function jobMatchesExperience(job, experience) {
    if (!experience) return true;
    const text = `${job.title || ''} ${job.description || ''} ${job.requirements?.join?.(' ') || ''}`.toLowerCase();
    if (experience === 'Entry Level') return /entry|junior|intern|graduate|trainee|0-?2 years/.test(text);
    if (experience === 'Mid Level') return /mid|associate|2-?5 years|3 years|4 years|5 years/.test(text);
    if (experience === 'Senior Level') return /senior|lead|manager|head|director|5\+|6 years|7 years|8 years/.test(text);
    return true;
  }

  function filteredOpportunities(query = el('home-search-input')?.value || '') {
    const q = query.trim().toLowerCase();
    const location = el('filter-location')?.value || '';
    const category = el('filter-category')?.value || '';
    const experience = el('filter-experience')?.value || '';
    const type = el('filter-type')?.value || '';
    const selectedTypes = [...state.selectedOpportunityTypes].filter((item) => item !== 'More');

    return (state.dashboard?.opportunities || []).filter((job) => {
      const jobCategory = job.category || 'Jobs';
      const searchable = `${job.title || ''} ${job.company || ''} ${job.location || ''} ${jobCategory} ${job.description || ''}`.toLowerCase();
      const matchesQuery = !q || searchable.includes(q);
      const matchesTypeSelection = selectedTypes.length === 0 || selectedTypes.includes(jobCategory);
      const matchesMore = !state.selectedOpportunityTypes.has('More') || !['Jobs', 'Internships', 'Scholarships', 'Grants', 'Tenders', 'Fellowships', 'Competitions'].includes(jobCategory);
      const matchesLocation = !location || (job.location || '').toLowerCase() === location.toLowerCase();
      const matchesCategory = !category || jobCategory === category;
      const matchesJobType = !type || (job.job_type || job.type || '').toLowerCase() === type.toLowerCase();
      return matchesQuery && matchesTypeSelection && matchesMore && matchesLocation && matchesCategory && matchesJobType && jobMatchesExperience(job, experience);
    });
  }

  function applySearch(query) {
    const q = query.trim().toLowerCase();
    const suggestions = el('hk-search-suggestions');
    suggestions?.classList.add('hidden');
    const hasFilters = state.selectedOpportunityTypes.size || el('filter-location')?.value || el('filter-category')?.value || el('filter-experience')?.value || el('filter-type')?.value;
    if (!q && !hasFilters) {
      renderOpportunities('recommended-list', state.dashboard?.recommended || []);
      renderCurrentTab();
      return;
    }

    const results = filteredOpportunities(query);

    renderOpportunities('recommended-list', results);
    renderOpportunities('standalone-opportunity-list', results);
    showView('opportunities');
    if (results.length === 0) showToast('No approved opportunities match that search.', true);
  }

  function populateSearchFilters() {
    const jobs = state.dashboard?.opportunities || [];
    const setOptions = (id, label, values) => {
      const select = el(id);
      if (!select) return;
      const current = select.value;
      select.innerHTML = `<option value="">${label}</option>${values.map((value) => `<option>${escapeHTML(value)}</option>`).join('')}`;
      if (values.includes(current)) select.value = current;
    };
    const unique = (values) => [...new Set(values.map((value) => String(value || '').trim()).filter(Boolean))].sort((a, b) => a.localeCompare(b));
    setOptions('filter-location', 'Location', unique(jobs.map((job) => job.location || 'Kenya')));
    setOptions('filter-category', 'Category', unique(jobs.map((job) => job.category || 'Jobs')));
    setOptions('filter-type', 'Type', unique(jobs.map((job) => job.job_type || job.type || 'Opportunity')));
  }

  function renderCompanies() {
    const container = el('companies-list');
    if (!container) return;
    const companies = [...new Map((state.dashboard?.opportunities || [])
      .map((job) => [job.company || 'HireKe partner', job])
    ).values()];
    if (!companies.length) {
      container.innerHTML = empty('No approved companies yet.');
      return;
    }
    container.innerHTML = companies.slice(0, 12).map((job) => `
      <button type="button" class="hk-category" data-company-name="${escapeHTML(job.company || '')}">
        <span>${escapeHTML(job.company || 'HireKe partner')}</span>
        <strong>${(state.dashboard?.opportunities || []).filter((item) => item.company === job.company).length}</strong>
      </button>
    `).join('');
    container.querySelectorAll('[data-company-name]').forEach((button) => {
      button.addEventListener('click', () => {
        const company = button.dataset.companyName;
        const results = (state.dashboard?.opportunities || []).filter((job) => job.company === company);
        renderOpportunities('standalone-opportunity-list', results);
        showView('opportunities');
      });
    });
  }

  function updateSearchSuggestions(query) {
    let panel = el('hk-search-suggestions');
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'hk-search-suggestions';
      panel.className = 'hk-search-suggestions hidden';
      el('home-search-form')?.appendChild(panel);
    }
    const q = query.trim().toLowerCase();
    if (!q || q.length < 2) {
      panel.classList.add('hidden');
      return;
    }
    const matches = (state.dashboard?.opportunities || [])
      .filter((job) => `${job.title} ${job.company} ${job.category}`.toLowerCase().includes(q))
      .slice(0, 5);
    if (!matches.length) {
      panel.innerHTML = '<div class="hk-search-empty">No matching suggestions</div>';
      panel.classList.remove('hidden');
      return;
    }
    panel.innerHTML = matches.map((job) => `
      <button type="button" data-suggestion="${escapeHTML(job.title || '')}">
        <span>${escapeHTML(job.title || 'Opportunity')}</span>
        <small>${escapeHTML(job.company || job.category || 'HireKe partner')}</small>
      </button>
    `).join('');
    panel.querySelectorAll('button').forEach((button) => {
      button.addEventListener('click', () => {
        el('home-search-input').value = button.dataset.suggestion || '';
        applySearch(button.dataset.suggestion || '');
      });
    });
    panel.classList.remove('hidden');
  }

  async function loadPublicDashboard() {
    state.dashboardLoadError = null;
    renderSkeletons('recommended-list', 4, 'opportunity');
    renderSkeletons('tab-opportunity-list', 5, 'opportunity');
    renderSkeletons('standalone-opportunity-list', 5, 'opportunity');
    renderSkeletons('recent-alerts-list', 4, 'alert');
    renderSkeletons('category-list', 6, 'category');
    try {
      state.dashboard = await fetchJson(`${API_BASE_URL}/dashboard/public`);
    } catch (error) {
      state.dashboardLoadError = error;
      state.dashboard = { opportunities: [], recommended: [], newOpportunities: [], trending: [], expiringSoon: [], categories: [], recentAlerts: [] };
      showToast('Could not load opportunities from the API.', true);
    }

    if (state.dashboardLoadError) {
      const recommendedContainer = el('recommended-list');
      if (recommendedContainer) recommendedContainer.innerHTML = listState('Could not load recommended opportunities. Please refresh and try again.', 'error');
    } else {
      renderOpportunities('recommended-list', state.dashboard.recommended);
    }
    populateSearchFilters();
    renderCurrentTab();
    renderAlerts();
    renderCategories();
    renderCompanies();
    renderSavedOpportunities();
    openSharedJobFromUrl();
  }

  async function loadPersonalDashboard() {
    const token = localStorage.getItem(tokenKey);
    if (!token) {
      state.user = null;
      state.personal = null;
      state.profile = null;
      state.educationEntries = [];
      state.experienceEntries = [];
      state.networkRequests = { incoming: [], outgoing: [] };
      state.connections = [];
      state.messages = [];
      state.consentPreferences = null;
      updatePersonalUI();
      renderAlerts();
      renderAllAlerts();
      document.documentElement.classList.remove('auth-restoring');
      return;
    }

    try {
      renderSkeletons('activity-list', 3, 'activity');
      renderSkeletons('applications-list', 3, 'activity');
      renderSkeletons('all-alerts-list', 4, 'alert');
      state.personal = await fetchJson(`${API_BASE_URL}/dashboard/me`, { headers: authHeaders() });
      state.user = state.personal.user;
      if (Array.isArray(state.personal.savedOpportunityIds)) {
        state.saved = new Set(state.personal.savedOpportunityIds);
      }
      await loadEditableProfile();
      await loadConsentPreferences();
      await loadMessages();
      await loadSavedOpportunities();
      await loadAiMatches();
    } catch (_) {
      localStorage.removeItem(tokenKey);
      localStorage.removeItem('userRole');
      state.user = null;
      state.personal = null;
      state.profile = null;
      state.educationEntries = [];
      state.experienceEntries = [];
      state.networkRequests = { incoming: [], outgoing: [] };
      state.connections = [];
      state.messages = [];
      state.savedOpportunities = [];
      state.aiMatches = [];
      state.aiMatchesLoaded = false;
      state.consentPreferences = null;
    }

    updatePersonalUI();
    renderAlerts();
    renderAllAlerts();
    document.documentElement.classList.remove('auth-restoring');
  }

  async function loadEditableProfile() {
    if (!state.user) return;
    try {
      const data = await fetchJson(`${API_BASE_URL}/profile/me/edit`, { headers: authHeaders() });
      state.profile = data.data || null;
      const [education, experience, requests, connections] = await Promise.all([
        fetchJson(`${API_BASE_URL}/profile/me/education`, { headers: authHeaders() }),
        fetchJson(`${API_BASE_URL}/profile/me/experience`, { headers: authHeaders() }),
        fetchJson(`${API_BASE_URL}/network/requests`, { headers: authHeaders() }),
        fetchJson(`${API_BASE_URL}/network/connections`, { headers: authHeaders() }),
      ]);
      state.educationEntries = education.data || [];
      state.experienceEntries = experience.data || [];
      state.networkRequests = requests.data || { incoming: [], outgoing: [] };
      state.connections = connections.data || [];
    } catch (error) {
      state.profile = null;
      state.educationEntries = [];
      state.experienceEntries = [];
    }
  }

  async function loadConsentPreferences() {
    if (!state.user) return;
    try {
      const data = await fetchJson(`${API_BASE_URL}/legal/consents/me`, { headers: authHeaders() });
      state.consentPreferences = data.preferences || null;
    } catch (_) {
      state.consentPreferences = null;
    }
  }

  function hasCvConsent() {
    return state.consentPreferences?.cvProcessingConsent || state.profile?.cv_processing_consent === 1;
  }

  async function uploadCvFile(file) {
    if (!state.user || !file) return;
    if (!hasCvConsent()) {
      throw new Error('Please enable CV processing consent in Privacy settings before uploading a CV.');
    }
    const formData = new FormData();
    const profile = state.profile || {};
    formData.append('name', profile.name || state.user.name || '');
    formData.append('headline', profile.headline || '');
    formData.append('location', profile.location || '');
    formData.append('about', profile.about || '');
    formData.append('skills', profile.skills || '');
    formData.append('certifications', profile.certifications || '');
    formData.append('career_goals', profile.career_goals || '');
    formData.append('cv_processing_consent', 'true');
    formData.append('cv', file);
    await fetchJson(`${API_BASE_URL}/profile/me`, { method: 'PATCH', headers: authHeaders(), body: formData });
    await loadEditableProfile();
    await loadPersonalDashboard();
  }

  async function savePrivacyChoices() {
    if (!requireAuth()) return;
    const status = el('settings-privacy-status');
    try {
      const data = await fetchJson(`${API_BASE_URL}/legal/consents/me`, {
        method: 'PUT',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recruiterProfileVisible: el('settings-recruiter-visible')?.checked,
          aiMatchingEnabled: el('settings-ai-matching')?.checked,
          cvProcessingConsent: el('settings-cv-consent')?.checked,
        }),
      });
      state.consentPreferences = data.preferences;
      if (status) status.textContent = 'Privacy choices saved.';
      showToast('Privacy choices saved.');
      if (state.consentPreferences?.aiMatchingEnabled === false) {
        state.aiMatches = [];
        state.aiMatchesLoaded = false;
        renderAiMatches();
      }
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message || 'Could not save privacy choices.', true);
    }
  }

  async function deleteCurrentCv() {
    if (!requireAuth()) return;
    if (!window.confirm('Delete the active CV from your HireKe profile?')) return;
    const status = el('settings-privacy-status');
    try {
      await fetchJson(`${API_BASE_URL}/profile/me/cv`, { method: 'DELETE', headers: authHeaders() });
      await loadEditableProfile();
      renderPersonalProfile();
      renderSettings();
      if (status) status.textContent = 'Active CV deleted from your profile.';
      showToast('Active CV deleted from your profile.');
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message || 'Could not delete CV.', true);
    }
  }

  async function requestAccountDeletion() {
    if (!requireAuth()) return;
    if (!window.confirm('Submit an account deletion request for compliance review?')) return;
    const status = el('settings-data-status');
    try {
      const data = await fetchJson(`${API_BASE_URL}/legal/data-deletion-requests`, {
        method: 'POST',
        headers: { ...authHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ requestType: 'account_closure', details: 'Requested from Privacy & Data settings.' }),
      });
      if (status) status.textContent = `Deletion request submitted. Reference: ${data.requestId}`;
      showToast('Deletion request submitted.');
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message || 'Could not submit deletion request.', true);
    }
  }

  async function downloadMyData() {
    if (!requireAuth()) return;
    const status = el('settings-data-status');
    try {
      const data = await fetchJson(`${API_BASE_URL}/legal/data-export/me`, { headers: authHeaders() });
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'hireke-data-export.json';
      link.click();
      URL.revokeObjectURL(url);
      if (status) status.textContent = 'Data export downloaded.';
    } catch (error) {
      if (status) status.textContent = error.message;
      showToast(error.message || 'Could not download your data.', true);
    }
  }

  async function openPolicyModal(slug = 'privacy') {
    const title = el('policy-modal-title');
    const meta = el('policy-modal-meta');
    const content = el('policy-modal-content');
    if (!policyModal || !content) {
      window.location.href = `/${slug}`;
      return;
    }
    setText('policy-modal-title', slug === 'privacy' ? 'Data Protection & Privacy Policy' : 'Policy');
    setText('policy-modal-meta', '');
    content.replaceChildren(Object.assign(document.createElement('p'), { textContent: 'Loading policy...' }));
    toggleModal(policyModal, true);
    try {
      const data = await fetchJson(`${API_BASE_URL}/legal/policies/${encodeURIComponent(slug)}`);
      const policy = data.policy;
      if (title) title.textContent = policy.title === 'Privacy Policy' ? 'Data Protection & Privacy Policy' : policy.title;
      if (meta) meta.textContent = `Version ${policy.version} | Effective ${policy.effectiveDate} | Last updated ${policy.lastUpdated}`;
      content.replaceChildren();
      (policy.sections || []).forEach((section) => {
        const wrapper = document.createElement('section');
        const heading = document.createElement('h3');
        heading.textContent = section.heading || '';
        wrapper.appendChild(heading);
        String(section.body || '').split(/\n+/).filter(Boolean).forEach((paragraph) => {
          const p = document.createElement('p');
          p.textContent = paragraph;
          wrapper.appendChild(p);
        });
        content.appendChild(wrapper);
      });
    } catch (error) {
      content.replaceChildren(Object.assign(document.createElement('p'), { textContent: error.message || 'Could not load policy.' }));
    }
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const form = event.currentTarget;
    const submitButton = el('auth-submit-btn');
    const mode = form.dataset.mode;
    const email = el('auth-email').value.trim();
    const password = el('auth-password').value;
    const confirmPassword = el('auth-confirm-password')?.value || '';

    if (mode === 'signup' && !selectedRole) {
      showToast('Choose whether you are a recruiter or job seeker.', true);
      return;
    }

    if (mode === 'signup' && !el('auth-terms-agree').checked) {
      showToast('Please agree to the Terms of Service and acknowledge the Privacy Policy to continue.', true);
      return;
    }

    if (mode === 'signup' && password !== confirmPassword) {
      showToast('Passwords do not match.', true);
      return;
    }

    setButtonLoading(submitButton, true, mode === 'signup' ? 'Creating account...' : 'Signing in...');

    try {
      const endpoint = mode === 'signup' ? 'signup' : 'login';
      const body = mode === 'signup'
        ? {
            email,
            password,
            confirm_password: confirmPassword,
            name: el('auth-name').value.trim(),
            phone_number: el('auth-phone').value.trim(),
            role: selectedRole,
            company_name: selectedRole === 'recruiter' ? el('auth-company')?.value.trim() : null,
            terms_accepted: el('auth-terms-agree').checked,
            cv_processing_consent: el('auth-cv-consent').checked,
            recruiter_profile_visible: el('auth-recruiter-visible').checked,
            ai_matching_enabled: el('auth-ai-matching').checked,
            marketing_optin: el('auth-marketing-optin').checked,
            county: el('auth-county').value.trim(),
            industry: el('auth-industry').value.trim(),
          }
        : { email, password };

      const data = await fetchJson(`${API_BASE_URL}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (data.requiresVerification || data.unverified) {
        showToast(data.message || 'Verification code sent to your email.');
        openVerificationModal(data.email || email);
        return;
      }

      localStorage.setItem(tokenKey, data.token);
      localStorage.setItem('userRole', data.user.role);
      toggleModal(authModal, false);
      await loadPersonalDashboard();
      showToast(mode === 'signup' ? 'Account created. Welcome to HireKe.' : 'Welcome back.');

      if (data.user.role === 'recruiter') {
        window.location.href = 'recruiter-dashboard.html';
      }
    } catch (error) {
      if (error.data?.unverified) {
        showToast(error.data.error || 'Verification code sent to your email.');
        openVerificationModal(error.data.email || email);
        return;
      }
      showToast(error.message, true);
    } finally {
      setButtonLoading(submitButton, false);
    }
  }

  async function handleVerificationSubmit(event) {
    event.preventDefault();
    const submitButton = el('verification-submit-btn');
    const email = verificationState.email;
    const otp = el('verification-code').value.trim();

    if (!email || otp.length !== 6) {
      showToast('Enter the 6-digit verification code.', true);
      return;
    }

    setButtonLoading(submitButton, true, 'Verifying...');

    try {
      const data = await fetchJson(`${API_BASE_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, otp }),
      });

      localStorage.setItem(tokenKey, data.token);
      localStorage.setItem('userRole', data.user.role);
      toggleModal(verificationModal, false);
      await loadPersonalDashboard();
      showToast('Email verified. Welcome to HireKe.');

      if (data.user.role === 'recruiter') {
        window.location.href = 'recruiter-dashboard.html';
      }
    } catch (error) {
      showToast(error.message, true);
    } finally {
      setButtonLoading(submitButton, false);
    }
  }

  async function startPasswordReset() {
    const email = el('auth-email').value.trim();
    if (!email) {
      showToast('Enter your email first, then request a password reset.', true);
      el('auth-email').focus();
      return;
    }

    try {
      const data = await fetchJson(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });
      showToast(data.message || 'Password reset code sent to your email.');
    } catch (error) {
      showToast(error.message || 'Could not send a reset code.', true);
    }
  }

  async function startSocialAuth(provider, button) {
    const mode = el('auth-form')?.dataset.mode || 'login';
    const role = mode === 'signup' ? selectedRole : 'jobseeker';
    if (mode === 'signup' && !selectedRole) {
      showToast('Choose recruiter or job seeker before using social sign up.', true);
      return;
    }

    button?.classList.add('is-loading');
    button.disabled = true;
    try {
      const data = await fetchJson(`${API_BASE_URL}/auth/social/${provider}/start?role=${encodeURIComponent(role || 'jobseeker')}`);
      if (data.authUrl) {
        window.location.href = data.authUrl;
        return;
      }
      showToast('Social login is not configured for this provider yet.', true);
    } catch (error) {
      showToast(error.message || 'Social login is not configured yet.', true);
    } finally {
      button?.classList.remove('is-loading');
      if (button) button.disabled = false;
    }
  }

  async function resendVerificationCode() {
    if (!verificationState.email) {
      showToast('Enter your email and password again to request a code.', true);
      return;
    }

    try {
      await fetchJson(`${API_BASE_URL}/auth/resend-verification-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: verificationState.email }),
      });
      showToast('New verification code sent.');
    } catch (error) {
      showToast(error.message, true);
    }
  }

  function logout() {
    localStorage.removeItem(tokenKey);
    localStorage.removeItem('userRole');
    state.user = null;
    state.personal = null;
    state.profile = null;
    state.educationEntries = [];
    state.experienceEntries = [];
    state.networkRequests = { incoming: [], outgoing: [] };
    state.connections = [];
    updatePersonalUI();
    renderAlerts();
    showToast('You have been logged out.');
  }

  document.querySelectorAll('[data-protected], [data-protected-cta]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      if (!requireAuth()) return;
      toggleModal(profileModal, true);
    });
  });

  document.querySelectorAll('[data-nav-view]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      if (node.dataset.requiresAuth !== undefined && !requireAuth()) return;
      if (node.dataset.navView === 'profile') {
        toggleModal(profileModal, true);
        return;
      }
      showView(node.dataset.navView);
    });
  });

  document.querySelectorAll('[data-signup-cta]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openRoleModal();
    });
  });

  document.querySelectorAll('[data-profile-cta]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      if (state.user) {
        toggleModal(profileModal, true);
        if (node.dataset.profileSectionTarget) setProfileSection(node.dataset.profileSectionTarget);
      } else openRoleModal();
    });
  });

  document.querySelectorAll('[data-open-premium]').forEach((node) => {
    node.addEventListener('click', (event) => {
      event.preventDefault();
      openPremiumView();
    });
  });

  el('sidebar-collapse-btn')?.addEventListener('click', () => {
    setSidebarCollapsed(true);
  });

  el('sidebar-wake-btn')?.addEventListener('click', () => {
    setSidebarCollapsed(false);
  });

  document.querySelectorAll('[data-tab]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentTab = button.dataset.tab;
      document.querySelectorAll('[data-tab]').forEach((tab) => {
        tab.classList.toggle('active', tab.dataset.tab === state.currentTab);
      });
      renderCurrentTab();
    });
  });

  document.querySelectorAll('[data-profile-tab]').forEach((button) => {
    button.addEventListener('click', () => setProfileSection(button.dataset.profileTab));
  });

  document.querySelectorAll('[data-account-section]').forEach((button) => {
    button.addEventListener('click', () => setProfileSection(button.dataset.accountSection));
  });

  document.querySelectorAll('[data-account-view]').forEach((button) => {
    button.addEventListener('click', () => {
      toggleModal(profileModal, false);
      showView(button.dataset.accountView);
    });
  });

  document.querySelectorAll('[data-settings-section]').forEach((button) => {
    button.addEventListener('click', () => {
      state.currentSettingsSection = button.dataset.settingsSection;
      renderSettings();
      const nextPath = routeForView('settings');
      if (window.location.pathname !== nextPath) window.history.pushState({ view: 'settings' }, '', nextPath);
    });
  });

  document.addEventListener('click', (event) => {
    const accept = event.target.closest?.('[data-accept-network]');
    const reject = event.target.closest?.('[data-reject-network]');
    const remove = event.target.closest?.('[data-remove-network]');
    if (accept) updateNetworkRequest(accept.dataset.acceptNetwork, 'accept');
    if (reject) updateNetworkRequest(reject.dataset.rejectNetwork, 'reject');
    if (remove) updateNetworkRequest(remove.dataset.removeNetwork, 'remove');
  });

  el('home-search-form').addEventListener('submit', (event) => {
    event.preventDefault();
    applySearch(el('home-search-input').value);
  });

  el('home-search-input')?.addEventListener('input', (event) => {
    updateSearchSuggestions(event.currentTarget.value);
  });

  el('search-filters-toggle')?.addEventListener('click', () => {
    const toggle = el('search-filters-toggle');
    const expanded = toggle?.getAttribute('aria-expanded') === 'true';
    setSearchFiltersExpanded(!expanded);
  });

  document.querySelectorAll('[data-opportunity-type]').forEach((button) => {
    button.addEventListener('click', () => {
      const type = button.dataset.opportunityType;
      if (state.selectedOpportunityTypes.has(type)) state.selectedOpportunityTypes.delete(type);
      else state.selectedOpportunityTypes.add(type);
      button.classList.toggle('is-selected', state.selectedOpportunityTypes.has(type));
    });
  });

  ['filter-location', 'filter-category', 'filter-experience', 'filter-type'].forEach((id) => {
    el(id)?.addEventListener('change', () => applySearch(el('home-search-input')?.value || ''));
  });

  el('filter-search-btn')?.addEventListener('click', () => applySearch(el('home-search-input')?.value || ''));

  el('find-opportunities-btn')?.addEventListener('click', () => {
    showView('opportunities');
  });

  el('view-more-opportunities')?.addEventListener('click', () => showView('opportunities'));
  el('inbox-top-btn')?.addEventListener('click', () => {
    if (requireAuth()) showView('messages');
  });
  el('alerts-top-btn')?.addEventListener('click', () => {
    if (requireAuth()) showView('alerts');
  });
  el('mobile-inbox-btn')?.addEventListener('click', () => {
    if (requireAuth()) showView('messages');
  });
  el('mobile-alerts-btn')?.addEventListener('click', () => {
    if (requireAuth()) showView('alerts');
  });
  el('mobile-menu-btn')?.addEventListener('click', () => {
    const next = !document.body.classList.contains('mobile-nav-open');
    document.body.classList.toggle('mobile-nav-open', next);
    el('mobile-menu-btn')?.setAttribute('aria-expanded', String(next));
  });

  el('public-connect-btn')?.addEventListener('click', connectToPublicProfile);
  el('public-message-btn')?.addEventListener('click', messagePublicProfile);
  el('education-save')?.addEventListener('click', saveEducation);
  el('education-form-reset')?.addEventListener('click', resetEducationForm);
  el('experience-save')?.addEventListener('click', saveExperience);
  el('experience-form-reset')?.addEventListener('click', resetExperienceForm);
  el('experience-current')?.addEventListener('change', (event) => {
    const yearTo = el('experience-year-to');
    if (!yearTo) return;
    yearTo.toggleAttribute('disabled', event.currentTarget.checked);
    if (event.currentTarget.checked) yearTo.value = '';
  });

  el('loginBtn').addEventListener('click', () => {
    if (state.user) logout();
    else openAuthModal('login');
  });

  el('profileBtn')?.addEventListener('click', (event) => {
    event.stopPropagation();
    el('account-menu')?.classList.toggle('hidden');
  });

  document.addEventListener('click', (event) => {
    if (!event.target.closest?.('.hk-account')) {
      el('account-menu')?.classList.add('hidden');
    }
  });

  el('open-profile-menu-btn')?.addEventListener('click', () => {
    el('account-menu')?.classList.add('hidden');
    if (requireAuth()) toggleModal(profileModal, true);
  });

  el('open-recruiter-menu-btn')?.addEventListener('click', () => {
    window.location.href = 'recruiter-dashboard.html';
  });

  el('open-premium-menu-btn')?.addEventListener('click', () => {
    el('account-menu')?.classList.add('hidden');
    openPremiumView();
  });

  el('logout-menu-btn')?.addEventListener('click', () => {
    el('account-menu')?.classList.add('hidden');
    logout();
  });

  el('messages-refresh-btn')?.addEventListener('click', () => {
    if (requireAuth()) loadMessages();
  });

  el('signupBtn').addEventListener('click', openRoleModal);
  el('sidebar-login').addEventListener('click', (event) => {
    event.preventDefault();
    if (state.user) logout();
    else openAuthModal('login');
  });
  el('sidebar-signup').addEventListener('click', (event) => {
    event.preventDefault();
    openRoleModal();
  });

  el('auth-switch').addEventListener('click', () => {
    if (el('auth-form').dataset.mode === 'login') openRoleModal();
    else openAuthModal('login');
  });
  el('auth-back').addEventListener('click', openRoleModal);
  el('auth-cancel').addEventListener('click', () => toggleModal(authModal, false));
  el('role-close').addEventListener('click', () => toggleModal(roleModal, false));
  el('profile-close').addEventListener('click', () => toggleModal(profileModal, false));
  el('job-modal-close').addEventListener('click', () => toggleModal(jobModal, false));
  el('policy-modal-close')?.addEventListener('click', () => toggleModal(policyModal, false));
  modalBackdrop.addEventListener('click', () => {
    [authModal, roleModal, profileModal, jobModal, policyModal, verificationModal].forEach((modal) => toggleModal(modal, false));
  });

  document.querySelectorAll('[data-policy-modal]').forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      openPolicyModal(link.dataset.policyModal || 'privacy');
    });
  });

  document.querySelectorAll('.role-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedRole = card.dataset.role;
      openAuthModal('signup');
    });
  });

  el('auth-form').addEventListener('submit', handleAuthSubmit);
  el('verification-form').addEventListener('submit', handleVerificationSubmit);
  el('verification-resend').addEventListener('click', resendVerificationCode);
  el('verification-close').addEventListener('click', () => toggleModal(verificationModal, false));
  el('forgot-password-link')?.addEventListener('click', startPasswordReset);
  el('profile-form').addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;

    const formData = new FormData();
    formData.append('name', el('profile-name').value.trim());
    formData.append('headline', el('profile-headline').value.trim());
    formData.append('location', el('profile-location').value.trim());
    formData.append('about', el('profile-about').value.trim());
    formData.append('skills', el('profile-skills').value.trim());
    formData.append('certifications', el('profile-certifications').value.trim());
    formData.append('career_goals', el('profile-career-goals').value.trim());
    const cvFile = el('profile-cv').files?.[0];
    if (cvFile) {
      if (!hasCvConsent()) {
        showToast('Please enable CV processing consent in Privacy settings before uploading a CV.', true);
        return;
      }
      formData.append('cv_processing_consent', 'true');
      formData.append('cv', cvFile);
    }

    try {
      const data = await fetchJson(`${API_BASE_URL}/profile/me`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: formData,
      });
      if (data?.data?.name && state.user) state.user.name = data.data.name;
      await loadEditableProfile();
      await loadPersonalDashboard();
      toggleProfileEditor(false);
      showToast('Profile saved.');
    } catch (error) {
      showToast(error.message || 'Could not save profile.', true);
    }
  });

  el('profile-edit-toggle')?.addEventListener('click', () => toggleProfileEditor(true));
  el('profile-edit-cancel')?.addEventListener('click', () => toggleProfileEditor(false));
  document.querySelectorAll('[data-profile-edit-link]').forEach((button) => {
    button.addEventListener('click', () => toggleProfileEditor(true));
  });

  ['profile-cv', 'profile-cv-modal', 'profile-cv-page'].forEach((inputId) => {
    el(inputId)?.addEventListener('change', async () => {
      const file = el(inputId).files?.[0];
      if (!state.user || !file) return;
      try {
        await uploadCvFile(file);
        showToast('CV uploaded.');
      } catch (error) {
        showToast(error.message || 'Could not upload CV.', true);
      } finally {
        el(inputId).value = '';
      }
    });
  });

  el('profile-photo-input')?.addEventListener('change', () => {
    const file = el('profile-photo-input').files?.[0];
    if (!file) return;
    state.pendingPhotoFile = file;
    const previewUrl = URL.createObjectURL(file);
    const photo = el('account-avatar-large');
    if (photo) {
      photo.innerHTML = `<img src="${previewUrl}" alt="Profile photo preview" />`;
    }
    el('profile-photo-save')?.classList.remove('hidden');
  });

  el('profile-photo-save')?.addEventListener('click', async () => {
    if (!requireAuth() || !state.pendingPhotoFile) return;
    const formData = new FormData();
    formData.append('avatar', state.pendingPhotoFile);
    try {
      const data = await fetchJson(`${API_BASE_URL}/profile/me/photo`, {
        method: 'PATCH',
        headers: authHeaders(),
        body: formData,
      });
      if (state.profile) state.profile.avatar_url = data.data?.avatarUrl;
      if (state.user) state.user.avatar_url = data.data?.avatarUrl;
      state.pendingPhotoFile = null;
      el('profile-photo-input').value = '';
      el('profile-photo-save')?.classList.add('hidden');
      await loadEditableProfile();
      renderAccountProfile();
      showToast('Profile photo saved.');
    } catch (error) {
      showToast(error.message || 'Could not save profile photo.', true);
    }
  });

  el('support-contact-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const status = el('support-contact-status');
    const submitButton = el('support-contact-submit');
    const subject = el('support-subject').value.trim();
    const message = el('support-message').value.trim();
    const name = el('support-name').value.trim();
    const email = el('support-email').value.trim();
    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

    if (!name || !email || !subject || !message) {
      if (status) status.textContent = 'Please fill in all fields before sending.';
      showToast('Please fill in all contact fields.', true);
      return;
    }

    if (!emailPattern.test(email)) {
      if (status) status.textContent = 'Please enter a valid email address.';
      showToast('Please enter a valid email address.', true);
      return;
    }

    if (status) status.textContent = 'Sending your message...';
    setButtonLoading(submitButton, true, 'Sending...');
    try {
      const time = new Date().toLocaleString();
      if (!window.emailjs?.send) {
        throw new Error('Email service is still loading. Please try again in a moment.');
      }

      const config = await fetchJson(`${API_BASE_URL}/email/config`);
      await window.emailjs.send(
        config.serviceId,
        config.templateId,
        {
          title: subject,
          name,
          email,
          message,
          time,
        },
        config.publicKey
      );

      form.reset();
      if (status) status.textContent = 'Message sent successfully.';
      showToast('Message sent successfully.');
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not send message.';
      showToast(error.message || 'Could not send message.', true);
    } finally {
      setButtonLoading(submitButton, false);
    }
  });

  el('verification-upgrade-form')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!requireAuth()) return;
    const status = el('verification-upgrade-status');
    const planCode = document.querySelector('input[name="verification-plan"]:checked')?.value || 'standard';
    const phone = el('verification-phone').value.trim();
    if (planCode !== 'standard' && !phone) {
      showToast('Enter your M-Pesa phone number for paid verification.', true);
      el('verification-phone').focus();
      return;
    }
    if (planCode !== 'standard' && !el('verification-billing-ack')?.checked) {
      showToast('Please acknowledge the selected product, amount, and payment policy before payment.', true);
      return;
    }
    if (status) status.textContent = 'Submitting verification request...';

    const formData = new FormData();
    formData.append('planCode', planCode);
    formData.append('notes', el('verification-notes').value.trim());
    const files = el('verification-documents').files || [];
    Array.from(files).forEach((file) => {
      formData.append('documents', file);
      formData.append('documentTypes', 'supporting_document');
    });

    try {
      const submit = await fetchJson(`${API_BASE_URL}/payments/verification/submit`, {
        method: 'POST',
        headers: authHeaders(),
        body: formData,
      });

      if (submit.requiresPayment) {
        if (status) status.textContent = 'Sending PalPlus STK Push...';
        const payment = await fetchJson(`${API_BASE_URL}/payments/verification/pay`, {
          method: 'POST',
          headers: { ...authHeaders(), 'Content-Type': 'application/json' },
          body: JSON.stringify({ requestId: submit.requestId, phone }),
        });
        if (status) status.textContent = payment.message || 'STK Push sent. Enter your M-Pesa PIN.';
        showToast(payment.message || 'STK Push sent. Enter your M-Pesa PIN.');
      } else {
        if (status) status.textContent = submit.message || 'Verification submitted for review.';
        showToast(submit.message || 'Verification submitted for review.');
      }

      event.currentTarget.reset();
      await loadVerificationStatus();
    } catch (error) {
      if (status) status.textContent = error.message || 'Could not start verification.';
      showToast(error.message || 'Could not start verification.', true);
    }
  });

  el('themeToggle')?.addEventListener('click', () => {
    document.body.classList.toggle('hk-dark');
  });

  window.addEventListener('scroll', () => {
    document.body.classList.toggle('hk-has-scrolled', window.scrollY > 12);
  }, { passive: true });

  window.addEventListener('popstate', () => {
    showView(viewFromPath() || 'dashboard', { skipHistory: true });
  });

  window.addEventListener('resize', () => {
    window.clearTimeout(window.__hirekeResizeTimer);
    window.__hirekeResizeTimer = window.setTimeout(syncResponsiveDefaults, 120);
  });

  if (window.setupPasswordToggle) {
    window.setupPasswordToggle({ inputId: 'auth-password', toggleButtonId: 'toggleAuthPassword' });
  }

  setupRevealObserver();
  applyTheme(preferredTheme());
  el('theme-toggle')?.addEventListener('click', toggleTheme);
  el('mobile-theme-toggle')?.addEventListener('click', toggleTheme);
  el('settings-theme-toggle')?.addEventListener('change', (event) => applyTheme(event.target.checked ? 'dark' : 'light'));
  el('settings-save-privacy')?.addEventListener('click', savePrivacyChoices);
  el('settings-delete-cv')?.addEventListener('click', deleteCurrentCv);
  el('settings-request-deletion')?.addEventListener('click', requestAccountDeletion);
  el('settings-download-data')?.addEventListener('click', downloadMyData);
  el('refresh-ai-matches')?.addEventListener('click', loadAiMatches);
  syncResponsiveDefaults();
  updatePersonalUI();
  loadPublicDashboard().then(async () => {
    await loadPersonalDashboard();
    const initialView = viewFromPath();
    if (initialView) showView(initialView, { skipHistory: true });
    if (initialView === 'public-profile') renderPublicProfile();
  });
});
