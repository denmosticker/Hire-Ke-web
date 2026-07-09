const API_BASE_URL = `${window.location.origin}/api`;
let currentUser = null;
let token = null;
const recruiterReduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const recruiterThemeKey = 'hirekeTheme';

function applyRecruiterTheme(theme) {
  const nextTheme = theme === 'dark' ? 'dark' : 'light';
  document.documentElement.dataset.theme = nextTheme;
  localStorage.setItem(recruiterThemeKey, nextTheme);
  const button = document.getElementById('recruiter-theme-toggle');
  if (button) {
    const label = nextTheme === 'dark' ? 'Light mode' : 'Dark mode';
    button.setAttribute('aria-label', label);
    button.setAttribute('title', label);
    button.innerHTML = `<i class="${nextTheme === 'dark' ? 'far fa-sun' : 'far fa-moon'}"></i>`;
  }
}

function preferredRecruiterTheme() {
  return 'light';
}

function showRecruiterToast(message, error = false) {
  const stack = document.getElementById('recruiterToastStack') || document.body.appendChild(Object.assign(document.createElement('div'), {
    id: 'recruiterToastStack',
    className: 'recruiter-toast-stack',
  }));
  const toast = document.createElement('div');
  toast.className = `recruiter-toast ${error ? 'is-error' : 'is-success'}`;
  toast.textContent = String(message || '');
  stack.appendChild(toast);
  window.setTimeout(() => toast.classList.add('is-leaving'), 2600);
  window.setTimeout(() => toast.remove(), 3050);
}

window.alert = (message) => showRecruiterToast(message, /fail|error|unable|invalid/i.test(String(message || '')));

function recruiterSkeletonRows(count = 4) {
  return `<div class="recruiter-skeleton-stack">${Array.from({ length: count }, () => `
    <div class="recruiter-skeleton-row"><span></span><span></span><span></span></div>
  `).join('')}</div>`;
}

function animateRecruiterValue(id, value) {
  const node = document.getElementById(id);
  if (!node) return;
  const finalValue = Number(value || 0);
  if (recruiterReduceMotion || node.dataset.animated === 'true') {
    node.textContent = Math.round(finalValue).toLocaleString();
    return;
  }
  node.dataset.animated = 'true';
  const start = performance.now();
  const tick = (now) => {
    const progress = Math.min(1, (now - start) / 760);
    const eased = 1 - Math.pow(1 - progress, 3);
    node.textContent = Math.round(finalValue * eased).toLocaleString();
    if (progress < 1) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
}

function setRecruiterSkeletons() {
  ['pipelineRow', 'recentApplicantsContainer', 'jobPerformanceList', 'applicationMethodStats', 'jobsList'].forEach((id) => {
    const node = document.getElementById(id);
    if (node) node.innerHTML = recruiterSkeletonRows(id === 'pipelineRow' ? 5 : 4);
  });
  document.querySelectorAll('.stat-value').forEach((node) => node.classList.add('recruiter-skeleton-text'));
}

function clearRecruiterStatSkeletons() {
  document.querySelectorAll('.recruiter-skeleton-text').forEach((node) => node.classList.remove('recruiter-skeleton-text'));
}

// Initialize dashboard
document.addEventListener('DOMContentLoaded', () => {
  applyRecruiterTheme(preferredRecruiterTheme());
  document.getElementById('recruiter-theme-toggle')?.addEventListener('click', () => {
    applyRecruiterTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');
  });
  document.getElementById('view-as-jobseeker')?.addEventListener('click', () => {
    window.location.href = 'index.html?view=jobseeker';
  });

  token = localStorage.getItem('token');
  if (!token) {
    window.location.href = 'index.html';
    return;
  }

  setRecruiterSkeletons();
  loadUserData();
  loadDashboardStats();
  loadJobs();
  loadApplicants();
  loadMessages();
  setupMenuNavigation();
  setupApplicationMethodFields();
});

function setText(id, value) {
  const node = document.getElementById(id);
  if (node) node.textContent = value;
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

// Load user data
async function loadUserData() {
  try {
    const response = await fetch(`${API_BASE_URL}/auth/me`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      localStorage.removeItem('token');
      window.location.href = 'index.html';
      return;
    }

    currentUser = await response.json();
    const company = currentUser.company_name || 'Your Company';
    setText('userName', currentUser.name || 'Recruiter');
    setText('userAvatar', (currentUser.name || 'R').charAt(0).toUpperCase());
    setText('companyName', company);
    setText('sidebarCompanyName', company);
    setText('sidebarRecruiterName', currentUser.name || 'Recruiter');
    setText('sidebarRecruiterCompany', company);
    document.getElementById('recruiterNameInput').value = currentUser.name || '';
    document.getElementById('companyNameInput').value = currentUser.company_name || '';
    document.getElementById('companyWebsite').value = currentUser.company_url || '';
    document.getElementById('companyLogoUrl').value = currentUser.company_logo || '';

    // Check if premium
    checkSubscriptionStatus();
  } catch (error) {
    console.error('Failed to load user data:', error);
  }
}

// Load dashboard stats
async function loadDashboardStats() {
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/dashboard`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const data = await response.json();
      clearRecruiterStatSkeletons();
      animateRecruiterValue('statViews', data.stats.totalViews || 0);
      animateRecruiterValue('statApplicants', data.stats.applicants || 0);
      animateRecruiterValue('statShortlisted', data.stats.shortlisted || 0);
      animateRecruiterValue('statHired', data.stats.hired || 0);
      animateRecruiterValue('statActiveJobs', data.stats.activeJobs || 0);
      animateRecruiterValue('statModernViews', data.stats.totalViews || 0);
      animateRecruiterValue('statModernApplicants', data.stats.applicants || 0);
      animateRecruiterValue('statModernShortlisted', data.stats.shortlisted || 0);
      animateRecruiterValue('statModernHired', data.stats.hired || 0);
      setText('statStarts', `${data.stats.applicationStarts || 0} starts`);
      setText('statResponseRate', `${data.stats.responseRate || 0}% response`);
      renderPipeline(data.pipeline || []);
      renderRecentApplications(data.recentApplications || []);
      renderJobPerformance(data.jobPerformance || []);
      renderApplicationMethods(data.applicationsByMethod || []);
    }
  } catch (error) {
    console.error('Failed to load stats:', error);
  }
}

function renderPipeline(rows) {
  const counts = rows.reduce((acc, row) => {
    acc[row.status] = Number(row.count || 0);
    return acc;
  }, {});
  const steps = [
    ['Applied', (counts.Applied || 0) + (counts.Submitted || 0)],
    ['Screening', counts.Reviewing || 0],
    ['Shortlisted', counts.Shortlisted || 0],
    ['Interview', (counts.Interview || 0) + (counts.Interviewing || 0)],
    ['Hired', (counts.Hired || 0) + (counts.Offered || 0)],
  ];
  const container = document.getElementById('pipelineRow');
  if (!container) return;
  container.innerHTML = steps.map(([label, value]) => `
    <div class="pipeline-step"><div><small>${label}</small>${value}</div></div>
  `).join('');
}

function renderRecentApplications(applications) {
  const container = document.getElementById('recentApplicantsContainer');
  if (!container) return;
  if (applications.length === 0) {
    container.innerHTML = '<p style="color: #7080a0;">No applicants yet. Post your first job to receive applications.</p>';
    return;
  }
  container.innerHTML = applications.map((app) => `
    <div class="recent-row">
      <div>
        <strong>${escapeHTML(app.applicant_name)}</strong>
        <small>${escapeHTML(app.job_title)} - ${escapeHTML((app.application_method || 'easy_apply').replace('_', ' '))}</small>
      </div>
      <span class="applicant-score">${app.cv_score || 0}%</span>
    </div>
  `).join('');
}

function renderJobPerformance(jobs) {
  const container = document.getElementById('jobPerformanceList');
  if (!container) return;
  if (jobs.length === 0) {
    container.innerHTML = '<p style="color: #7080a0;">No jobs posted yet.</p>';
    return;
  }
  container.innerHTML = jobs.map((job) => `
    <div class="job-performance-row">
      <div>
        <strong>${escapeHTML(job.title)}</strong>
        <small>${escapeHTML(job.status)} - ${escapeHTML((job.application_method || 'easy_apply').replace('_', ' '))} - ${Number(job.applications || 0)} applications</small>
      </div>
      <span>${job.shortlisted || 0} shortlisted</span>
    </div>
  `).join('');
}

function renderApplicationMethods(methods) {
  const container = document.getElementById('applicationMethodStats');
  if (!container) return;
  const labels = {
    easy_apply: 'Easy Apply',
    external_website: 'External Website',
    email: 'Email Apply',
    whatsapp: 'WhatsApp Apply',
  };
  const total = methods.reduce((sum, item) => sum + Number(item.count || 0), 0) || 1;
  container.innerHTML = ['easy_apply', 'external_website', 'email', 'whatsapp'].map((method) => {
    const count = Number(methods.find((item) => item.method === method)?.count || 0);
    const pct = Math.round((count / total) * 100);
    return `
      <div class="method-row">
        <div>
          <strong>${labels[method]}</strong>
          <div class="method-bar"><span style="width: ${pct}%"></span></div>
        </div>
        <span>${count}</span>
      </div>
    `;
  }).join('');
}

// Load recruiter's jobs
async function loadJobs() {
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/jobs-list`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const jobs = await response.json();
      const jobsList = document.getElementById('jobsList');

      if (jobs.length === 0) {
        jobsList.innerHTML = '<li style="padding: 20px; text-align: center; color: #7080a0;">No jobs posted yet</li>';
        return;
      }

      const safeJobs = jobs.map((job) => ({
        ...job,
        title: escapeHTML(job.title),
        location: escapeHTML(job.location),
        application_method: escapeHTML((job.application_method || 'easy_apply').replace('_', ' ')),
      }));

      jobsList.innerHTML = safeJobs.map(job => `
        <li class="job-item">
          <div class="job-info">
            <h4>${job.title} ${job.featured ? '<span class="featured-badge">⭐ Featured</span>' : ''}</h4>
            <p>${job.location} • Status: ${job.status === 'pending' ? '⏳ Pending Approval' : '✓ Approved'}</p>
            <p>Applicants: ${Number(job.applicant_count || 0)} - Apply: ${escapeHTML((job.application_method || 'easy_apply').replace('_', ' '))}</p>
          </div>
          <div class="job-actions">
            ${job.status === 'approved' ? `
              <button class="feature-btn" onclick="toggleFeature(${job.id})">${job.featured ? '⭐ Unfeature' : '📌 Feature'}</button>
              <button class="feature-btn" onclick="loadAiMatchedCandidates(${job.id})">AI candidates</button>
            ` : ''}
            <button class="feature-btn" style="background: #ef4444;" onclick="deleteJob(${job.id})">Delete</button>
          </div>
        </li>
      `).join('');
    }
  } catch (error) {
    console.error('Failed to load jobs:', error);
  }
}

// Check subscription status
async function checkSubscriptionStatus() {
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/subscription`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const subscription = await response.json();
      const banner = document.getElementById('premiumBanner');
      const expiryAlert = document.getElementById('expiryAlert');
      const planName = document.getElementById('planName');
      const daysRemainingEl = document.getElementById('daysRemaining');
      const renewNowBtn = document.getElementById('renewNowBtn');

      if (subscription.plan_type === 'free' || subscription.active === 0) {
        banner.style.display = 'block';
        expiryAlert.style.display = subscription.expiry_date ? 'block' : 'none'; // Only show alert if they previously had premium
        planName.textContent = 'Free Plan';
        daysRemainingEl.style.display = 'none';
        if (renewNowBtn) renewNowBtn.style.display = 'none';
      } else {
        banner.style.display = 'none';
        expiryAlert.style.display = 'none';
        const expiry = new Date(subscription.expiry_date);
        planName.textContent = 'Premium Plan - ' + expiry.toLocaleDateString();

        // Calculate days remaining
        const today = new Date();
        const diffTime = expiry - today;
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        daysRemainingEl.textContent = diffDays > 0 ? `${diffDays} days remaining` : 'Expires today';
        daysRemainingEl.style.display = 'block';

        // Show Renew Now button if less than 5 days remaining
        if (renewNowBtn) {
          renewNowBtn.style.display = diffDays < 5 ? 'inline-block' : 'none';
        }
      }
    }
  } catch (error) {
    console.error('Failed to check subscription:', error);
  }
}

// Setup menu navigation
function setupMenuNavigation() {
  const menuLinks = document.querySelectorAll('.menu-link');
  const pageSections = document.querySelectorAll('.page-section');

  menuLinks.forEach(link => {
    link.addEventListener('click', (e) => {
      e.preventDefault();
      const page = link.dataset.page;

      // Hide all sections
      pageSections.forEach(section => section.classList.remove('active'));
      const target = document.getElementById(page);
      target?.classList.add('active', 'page-enter');
      window.setTimeout(() => target?.classList.remove('page-enter'), 260);

      // Update active menu
      menuLinks.forEach(m => m.classList.remove('active'));
      link.classList.add('active');
      if (page === 'applicants') loadApplicants();
      if (page === 'messages') loadMessages();
    });
  });
}

function switchPage(page) {
  document.querySelectorAll('.page-section').forEach(section => section.classList.remove('active'));
  const target = document.getElementById(page);
  target?.classList.add('active', 'page-enter');
  window.setTimeout(() => target?.classList.remove('page-enter'), 260);
  document.querySelectorAll('.menu-link').forEach(link => link.classList.toggle('active', link.dataset.page === page));
}

function setupApplicationMethodFields() {
  const methodSelect = document.getElementById('applicationMethod');
  if (!methodSelect) return;
  const update = () => {
    const method = methodSelect.value;
    document.querySelectorAll('.apply-target').forEach(group => group.classList.add('hidden'));
    ['applicationUrl', 'applicationEmail', 'applicationWhatsapp'].forEach((id) => {
      document.getElementById(id)?.removeAttribute('required');
    });
    if (method === 'external_website') {
      document.getElementById('applicationUrlGroup')?.classList.remove('hidden');
      document.getElementById('applicationUrl')?.setAttribute('required', 'required');
    } else if (method === 'email') {
      document.getElementById('applicationEmailGroup')?.classList.remove('hidden');
      document.getElementById('applicationEmail')?.setAttribute('required', 'required');
    } else if (method === 'whatsapp') {
      document.getElementById('applicationWhatsappGroup')?.classList.remove('hidden');
      document.getElementById('applicationWhatsapp')?.setAttribute('required', 'required');
    }
  };
  methodSelect.addEventListener('change', update);
  update();
}

// Post job
async function handlePostJob(event) {
  event.preventDefault();

  const formData = {
    title: document.getElementById('jobTitle').value,
    location: document.getElementById('jobLocation').value,
    job_type: document.getElementById('jobType').value,
    salary_min: document.getElementById('salaryMin').value || null,
    salary_max: document.getElementById('salaryMax').value || null,
    description: document.getElementById('jobDescription').value,
    requirements: [],
    application_method: document.getElementById('applicationMethod').value,
    application_url: document.getElementById('applicationUrl').value || null,
    application_email: document.getElementById('applicationEmail').value || null,
    application_whatsapp: document.getElementById('applicationWhatsapp').value || null,
  };

  try {
    const response = await fetch(`${API_BASE_URL}/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(formData),
    });

    if (response.ok) {
      alert("Job posted successfully! It's pending admin approval.");
      document.getElementById('postJobForm').reset();
      setupApplicationMethodFields();
      loadDashboardStats();
      loadJobs();
      closePostJobModal();
    } else {
      const error = await response.json();
      alert('Failed to post job: ' + error.error);
    }
  } catch (error) {
    alert('Error posting job: ' + error.message);
  }
}

// Delete job
async function deleteJob(jobId) {
  if (!confirm('Are you sure you want to delete this job?')) return;

  try {
    const response = await fetch(`${API_BASE_URL}/jobs/${jobId}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      alert('Job deleted successfully');
      loadDashboardStats();
      loadJobs();
    } else {
      const error = await response.json();
      alert('Failed to delete job: ' + error.error);
    }
  } catch (error) {
    alert('Error deleting job: ' + error.message);
  }
}

// Toggle feature job
async function toggleFeature(jobId) {
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/feature-job/${jobId}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });

    if (response.ok) {
      const data = await response.json();
      alert(data.message);
      loadJobs();
    } else {
      const error = await response.json();
      alert('Failed: ' + error.error);
    }
  } catch (error) {
    alert('Error: ' + error.message);
  }
}

// Save settings
async function saveSettings() {
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/settings`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        name: document.getElementById('recruiterNameInput').value,
        company_name: document.getElementById('companyNameInput').value,
        company_url: document.getElementById('companyWebsite').value,
        company_logo: document.getElementById('companyLogoUrl').value,
      }),
    });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error || 'Failed to save settings');
    currentUser = { ...currentUser, ...data.user };
    const company = currentUser.company_name || 'Your Company';
    setText('userName', currentUser.name || 'Recruiter');
    setText('userAvatar', (currentUser.name || 'R').charAt(0).toUpperCase());
    setText('companyName', company);
    setText('sidebarCompanyName', company);
    setText('sidebarRecruiterName', currentUser.name || 'Recruiter');
    setText('sidebarRecruiterCompany', company);
    alert('Settings saved.');
  } catch (error) {
    alert(error.message);
  }
}

async function upgradeWithMpesa(itemCode) {
  const phone = (document.getElementById('billingPhone')?.value || document.getElementById('upgradePhone')?.value || '').trim();
  if (!phone) return alert('Enter the M-Pesa phone number that should receive the STK Push.');

  try {
    const response = await fetch(`${API_BASE_URL}/payments/stk-push`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ itemCode, phone }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      alert(data.error || 'Could not start M-Pesa payment.');
      return;
    }
    alert(data.message || 'STK Push sent. Enter your M-Pesa PIN to complete payment.');
    closeUpgradeModal();
    setTimeout(() => {
      checkSubscriptionStatus();
      loadDashboardStats();
    }, 2500);
  } catch (error) {
    alert('Connection error. Please try again.');
  }
}

async function loadApplicants() {
  const list = document.getElementById('applicantsList');
  if (!list) return;
  list.innerHTML = '<li style="padding: 20px; text-align: center; color: #7080a0;">Loading applicants...</li>';
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/applications`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const applicants = await response.json().catch(() => []);
    if (!response.ok) throw new Error(applicants.error || 'Unable to load applicants');
    if (!applicants.length) {
      list.innerHTML = '<li style="padding: 20px; text-align: center; color: #7080a0;">No applicants yet</li>';
      return;
    }
    list.innerHTML = applicants.map((app) => `
      <li class="applicant-item" onclick="openApplicant(${app.id})" style="cursor:pointer;">
        <div>
          <div class="applicant-name">${escapeHTML(app.applicant_name)}</div>
          <small>${escapeHTML(app.job_title)} - ${escapeHTML(app.status || 'Submitted')}</small>
        </div>
        <span class="applicant-score">${Number(app.ai_match_score || app.cv_score || 0)}%</span>
      </li>
    `).join('');
  } catch (error) {
    list.innerHTML = `<li style="padding: 20px; text-align: center; color: #ef4444;">${escapeHTML(error.message)}</li>`;
  }
}

function renderListValue(value) {
  if (Array.isArray(value)) return value.length ? `<ul>${value.map((item) => `<li>${escapeHTML(typeof item === 'string' ? item : JSON.stringify(item))}</li>`).join('')}</ul>` : '<p class="placeholder-text">None listed.</p>';
  return value ? `<p>${escapeHTML(value)}</p>` : '<p class="placeholder-text">None listed.</p>';
}

function renderEntries(entries, formatter) {
  if (!entries || !entries.length) return '<p class="placeholder-text">None listed.</p>';
  return entries.map(formatter).join('');
}

function safeJsonList(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch (_) {
    return [];
  }
}

async function loadAiMatchedCandidates(jobId) {
  const list = document.getElementById('applicantsList');
  if (!list) return;
  list.innerHTML = '<li style="padding: 20px; text-align: center; color: #7080a0;">Calculating AI-matched candidates locally...</li>';
  try {
    const response = await fetch(`${API_BASE_URL}/ai/recruiter/opportunities/${jobId}/matching-candidates`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const candidates = await response.json().catch(() => []);
    if (!response.ok) throw new Error(candidates.error || 'Unable to load AI candidates');
    if (!candidates.length) {
      list.innerHTML = '<li style="padding: 20px; text-align: center; color: #7080a0;">No AI-matched candidates found yet.</li>';
      return;
    }
    list.innerHTML = candidates.map((candidate) => `
      <li class="applicant-item">
        <div>
          <div class="applicant-name">${escapeHTML(candidate.name || 'Candidate')}</div>
          <small>${escapeHTML(candidate.headline || candidate.location || 'HireKe profile')}</small>
          <small>${escapeHTML((candidate.matchReasons || []).slice(0, 1).join(''))}</small>
          <div style="margin-top:8px;display:flex;gap:8px;flex-wrap:wrap;">
            <a class="feature-btn" href="${escapeHTML(candidate.profileUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">Profile</a>
            ${candidate.cvUrl ? `<a class="feature-btn" href="${escapeHTML(candidate.cvUrl)}" target="_blank" rel="noopener" style="text-decoration:none;">CV</a>` : ''}
          </div>
        </div>
        <span class="applicant-score">${Number(candidate.matchScore || 0)}%</span>
      </li>
    `).join('');
    showRecruiterToast('AI-matched candidates loaded.');
  } catch (error) {
    list.innerHTML = `<li style="padding: 20px; text-align: center; color: #ef4444;">${escapeHTML(error.message)}</li>`;
  }
}

async function openApplicant(applicationId) {
  const card = document.getElementById('applicantDetailCard');
  const detail = document.getElementById('applicantDetail');
  if (!card || !detail) return;
  card.style.display = 'block';
  detail.innerHTML = '<p class="placeholder-text">Loading applicant profile...</p>';
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/applications/${applicationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to open applicant');
    const app = data.application;
    const person = data.applicant;
    const docs = data.submittedDocuments || {};
    detail.innerHTML = `
      <div class="section-header">
        <div>
          <h3>${escapeHTML(person.name || app.applicant_name)}</h3>
          <p style="color:#7080a0;">${escapeHTML(person.headline || app.job_title || '')}</p>
          <p style="color:#7080a0;">Application status: <strong>${escapeHTML(app.status || 'Submitted')}</strong></p>
          ${app.ai_match_score ? `<p style="color:#0b56d0;font-weight:800;">AI match: ${Number(app.ai_match_score)}%</p>` : ''}
        </div>
        <button class="post-job-btn" onclick="sendApplicantMessage(${app.id}, ${person.id || 0})">Message</button>
      </div>
      <div class="dashboard-grid">
        <div>
          <h4>Public Profile</h4>
          <p>${escapeHTML(person.about || 'No profile summary yet.')}</p>
          <h4>Skills</h4>${renderListValue(person.skills)}
          <h4>Certifications</h4>${renderListValue(person.certifications)}
          <h4>Projects</h4><p class="placeholder-text">No projects submitted.</p>
        </div>
        <div>
          <h4>Submitted Documents</h4>
          ${docs.cv_url ? `<p><a href="${escapeHTML(docs.cv_url)}" target="_blank" rel="noopener">Open submitted CV</a></p>` : '<p class="placeholder-text">No CV submitted.</p>'}
          ${(docs.documents || []).map((doc) => `<p><a href="${escapeHTML(doc.url || doc.file_url || doc)}" target="_blank" rel="noopener">${escapeHTML(doc.name || doc.original_name || 'Submitted document')}</a></p>`).join('')}
          <h4>Application Answers</h4>${renderListValue(app.answers)}
          ${app.ai_match_reasons ? `<h4>Why this matches</h4>${renderListValue(safeJsonList(app.ai_match_reasons))}` : ''}
        </div>
      </div>
      <h4>Education</h4>
      ${renderEntries(person.educationEntries, (entry) => `<p><strong>${escapeHTML(entry.institution_name)}</strong> - ${escapeHTML(entry.course || entry.education_level || '')}<br><small>${entry.year_from || ''} - ${entry.year_to || 'Present'}</small></p>`)}
      <h4>Experience</h4>
      ${renderEntries(person.experienceEntries, (entry) => `<p><strong>${escapeHTML(entry.job_title)}</strong> at ${escapeHTML(entry.organization_name)}<br><small>${entry.year_from || ''} - ${entry.currently_working ? 'Present' : (entry.year_to || '')}</small></p>`)}
      <div class="card" style="margin-top:16px;">
        <h4>Private Recruiter Notes</h4>
        <div id="notesList">${(data.notes || []).length ? data.notes.map((note) => `<p><strong>${escapeHTML(note.author_name || 'Recruiter')}</strong>: ${escapeHTML(note.note)}<br><small>${new Date(note.created_at).toLocaleString()}</small></p>`).join('') : '<p class="placeholder-text">No private notes yet.</p>'}</div>
        <div class="form-group">
          <label>Add note</label>
          <textarea id="newRecruiterNote" placeholder="Strong candidate, call for interview..."></textarea>
        </div>
        <button class="submit-btn" onclick="saveRecruiterNote(${app.id})">Save Private Note</button>
      </div>
    `;
    card.scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    detail.innerHTML = `<p style="color:#ef4444;">${escapeHTML(error.message)}</p>`;
  }
}

async function saveRecruiterNote(applicationId) {
  const noteEl = document.getElementById('newRecruiterNote');
  const note = noteEl?.value.trim();
  if (!note) return alert('Enter a note first.');
  try {
    const response = await fetch(`${API_BASE_URL}/recruiter/applications/${applicationId}/notes`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ note }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to save note');
    noteEl.value = '';
    openApplicant(applicationId);
  } catch (error) {
    alert(error.message);
  }
}

async function sendApplicantMessage(applicationId, receiverId) {
  if (!receiverId) return alert('This applicant does not have a linked HireKe account for messaging.');
  const body = prompt('Message to applicant:');
  if (!body) return;
  try {
    const response = await fetch(`${API_BASE_URL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receiver_id: receiverId, application_id: applicationId, subject: 'Message from recruiter', body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send message');
    alert('Message sent.');
    loadMessages();
  } catch (error) {
    alert(error.message);
  }
}

async function loadMessages() {
  const container = document.getElementById('messagesList');
  if (!container) return;
  container.innerHTML = '<p style="padding:20px; color:#7080a0;">Loading messages...</p>';
  try {
    const response = await fetch(`${API_BASE_URL}/messages`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const conversations = await response.json().catch(() => []);
    if (!response.ok) throw new Error(conversations.error || 'Unable to load messages');
    if (!conversations.length) {
      container.innerHTML = '<p style="padding: 20px; text-align: center; color: #7080a0;">No messages yet.</p>';
      return;
    }
    container.innerHTML = conversations.map((item) => `
      <div class="recent-row" onclick="openConversation(${item.id})" style="cursor:pointer;">
        <div>
          <strong>${escapeHTML(item.other_name || item.other_email || 'Conversation')}</strong>
          <small>${escapeHTML(item.subject || item.body || 'No messages yet')}</small>
        </div>
        <span class="applicant-score">${Number(item.unread_count || 0)}</span>
      </div>
    `).join('');
  } catch (error) {
    container.innerHTML = `<p style="padding:20px; color:#ef4444;">${escapeHTML(error.message)}</p>`;
  }
}

async function openConversation(conversationId) {
  const card = document.getElementById('conversationCard');
  const view = document.getElementById('conversationView');
  if (!card || !view) return;
  card.style.display = 'block';
  view.innerHTML = '<p class="placeholder-text">Loading conversation...</p>';
  try {
    const response = await fetch(`${API_BASE_URL}/messages/conversations/${conversationId}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to open conversation');
    const messages = data.messages || [];
    const last = messages[messages.length - 1];
    const receiverId = last?.sender_id === currentUser?.id ? last.receiver_id : last?.sender_id;
    view.innerHTML = `
      <h3>Conversation</h3>
      <div>${messages.map((msg) => `<p><strong>${escapeHTML(msg.sender_name)}</strong><br>${escapeHTML(msg.body)}<br><small>${new Date(msg.created_at).toLocaleString()}</small></p>`).join('') || '<p class="placeholder-text">No messages yet.</p>'}</div>
      <div class="form-group"><label>Reply</label><textarea id="conversationReply"></textarea></div>
      <button class="submit-btn" onclick="replyConversation(${conversationId}, ${receiverId || 0}, ${data.conversation.application_id || 'null'}, ${data.conversation.opportunity_id || 'null'})">Send Reply</button>
    `;
  } catch (error) {
    view.innerHTML = `<p style="color:#ef4444;">${escapeHTML(error.message)}</p>`;
  }
}

async function replyConversation(conversationId, receiverId, applicationId, opportunityId) {
  const body = document.getElementById('conversationReply')?.value.trim();
  if (!receiverId || !body) return alert('Write a reply first.');
  try {
    const response = await fetch(`${API_BASE_URL}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ receiver_id: receiverId, application_id: applicationId, opportunity_id: opportunityId, subject: 'Reply', body }),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Unable to send reply');
    openConversation(conversationId);
    loadMessages();
  } catch (error) {
    alert(error.message);
  }
}

// Modal handlers
function showPostJobModal() {
  switchPage('overview');
  document.getElementById('postJobForm')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  document.getElementById('jobTitle')?.focus({ preventScroll: true });
}

function closePostJobModal() {
  document.getElementById('postJobModal').classList.remove('active');
}

function showUpgradeModal() {
  document.getElementById('upgradeModal').classList.add('active');
}

function closeUpgradeModal() {
  document.getElementById('upgradeModal').classList.remove('active');
}

// Logout
document.getElementById('logoutBtn').addEventListener('click', (e) => {
  e.preventDefault();
  localStorage.removeItem('token');
  window.location.href = 'index.html';
});

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.classList.remove('active');
    }
  });
});
