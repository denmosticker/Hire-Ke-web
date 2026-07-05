console.log('showToast function exists?', typeof showToast);
document.addEventListener('DOMContentLoaded', () => {
  const jobsContainer = document.getElementById('jobsContainer');
  const themeToggle = document.getElementById('themeToggle');

  // Send Email (dashboard form)
  const sendEmailBtn = document.getElementById('send-email-btn');
  const emailToInput = document.getElementById('email-to');
  const emailSubjectInput = document.getElementById('email-subject');
  const emailMessageInput = document.getElementById('email-message');
  const emailStatusEl = document.getElementById('email-status');

  const loginBtn = document.getElementById('loginBtn');
  const navDashboard = document.getElementById('nav-dashboard');
  const navJobs = document.getElementById('nav-jobs');
  const navCompaniesLink = document.getElementById('nav-companies-link');
  const searchBtn = document.getElementById('searchBtn');
  const navTips = document.getElementById('nav-tips');
  const navPrivacy = document.getElementById('nav-privacy');
  const signupBtn = document.getElementById('signupBtn');
  const uploadCVBtn = document.getElementById('uploadCVBtn');
  const profileBtn = document.getElementById('profileBtn');
  const logoImg = document.getElementById('logo-img');
  const profileModal = document.getElementById('profile-modal');
  const profileClose = document.getElementById('profile-close');
  const profileForm = document.getElementById('profile-form');
  const skillsTabBtn = document.getElementById('skillsTabBtn');
  const addEduBtn = document.getElementById('add-edu-btn');
  const eduLevelSelect = document.getElementById('edu-level-select');
  const eduEntriesContainer = document.getElementById('education-entries-container');
  const educationTabBtn = document.getElementById('educationTabBtn');
  const dashboardTab = document.getElementById('dashboardTab');
  const skillsTab = document.getElementById('skillsTab');
  const educationTab = document.getElementById('educationTab');
  const companiesModal = document.getElementById('companies-modal');
  const companiesClose = document.getElementById('companies-close');
  const privacyModal = document.getElementById('privacy-modal');
  const privacyClose = document.getElementById('privacy-close');
  const authModal = document.getElementById('auth-modal');
  const roleModal = document.getElementById('role-modal');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const authForm = document.getElementById('auth-form');
  const authPrivacyContainer = document.getElementById('auth-privacy-container');
  const authPrivacyAgree = document.getElementById('auth-privacy-agree');
  const authPrivacyLink = document.getElementById('auth-privacy-link');
  const authCountyContainer = document.getElementById('auth-county-container');
  const authCountyInput = document.getElementById('auth-county');
  const authIndustryContainer = document.getElementById('auth-industry-container');
  const authIndustryInput = document.getElementById('auth-industry');
  const authMarketingContainer = document.getElementById('auth-marketing-container');
  const authMarketingOptin = document.getElementById('auth-marketing-optin');
  const authTitle = document.getElementById('auth-title');
  const authSubtitle = document.getElementById('auth-subtitle');
  const authRoleHint = document.getElementById('auth-role-hint');
  const authSwitch = document.getElementById('auth-switch');
  const authBack = document.getElementById('auth-back');
  const authCancel = document.getElementById('auth-cancel');
  const roleCards = document.querySelectorAll('.role-card');
  const roleClose = document.getElementById('role-close');
  const jobModal = document.getElementById('job-modal');
  const jobModalClose = document.getElementById('job-modal-close');
  const jobModalTitle = document.getElementById('job-modal-title');
  const jobModalCompany = document.getElementById('job-modal-company');
  const jobModalLocation = document.getElementById('job-modal-location');
  const jobModalSalary = document.getElementById('job-modal-salary');
  const jobModalDescription = document.getElementById('job-modal-description');
  const jobModalRequirements = document.getElementById('job-modal-requirements');
  const jobModalApply = document.getElementById('job-modal-apply');
  const jobModalEmail = document.getElementById('job-modal-email');
  const jobModalWebsite = document.getElementById('job-modal-website');

  const appConfig = {
    logoUrl: 'hireke-logo.png',
  };

  // Load logo if URL is provided
  if (appConfig.logoUrl) {
    logoImg.src = appConfig.logoUrl;
    logoImg.style.display = 'block';
  }

  let selectedRole = null;
  const state = {
    isLoggedIn: false,
    role: null,
    userProfile: {
      name: '',
      cvContent: '',
      cvRating: 0,
    },
    appliedJobs: new Set(),
    savedJobs: new Set(),
    userApplications: [],
    allJobs: [], // To store jobs for cross-referencing in dashboard
  };

  const API_BASE_URL = 'http://localhost:3000/api';

  const jobs = [
    {
      id: 1,
      company: 'Safaricom',
      title: 'ICT Support Officer',
      location: 'Nairobi, Kenya',
      salary: 'KES 80,000 - 120,000',
      description: 'Support internal IT systems, maintain user endpoints, and troubleshoot network and application issues across Safaricom offices.',
      requirements: ['Diploma or degree in Computer Science, IT, or related field.', '2+ years of experience in desktop support or IT helpdesk.', 'Strong Windows, networking, and troubleshooting skills.'],
      email: 'careers@safaricom.co.ke',
      careerUrl: 'https://www.safaricom.co.ke/careers',
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=ICT%20Support%20Officer%20Safaricom&location=Kenya',
    },
    {
      id: 2,
      company: 'KCB Bank',
      title: 'Relationship Manager',
      location: 'Nairobi, Kenya',
      salary: 'KES 100,000 - 150,000',
      description: 'Build and manage client relationships, focus on SME growth, and deliver exceptional service for KCB customers.',
      requirements: ['Bachelor\'s degree in Business, Finance, or related field.', '3+ years in banking or commercial relationship management.', 'Excellent communication and client engagement skills.'],
      email: 'careers@kcbgroup.com',
      careerUrl: 'https://www.kcbgroup.com/careers',
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Relationship%20Manager%20KCB&location=Kenya',
    },
    {
      id: 3,
      company: 'UNDP Kenya',
      title: 'Project Coordinator',
      location: 'Nairobi, Kenya',
      salary: 'KES 90,000 - 130,000',
      description: 'Coordinate development initiatives, manage stakeholder engagement, and support project delivery for sustainable programs.',
      requirements: ['Bachelor\'s degree in Development Studies, Project Management or similar.', 'Strong coordination skills and experience with donor-funded projects.', 'Excellent report writing and stakeholder management experience.'],
      email: 'kenya.hr@undp.org',
      careerUrl: null,
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Project%20Coordinator%20UNDP&location=Kenya',
    },
    {
      id: 4,
      company: 'Equity Bank',
      title: 'Senior Software Engineer',
      location: 'Nairobi, Kenya',
      salary: 'KES 120,000 - 180,000',
      description: 'Develop and maintain backend systems for banking solutions, ensure code quality and system reliability.',
      requirements: ['Bachelor\'s degree in Computer Science or related field.', '5+ years of software development experience.', 'Proficiency in Java, Python, or Go.'],
      email: 'careers@equitybank.co.ke',
      careerUrl: 'https://www.equitybank.co.ke/careers',
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Senior%20Software%20Engineer%20Equity&location=Kenya',
    },
    {
      id: 5,
      company: 'Airtel Kenya',
      title: 'Network Engineer',
      location: 'Nairobi, Kenya',
      salary: 'KES 95,000 - 140,000',
      description: 'Design and maintain telecommunications infrastructure, optimize network performance.',
      requirements: ['Diploma or degree in Telecommunications or IT.', '3+ years in network engineering.', 'CCNA or equivalent certification preferred.'],
      email: 'careers@ke.airtel.com',
      careerUrl: 'https://www.airtel.co.ke/careers',
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Network%20Engineer%20Airtel&location=Kenya',
    },
    {
      id: 6,
      company: 'Britam',
      title: 'Insurance Claims Officer',
      location: 'Nairobi, Kenya',
      salary: 'KES 70,000 - 100,000',
      description: 'Process insurance claims, interact with clients, and ensure customer satisfaction.',
      requirements: ['Diploma in Insurance or related field.', '2+ years in claims processing.', 'Strong customer service skills.'],
      email: 'careers@britam.com',
      careerUrl: null,
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Insurance%20Claims%20Officer%20Britam&location=Kenya',
    },
    {
      id: 7,
      company: 'Google Kenya',
      title: 'Data Analyst',
      location: 'Nairobi, Kenya',
      salary: 'KES 140,000 - 220,000',
      description: 'Analyze large datasets, create data visualizations, and provide insights to stakeholders.',
      requirements: ['Bachelor\'s degree in Statistics, Mathematics, or Computer Science.', '3+ years in data analysis.', 'Proficiency in SQL, Python, and visualization tools.'],
      email: 'careers@google.com',
      careerUrl: 'https://careers.google.com/locations/africa/',
      jobUrl: 'https://www.linkedin.com/jobs/search/?keywords=Data%20Analyst%20Google&location=Kenya',
    },
  ];

  // Expose globally so other handlers (and other script blocks) can safely call it.
  window.showToast = function showToast(message) {
    // If Toastify exists, use it.
    if (typeof Toastify !== 'undefined') {
      Toastify({
        text: message,
        duration: 2500,
        gravity: 'top',
        position: 'right',
        style: { background: '#2563eb' },
      }).showToast();
      return;
    }

    // Fallback (prevents “showToast is not a function”).
    alert(message);
  };


  function scanCVForATS(text) {
    const atsKeywords = {
      skills: ['java', 'python', 'javascript', 'sql', 'html', 'css', 'react', 'node', 'angular'],
      experience: ['experience', 'worked', 'managed', 'led', 'developed', 'designed', 'years', 'project'],
      education: ['bachelor', 'master', 'degree', 'diploma', 'certification', 'university', 'college'],
      ats: ['email', 'phone', 'linkedin', 'portfolio', 'github'],
    };

    const lowerText = text.toLowerCase();
    let score = 0;

    const hasEmail = /[a-zA-Z0-9._%-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/.test(text);
    if (hasEmail) score += 15;

    const hasPhone = /\d{10}|\d{3}[-.\s]\d{3}[-.\s]\d{4}|\+\d{1,3}\d{1,14}/.test(text);
    if (hasPhone) score += 10;

    let keywordCount = 0;
    Object.values(atsKeywords).forEach(keywords => {
      keywords.forEach(keyword => {
        if (lowerText.includes(keyword)) keywordCount++;
      });
    });
    score += Math.min(40, keywordCount * 2);

    const wordCount = text.split(/\s+/).length;
    if (wordCount >= 100 && wordCount <= 1000) score += 20;
    else if (wordCount > 1000) score += 15;

    return Math.min(100, score);
  }

  function loadJobs() {
    // Fetch from backend if server is running, otherwise use sample jobs
    fetch(`${API_BASE_URL}/jobs`)
      .then(response => response.json())
      .then(backendJobs => {
        // Use backend jobs if available
        let allJobs = [];
        if (backendJobs && Array.isArray(backendJobs)) {
          // Merge with sample jobs, remove duplicates
          allJobs = [...backendJobs];
          const sampleJobs = jobs.filter(sj => !allJobs.some(bj => bj.company === sj.company && bj.title === sj.title));
          allJobs = [...allJobs, ...sampleJobs];
        } else {
          allJobs = jobs;
        }
        state.allJobs = allJobs;
        renderJobs(allJobs);
        updateWeeklyJobCount(allJobs);
      })
      .catch(() => {
        // Fallback to sample jobs if server is not running
        state.allJobs = jobs;
        renderJobs(jobs);
        updateWeeklyJobCount(jobs);
      });
  }

  function updateWeeklyJobCount(jobsList) {
    const counter = document.getElementById('new-jobs-weekly');
    if (!counter) return;

    // "this week" should mean the last 7 days, but show a friendly label so it doesn't feel wrong.
    const now = new Date();
    const sevenDaysAgo = new Date(now);
    sevenDaysAgo.setDate(now.getDate() - 7);

    const recentJobs = jobsList.filter(job => {
      // If job has no date (sample data), treat it as recent only for demo purposes.
      if (!job.created_at) return true;
      return new Date(job.created_at) >= sevenDaysAgo;
    });

    // Update both the number and the label to avoid confusion like “it's not exactly 7 weekly”.
    counter.textContent = recentJobs.length;
    const labelEl = counter.nextElementSibling;
    if (labelEl && labelEl.textContent) {
      labelEl.textContent = 'Jobs posted (last 7 days)';
    }
  }


  function renderJobs(jobsList) {
    jobsContainer.innerHTML = '';
    jobsList.forEach((job) => {
      const isSaved = state.savedJobs.has(job.id);
      const isPremium = job.sub_active === 1 && (job.plan_type === 'Unlimited Monthly' || job.plan_type === 'premium');
      
      const card = document.createElement('div');
      card.classList.add('job-card');
      card.innerHTML = `
        <div>
          <h4 style="display: flex; align-items: center;">
            ${job.company} 
            ${isPremium ? '<span class="premium-badge"><i class="fas fa-crown"></i> Premium</span>' : ''}
          </h4>
          <h2>${job.title}</h2>
          <p>📍 ${job.location}</p>
          <p>💰 ${job.salary || 'Negotiable'}</p>
        </div>
        <div class="job-card-actions">
          <button class="unlock-btn">View Details</button>
          <button class="save-btn ${isSaved ? 'saved' : ''}" title="Save job">
            ${isSaved ? '❤️ Saved' : '🤍 Save'}
          </button>
        </div>
      `;
      jobsContainer.appendChild(card);

      const viewBtn = card.querySelector('.unlock-btn');
      const saveBtn = card.querySelector('.save-btn');

      viewBtn.addEventListener('click', () => {
        if (!state.isLoggedIn) {
          openAuthModal('login');
          return;
        }
        logClick('job_view', job.id.toString(), 'view_details', 'home');
        openJobModal(job);
      });

      saveBtn.addEventListener('click', () => {
        if (!state.isLoggedIn) {
          openAuthModal('login');
          return;
        }
        if (state.savedJobs.has(job.id)) {
          state.savedJobs.delete(job.id);
          saveBtn.classList.remove('saved');
          saveBtn.textContent = '🤍 Save';
        } else {
          state.savedJobs.add(job.id);
          saveBtn.classList.add('saved');
          saveBtn.textContent = '❤️ Saved';
        }
        updateWelcomeCard();
      });
    });
  }

  async function fetchUserApplications() {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/jobs/my-applications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (response.ok) {
        state.userApplications = await response.json();
        // Sync the appliedJobs set for correct UI state across the site
        state.appliedJobs = new Set(state.userApplications.map(app => app.job_id));
        updateWelcomeCard();
        renderJobs(state.allJobs); 
      }
    } catch (error) {
      console.error('Failed to fetch user applications:', error);
    }
  }

  async function fetchProfileViews() {
    const token = localStorage.getItem('token');
    if (!token) return 0;
    try {
      const resp = await fetch(`${API_BASE_URL}/auth/profile-views`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await resp.json();
      return data.count || 0;
    } catch (e) { return 0; }
  }

  async function renderUserDashboard() {
    const container = document.getElementById('dash-applications-list');
    const viewsEl = document.getElementById('dash-profile-views');
    const shortlistedEl = document.getElementById('dash-shortlisted');
    if (!container) return;

    container.innerHTML = '<p style="text-align:center; padding: 20px; font-size: 12px;">Loading stats...</p>';
    
    const views = await fetchProfileViews();
    await fetchUserApplications();
    
    if (viewsEl) viewsEl.textContent = views;
    const shortlistedCount = state.userApplications.filter(a => a.status === 'Shortlisted' || a.status === 'Interviewing').length;
    if (shortlistedEl) shortlistedEl.textContent = shortlistedCount;

    if (state.userApplications.length === 0) {
      container.innerHTML = '<p style="text-align:center; padding: 20px; color: #94a3b8; font-size: 13px;">No applications found.</p>';
      return;
    }

    const statusColors = {
      'Applied': '#64748b',
      'Reviewing': '#f59e0b',
      'Shortlisted': '#3b82f6',
      'Interviewing': '#8b5cf6',
      'Rejected': '#ef4444',
      'Hired': '#22c55e'
    };

    container.innerHTML = state.userApplications.map(app => `
      <div style="background: rgba(255,255,255,0.03); padding: 12px; border-radius: 6px; margin-bottom: 10px; border-left: 3px solid ${statusColors[app.status] || '#64748b'};">
        <div style="display: flex; justify-content: space-between; align-items: start;">
          <div>
            <strong style="font-size: 14px;">${app.title}</strong>
            <p style="font-size: 12px; color: #94a3b8;">${app.company}</p>
          </div>
          <span style="font-size: 10px; padding: 2px 8px; border-radius: 10px; background: ${statusColors[app.status] || '#64748b'}; color: white;">${app.status}</span>
        </div>
        ${app.recruiter_note ? `<p style="margin-top: 8px; font-size: 11px; color: #fbbf24; font-style: italic;">Note: "${app.recruiter_note}"</p>` : ''}
      </div>
    `).join('');
  }

  function logClick(type, name, action) {
    fetch(`${API_BASE_URL}/auth/log-click`, {
      method: 'POST',
      headers: { 
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`
      },
      body: JSON.stringify({
        element_type: type,
        element_name: name,
        action: action,
        page: window.location.pathname
      })
    }).catch(() => {});
  }

  async function recordApplication(jobId) {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      await fetch(`${API_BASE_URL}/jobs/${jobId}/apply`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`
        },
        body: JSON.stringify({ cv_score: state.userProfile.cvRating })
      });
      fetchUserApplications();
    } catch (err) {
      console.error('Failed to record application:', err);
    }
  }

  async function fetchNotifications(markRead = false) {
    const token = localStorage.getItem('token');
    if (!token) return;
    try {
      const resp = await fetch(`${API_BASE_URL}/jobs/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (resp.ok) {
        const notes = await resp.json();
        const unread = notes.filter(n => !n.is_read);

        // Update navbar badge
        const navBadge = document.getElementById('nav-notification-badge');
        if (navBadge) {
          if (unread.length > 0) {
            navBadge.textContent = unread.length;
            navBadge.style.display = 'block';
          } else {
            navBadge.style.display = 'none';
          }
        }

        if (markRead) {
          renderUserDashboard();
          fetch(`${API_BASE_URL}/jobs/notifications/mark-read`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${token}` }
          }).then(() => {
            if (navBadge) navBadge.style.display = 'none';
          });
        }
      }
    } catch (e) { console.error(e); }
  }

  async function openCompaniesModal() {
    const container = document.getElementById('companies-list-container');
    container.innerHTML = '<p style="text-align:center;">Loading companies...</p>';
    toggleModal(companiesModal, true);

    try {
      const resp = await fetch(`${API_BASE_URL}/jobs/companies`);
      const companies = await resp.json();

      if (companies.length === 0) {
        container.innerHTML = '<p style="text-align:center; color: #94a3b8;">No companies verified yet.</p>';
        return;
      }

      container.innerHTML = companies.map(company => {
        const companyJobs = state.allJobs.filter(j => j.company === company.company_name);
        const displayLogo = company.company_logo || 'hireke-logo.png';
        
        return `
          <div class="list-card" style="margin-bottom: 15px; background: rgba(255,255,255,0.05); padding: 15px; border-radius: 10px;">
            <div style="display: flex; justify-content: space-between; align-items: start;">
              <div style="display: flex; align-items: center; gap: 10px;">
                <img src="${displayLogo}" alt="${company.company_name} Logo" style="height: 50px; width: 50px; object-fit: cover; border-radius: 5px; background: #1e293b;">
                <div>
                <h3 style="color: #60a5fa; margin: 0;">${company.company_name}</h3>
                <p style="font-size: 12px; color: #94a3b8; margin: 5px 0;">${company.email}</p>
              </div>
              </div>
              <span style="background: #1e293b; padding: 4px 10px; border-radius: 20px; font-size: 11px;">${companyJobs.length} Jobs</span>
            </div>
            <div style="margin-top: 10px;">
              ${companyJobs.slice(0, 3).map(j => `<p style="font-size: 13px; margin: 2px 0;">• ${j.title}</p>`).join('')}
              <button class="view-company-jobs text-button" data-company="${company.company_name}" style="color: #60a5fa; margin-top: 10px; padding: 0; font-size: 13px; cursor: pointer; background: none; border: none;">
                View all jobs from this company →
              </button>
            </div>
          </div>
        `;
      }).join('');

      // Attach click listeners to the dynamically created buttons
      container.querySelectorAll('.view-company-jobs').forEach(btn => {
        btn.addEventListener('click', () => {
          const companyName = btn.dataset.company;
          const filtered = state.allJobs.filter(j => j.company === companyName);
          renderJobs(filtered);
          toggleModal(companiesModal, false);
          document.getElementById('jobs-section')?.scrollIntoView({ behavior: 'smooth' });
          showToast(`Showing all jobs from ${companyName}`);
        });
      });
    } catch (e) {
      container.innerHTML = '<p style="text-align:center; color: #ef4444;">Failed to load companies.</p>';
    }
  }

  if (searchBtn) {
    searchBtn.addEventListener('click', () => {
      const keyword = document.getElementById('searchKeyword')?.value.toLowerCase() || '';
      const location = document.getElementById('searchLocation')?.value.toLowerCase() || '';
      const category = document.getElementById('searchCategory')?.value || 'All Categories';

      const filtered = state.allJobs.filter(job => {
        const title = (job.title || '').toLowerCase();
        const company = (job.company || '').toLowerCase();
        const desc = (job.description || '').toLowerCase();
        const loc = (job.location || '').toLowerCase();
        
        const matchKeyword = !keyword || title.includes(keyword) || company.includes(keyword) || desc.includes(keyword);
        const matchLocation = !location || loc.includes(location);
        
        // Enhanced category matching
        const catLower = category.toLowerCase();
        const matchCategory = category === 'All Categories' || title.includes(catLower) || desc.includes(catLower);
        
        return matchKeyword && matchLocation && matchCategory;
      });

      renderJobs(filtered);
      if (filtered.length > 0) {
        document.getElementById('jobs-section').scrollIntoView({ behavior: 'smooth' });
      } else {
        showToast('No jobs found matching your criteria.');
      }
    });
  }

  function updateWelcomeCard() {
    const savedCount = state.savedJobs.size;
    const appliedCount = state.appliedJobs.size;
    const welcomeStats = document.querySelector('.welcome-stats');
    
    if (welcomeStats) {
      welcomeStats.innerHTML = `
        <div>❤️ ${savedCount} Saved</div>
        <div>📄 ${appliedCount} Applications</div>
        <div>⭐ ${state.userProfile.cvRating > 0 ? state.userProfile.cvRating + '%' : 'Upload CV'}</div>
      `;
    }

    const welcomeCard = document.querySelector('.welcome-card h3');
    if (welcomeCard && state.userProfile.name) {
      welcomeCard.textContent = `Welcome back, ${state.userProfile.name} 👋`;
    }
  }

  function toggleModal(modal, show) {
    if (show) {
      modal.classList.remove('hidden');
      modalBackdrop.classList.remove('hidden');
    } else {
      modal.classList.add('hidden');
      if (authModal.classList.contains('hidden') && roleModal.classList.contains('hidden') && profileModal.classList.contains('hidden') && jobModal.classList.contains('hidden') && forgotPasswordModal.classList.contains('hidden') && privacyModal.classList.contains('hidden') && companiesModal.classList.contains('hidden')) {
        modalBackdrop.classList.add('hidden');
      }
    }
  }

  function openJobModal(job) {
    jobModalTitle.textContent = job.title;
    jobModalCompany.textContent = job.company;
    jobModalLocation.textContent = `📍 ${job.location}`;
    jobModalSalary.textContent = `💰 ${job.salary}`;
    jobModalDescription.textContent = job.description;
    jobModalRequirements.innerHTML = job.requirements.map((item) => `<li>${item}</li>`).join('');
    
    if (state.appliedJobs.has(job.id)) {
      jobModalApply.innerHTML = '<span style="color: #22c55e; font-weight: 700;">✓ You have applied for this job</span>';
    } else {
      jobModalApply.innerHTML = '';
    }

    jobModalEmail.onclick = (e) => {
      e.preventDefault();
      recordApplication(job.id);
      const subject = encodeURIComponent(`Application for ${job.title} at ${job.company}`);
      const body = encodeURIComponent(`Hello,\n\nI am interested in the ${job.title} position at ${job.company}.\n\nPlease find my CV attached.\n\nBest regards,\n${state.userProfile.name}`);
      window.location.href = `https://mail.google.com/mail/?view=cm&fs=1&to=${job.email}&su=${subject}&body=${body}`;
      showToast('Opening Gmail...');
    };

    if (job.jobUrl) {
      jobModalWebsite.onclick = (e) => {
        e.preventDefault();
        recordApplication(job.id);
        window.open(job.jobUrl, '_blank');
        showToast('Opening job page...');
      };
      jobModalWebsite.style.display = 'inline-flex';
      jobModalWebsite.textContent = 'Apply on company website';
    } else if (job.careerUrl) {
      jobModalWebsite.onclick = (e) => {
        e.preventDefault();
        recordApplication(job.id);
        window.open(job.careerUrl, '_blank');
        showToast('Opening career page...');
      };
      jobModalWebsite.style.display = 'inline-flex';
      jobModalWebsite.textContent = 'Apply on company website';
    } else {
      jobModalWebsite.style.display = 'none';
    }

    toggleModal(jobModal, true);
  }

  function createEducationEntry(level) {
    const entryId = 'edu-' + Date.now();
    const div = document.createElement('div');
    div.className = 'edu-entry-card';
    div.id = entryId;
    div.style = 'background: rgba(255,255,255,0.05); padding: 15px; border-radius: 8px; margin-bottom: 10px; border-left: 3px solid #2563eb; position: relative;';
    
    let achievementHtml = '';
    if (level === 'Primary Education') {
      achievementHtml = `<input type="text" value="K.C.P.E" readonly style="background: rgba(0,0,0,0.2);" />`;
    } else if (level === 'Secondary Education') {
      achievementHtml = `
        <div style="display: flex; gap: 10px;">
          <input type="text" value="K.C.S.E" readonly style="background: rgba(0,0,0,0.2); flex: 1;" />
          <select style="flex: 1;">
            <option value="">-- Grade --</option>
            <option value="A">A</option>
            <option value="A-">A-</option>
            <option value="B+">B+</option>
            <option value="B">B</option>
            <option value="B-">B-</option>
            <option value="C+">C+</option>
            <option value="C">C</option>
            <option value="C-">C-</option>
            <option value="D+">D+</option>
            <option value="D">D</option>
            <option value="D-">D-</option>
            <option value="E">E</option>
          </select>
        </div>`;
    } else if (level === 'University') {
      achievementHtml = `<select><option value="Degree">Degree</option><option value="Diploma">Diploma</option></select>`;
    } else {
      // College, TVET, Polytechnic
      achievementHtml = `<select><option value="Diploma">Diploma</option><option value="Certificate">Certificate</option></select>`;
    }

    div.innerHTML = `
      <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 10px;">
        <strong style="color: #60a5fa;">${level}</strong>
        <button type="button" onclick="document.getElementById('${entryId}').remove()" style="background: none; border: none; color: #ef4444; cursor: pointer; font-size: 18px;">&times;</button>
      </div>
      <div class="input-group" style="margin-bottom: 8px;">
        <label style="font-size: 12px;">Institution Name</label>
        <input type="text" placeholder="e.g. Nairobi School" required />
      </div>
      <div class="input-group">
        <label style="font-size: 12px;">Achievement</label>
        ${achievementHtml}
      </div>
    `;
    eduEntriesContainer.appendChild(div);
  }

  if (addEduBtn) {
    addEduBtn.addEventListener('click', () => {
      const level = eduLevelSelect.value;
      if (!level) {
        showToast('Please select an education level first.');
        return;
      }
      createEducationEntry(level);
      eduLevelSelect.value = ''; // Reset selector
    });
  }

  function openRoleModal() {
    selectedRole = null;
    authForm.dataset.mode = 'signup';
    authBack.classList.add('hidden');
    authRoleHint.textContent = 'Already have an account?';
    authSwitch.textContent = 'Log in';
    authTitle.textContent = 'Create your account';
    authSubtitle.textContent = 'Choose recruiter or job seeker.';
    authForm.reset();

    const authCompanyContainer = document.getElementById('auth-company-container');
    if (authCompanyContainer) authCompanyContainer.classList.add('hidden');

    toggleModal(roleModal, true);
    toggleModal(authModal, false);
  }

  function openAuthModal(mode) {
    authForm.dataset.mode = mode;
    if (mode === 'login') {
      authTitle.textContent = 'Welcome back';
      authSubtitle.textContent = 'Log in to continue to HireKe.';
      authRoleHint.textContent = 'Not signed up yet?';
      authSwitch.textContent = 'Create account';
      authBack.classList.add('hidden');
      authPrivacyContainer.classList.add('hidden');
      authCountyContainer.classList.add('hidden');
      authIndustryContainer.classList.add('hidden');
      authMarketingContainer.classList.add('hidden');
    } else {
      authTitle.textContent = 'Create your account';
      authSubtitle.textContent = selectedRole
        ? `Signing up as a ${selectedRole === 'recruiter' ? 'recruiter' : 'job seeker'}`
        : 'Choose recruiter or job seeker first.';
      authRoleHint.textContent = 'Already have an account?';
      authSwitch.textContent = 'Log in';
      authBack.classList.remove('hidden');
      authPrivacyContainer.classList.remove('hidden');
      authMarketingContainer.classList.remove('hidden');
      // Show county and industry fields for signup
      authCountyContainer.classList.remove('hidden');
      authIndustryContainer.classList.remove('hidden');

      // Show company name only for recruiters
      const authCompanyContainer = document.getElementById('auth-company-container');
      if (authCompanyContainer) {
        authCompanyContainer.classList.toggle('hidden', selectedRole !== 'recruiter');
      }

    }
    // Clear marketing opt-in and related fields on form reset
    authForm.reset();
    toggleModal(authModal, true);
    toggleModal(roleModal, false);
  }

  async function handleAuthSubmit(event) {
    event.preventDefault();
    const mode = authForm.dataset.mode;
    const email = document.getElementById('auth-email').value.trim();
    const password = document.getElementById('auth-password').value.trim();

    if (!email || !password) {
      showToast('Please enter your email and password.');
      return;
    }

    if (mode === 'signup' && !selectedRole) {
      showToast('Please choose whether you are a recruiter or job seeker.');
      return;
    }

    // SIGNUP with backend
    if (mode === 'signup') {
      if (!authPrivacyAgree.checked) {
        showToast('You must agree to the Data Protection & Privacy Policy to continue.');
        return;
      }

    // Conditional validation for Brevo marketing fields
    if (authMarketingOptin.checked) {
      if (!authCountyInput.value.trim()) {
        showToast('Please enter your County to receive personalized career tips.');
        return;
      }
      if (!authIndustryInput.value.trim()) {
        showToast('Please enter your Industry to receive relevant job updates.');
        return;
      }
    }

      // Password complexity check
      const passwordRegex = /^(?=.*[A-Z])(?=.*[0-9])(?=.*[!@#$%^&*(),.?":{}|<>]).{6,}$/;
      if (!passwordRegex.test(password)) {
        showToast('Password must be at least 6 characters, with 1 uppercase, 1 number, and 1 symbol.');
        return;
      }

      try {
        const response = await fetch(`${API_BASE_URL}/auth/signup`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email,
            password,
            name: email.split('@')[0],
            role: selectedRole,
            company_name: selectedRole === 'recruiter'
              ? (document.getElementById('auth-company')?.value.trim() || 'My Company')
              : null,
            marketing_optin: authMarketingOptin.checked,
            county: authCountyInput.value.trim(),
            industry: authIndustryInput.value.trim(),
          }),
        });

        const data = await response.json();

        if (!response.ok) {
          showToast(data.error || 'Signup failed');
          return;
        }

        if (data.requiresVerification && data.verificationSent) {
          showToast('Verification code sent to your email. Please check your inbox.');

          // Configure OTP flow to be signup verification (NOT password reset)
          forgotPasswordState.mode = 'signup-verification';
          forgotPasswordState.email = email;
          forgotPasswordState.resetToken = '';

          // Reuse the existing OTP step UI (step 2 in forgot-password modal)
          // but verify with /verify-email
          forgotPasswordState.mode = 'signup-verification';
          forgotPasswordState.email = email;
          forgotPasswordState.resetToken = '';

          showForgotPasswordStep(2);
          toggleModal(authModal, false);
          toggleModal(roleModal, false);
          toggleModal(forgotPasswordModal, true);
          forgotPasswordState.source = 'signup'; // Mark source as signup
        } else {
          const msg = data.verificationError || data.error || 'Account created, but we could not send the OTP. Please try resending from the verification screen.';
          forgotPasswordState.mode = 'signup-verification';
          forgotPasswordState.email = email;
          forgotPasswordState.resetToken = '';
          forgotPasswordState.source = 'signup';
          showForgotPasswordStep(2);
          toggleModal(authModal, false);
          toggleModal(roleModal, false);
          toggleModal(forgotPasswordModal, true);
          showToast(msg);
        }
      } catch (err) {
        showToast('Signup error: ' + err.message);
      }
      return;
    }

    // LOGIN with backend
    try {
      const response = await fetch(`${API_BASE_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });

      const data = await response.json();

      // Handle existing unverified users
      if (response.status === 403 && data.unverified) {
        showToast('Email not verified. Sending new OTP...');
        
        // Request a new verification OTP
        const otpSendResponse = await fetch(`${API_BASE_URL}/auth/send-verification-otp`, { // Await this fetch
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: data.email }),
        });
        const otpSendData = await otpSendResponse.json(); // Parse response

        if (!otpSendResponse.ok || !otpSendData.success) { // Check for success
          showToast(otpSendData.error || 'Failed to send verification OTP.');
          return; // Stop here if OTP sending failed
        }

        forgotPasswordState.mode = 'signup-verification';
        forgotPasswordState.email = data.email;
        forgotPasswordState.resetToken = '';

        showForgotPasswordStep(2);
        toggleModal(authModal, false);
        toggleModal(forgotPasswordModal, true);
        forgotPasswordState.source = 'login'; // Mark source as login
        return;
      }

      if (!response.ok) {
        showToast(data.error || 'Login failed');
        return;
      }

      state.isLoggedIn = true;
      state.role = data.user.role;
      state.userProfile.name = data.user.name;

      localStorage.setItem('token', data.token);
      localStorage.setItem('userRole', data.user.role);

      loginBtn.textContent = 'Logout';
      signupBtn.style.display = 'none';
      profileBtn.classList.remove('hidden');
      fetchUserApplications();
      fetchNotifications();
      updateWelcomeCard();
      toggleModal(authModal, false);

      showToast(`Welcome ${state.role === 'recruiter' ? 'Recruiter' : 'Job Seeker'}!`);

      if (state.role === 'recruiter') {
        setTimeout(() => {
          window.location.href = 'recruiter-dashboard.html';
        }, 1500);
      }
    } catch (error) {
      showToast('Login error: ' + error.message);
    }
  }

  function handleLogout() {
    state.isLoggedIn = false;
    state.role = null;
    state.userProfile.name = '';
    state.userProfile.cvRating = 0;
    loginBtn.textContent = 'Log In';
    signupBtn.style.display = 'inline-flex';
    profileBtn.classList.add('hidden');
    localStorage.removeItem('token');
    localStorage.removeItem('userRole');
    const postJobBtn = document.getElementById('postJobNavBtn');
    if (postJobBtn) {
      postJobBtn.style.display = 'none';
    }
    const welcomeCard = document.querySelector('.welcome-card h3');
    if (welcomeCard) {
      welcomeCard.textContent = 'Welcome back, Guest 👋';
    }
    updateWelcomeCard();
    showToast('You have been logged out.');
  }

  loginBtn.addEventListener('click', () => {
    if (state.isLoggedIn) {
      handleLogout();
    } else {
      openAuthModal('login');
    }
  });

  if (navDashboard) {
    navDashboard.addEventListener('click', (e) => {
      e.preventDefault();
      if (!state.isLoggedIn) return openAuthModal('login');
      toggleModal(profileModal, true);
      switchTab('dashboard');
    });
  }

  if (navJobs) {
    navJobs.addEventListener('click', (e) => {
      e.preventDefault();
      const jobsSection = document.getElementById('jobs-section');
      if (jobsSection) {
        jobsSection.scrollIntoView({ behavior: 'smooth' });
      }
    });
  }

  if (navCompaniesLink) {
    navCompaniesLink.addEventListener('click', (e) => {
      e.preventDefault();
      openCompaniesModal();
    });
  }

  if (navTips) {
    navTips.addEventListener('click', (e) => {
      e.preventDefault();
      showToast('Career Tips coming soon!');
    });
  }

  signupBtn.addEventListener('click', openRoleModal);
  authSwitch.addEventListener('click', () => {
    if (authForm.dataset.mode === 'login') {
      openRoleModal();
    } else {
      openAuthModal('login');
    }
  });
  authBack.addEventListener('click', openRoleModal);
  authCancel.addEventListener('click', () => toggleModal(authModal, false));
  roleClose.addEventListener('click', () => toggleModal(roleModal, false));
  profileBtn.addEventListener('click', () => toggleModal(profileModal, true));
  profileClose.addEventListener('click', () => toggleModal(profileModal, false));
  companiesClose.addEventListener('click', () => toggleModal(companiesModal, false));
  privacyClose.addEventListener('click', () => toggleModal(privacyModal, false));
  jobModalClose.addEventListener('click', () => toggleModal(jobModal, false));
  
  profileForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const profileName = document.getElementById('profile-name').value.trim();
    if (profileName) {
      state.userProfile.name = profileName;
      updateWelcomeCard();
    }
    showToast('Profile saved successfully.');
    toggleModal(profileModal, false);
  });

  // Show "Post a Job" button for recruiters
  window.redirectToRecruiterDashboard = () => {
    window.location.href = 'recruiter-dashboard.html';
  };

  // Check if recruiter is logged in and show "Post a Job" button
  if (localStorage.getItem('userRole') === 'recruiter') {
    const postJobBtn = document.getElementById('postJobNavBtn');
    if (postJobBtn) {
      postJobBtn.style.display = 'inline-flex';
    }
  }

  uploadCVBtn.addEventListener('click', () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.pdf,.doc,.docx,.txt';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = (event) => {
          state.userProfile.cvContent = event.target.result;
          state.userProfile.cvRating = scanCVForATS(state.userProfile.cvContent);
          
          const cvScore = document.getElementById('cv-score');
          const cvProgress = document.getElementById('cv-progress');
          if (cvScore) cvScore.textContent = `ATS Score: ${state.userProfile.cvRating}%`;
          if (cvProgress) cvProgress.style.width = state.userProfile.cvRating + '%';
          
          updateWelcomeCard();
          showToast(`CV scanned! ATS score: ${state.userProfile.cvRating}%`);
        };
        reader.readAsText(file);
      }
    };
    input.click();
  });

  // Forgot Password Modal Elements
  const forgotPasswordModal = document.getElementById('forgot-password-modal');
  const forgotPasswordBtn = document.getElementById('forgot-password-btn');
  const forgotBack = document.getElementById('forgot-back');
  const forgotClose = document.getElementById('forgot-close');
  const forgotEmailForm = document.getElementById('forgot-email-form');
  const forgotOtpForm = document.getElementById('forgot-otp-form');
  const forgotPasswordForm = document.getElementById('forgot-password-form');
  const resendOtpBtn = document.getElementById('resend-otp-btn');
  const forgotStepTitle = document.getElementById('forgot-step-title');
  const forgotStepSubtitle = document.getElementById('forgot-step-subtitle');

  // State for forgot password flow
  // Also reused for signup email verification flow
  let forgotPasswordState = {
    email: '',
    resetToken: '',
    mode: 'password-reset', // 'password-reset' | 'signup-verification'
  };

  function showForgotPasswordStep(step) {
    // Hide all steps
    document.querySelectorAll('.forgot-step').forEach(form => {
      form.classList.add('hidden');
    });

    // Show requested step
    if (step === 1) {
      forgotEmailForm.classList.remove('hidden');
      forgotStepTitle.textContent = 'Reset Password';
      forgotStepSubtitle.textContent = 'Enter your email to receive an OTP';
    } else if (step === 2) {
      forgotOtpForm.classList.remove('hidden');
      forgotStepTitle.textContent = 'Verify OTP';
      forgotStepSubtitle.textContent = 'Enter the 6-digit code sent to your email';
    } else if (step === 3) {
      forgotPasswordForm.classList.remove('hidden');
      forgotStepTitle.textContent = 'Create New Password';
      forgotStepSubtitle.textContent = 'Enter and confirm your new password';
    }
  }

  function openForgotPasswordModal() {
    forgotPasswordState = { email: '', resetToken: '' };
    showForgotPasswordStep(1);
    toggleModal(forgotPasswordModal, true);
    toggleModal(authModal, false);
  }

  // Handle forgot password button in login form
  forgotPasswordBtn.addEventListener('click', (e) => {
    e.preventDefault();
    openForgotPasswordModal();
  });

  // Back button in forgot password modal
  forgotBack.addEventListener('click', () => {
    if (forgotOtpForm.classList.contains('hidden') && forgotPasswordForm.classList.contains('hidden')) {
      // Already on step 1, go back to login
      toggleModal(forgotPasswordModal, false);
      openAuthModal('login');
    } else {
      // Go back to previous step
      const currentStep = document.querySelector('.forgot-step:not(.hidden)').dataset.step;
      showForgotPasswordStep(parseInt(currentStep) - 1);
    }
  });

  // Close button in forgot password modal
  forgotClose.addEventListener('click', () => {
    toggleModal(forgotPasswordModal, false);
  });

  // Handle Step 1: Email submission
  forgotEmailForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = document.getElementById('forgot-email').value.trim();
    const phone = document.getElementById('forgot-phone')?.value?.trim();

    if (!email) {
      showToast('Please enter your email address.');
      return;
    }

    try {
      console.log('📧 Sending OTP request to:', `${API_BASE_URL}/auth/forgot-password`);
      const response = await fetch(`${API_BASE_URL}/auth/forgot-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      });

      console.log('Response status:', response.status, response.statusText);
      const data = await response.json();
      console.log('Response data:', data);

      if (data.success || response.ok) {
        forgotPasswordState.email = email;
        showToast('OTP sent to your email');
        

        
        showForgotPasswordStep(2);
      } else {
        showToast(data.error || 'Failed to send OTP');
      }
    } catch (error) {
      console.error('❌ Fetch error:', error);
      console.log('Error type:', error.name);
      console.log('Error message:', error.message);
      showToast('Error sending OTP: ' + error.message + '\n\nMake sure the server is running at http://localhost:3000');
    }
  });

  // Handle Step 2: OTP verification (used for BOTH password reset + signup verification)
  forgotOtpForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const otp = document.getElementById('forgot-otp').value.trim();

    if (!otp || otp.length !== 6) {
      showToast('Please enter a valid 6-digit OTP.');
      return;
    }

    try {
      // Signup verification mode: prefer phone OTP if phone number entered, else fallback to email OTP
      if (forgotPasswordState.mode === 'signup-verification') { // This block handles email verification for signup

        const verifyEmailResp = await fetch(`${API_BASE_URL}/auth/verify-email`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            email: forgotPasswordState.email,
            otp,
          }),
        });

        const verifyEmailData = await verifyEmailResp.json();

        if (verifyEmailResp.ok && verifyEmailData.success) {
          showToast('Email verified successfully.');
          toggleModal(forgotPasswordModal, false);
          if (forgotPasswordState.source === 'login') {
            // If verification was triggered by an unverified login, re-attempt login
            // This will re-run handleAuthSubmit, which will now succeed as email is verified
            await handleAuthSubmit(new Event('submit')); // Simulate form submission
          } else {
            // If verification was triggered by signup, open profile modal
            toggleModal(roleModal, false); // Close role modal if it was open
            toggleModal(profileModal, true); // Open profile modal
          }
          return;
        }

        showToast(verifyEmailData.error || 'Invalid OTP');
        return;
      }

      // Password reset mode: verify with /verify-otp-reset
      const response = await fetch(`${API_BASE_URL}/auth/verify-otp-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotPasswordState.email,
          otp,
        }),
      });

      const data = await response.json();

      if (data.success && data.resetToken) {
        forgotPasswordState.resetToken = data.resetToken;
        showToast('OTP verified successfully');
        showForgotPasswordStep(3);
      } else {
        showToast(data.error || 'Invalid OTP');
      }
    } catch (error) {
      showToast('Error verifying OTP: ' + error.message);
    }
  });

  // Handle resend OTP
  resendOtpBtn.addEventListener('click', async (e) => {
    e.preventDefault();
    if (!forgotPasswordState.email) { // Ensure email is set before resending
      showToast('Please enter your email first.');
      return;
    }
    try {
      if (forgotPasswordState.mode === 'signup-verification') {
        const response = await fetch(`${API_BASE_URL}/auth/resend-verification-otp`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: forgotPasswordState.email }),
        });
        const data = await response.json();
        if (data.success) {
          showToast('New verification OTP sent');
          return;
        }
        showToast(data.error || 'Failed to resend OTP');
        return;
      }

      const response = await fetch(`${API_BASE_URL}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotPasswordState.email }),
      });

      const data = await response.json();

      if (data.success) {
        showToast('New OTP sent to your email');

      } else {
        showToast(data.error || 'Failed to resend OTP');
      }
    } catch (error) {
      showToast('Error resending OTP: ' + error.message);
    }
  });

  // Handle Step 3: Password reset
  forgotPasswordForm.addEventListener('submit', async (e) => {

    e.preventDefault();
    const newPassword = document.getElementById('forgot-new-password').value;
    const confirmPassword = document.getElementById('forgot-confirm-password').value;

    if (!newPassword || !confirmPassword) {
      showToast('Please enter both passwords.');
      return;
    }

    if (newPassword !== confirmPassword) {
      showToast('Passwords do not match.');
      return;
    }

    if (newPassword.length < 6) {
      showToast('Password must be at least 6 characters long.');
      return;
    }

    try {
      const response = await fetch(`${API_BASE_URL}/auth/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotPasswordState.email,
          resetToken: forgotPasswordState.resetToken,
          newPassword,
          confirmPassword,
        }),
      });

      const data = await response.json();

      if (data.success) {
        showToast('Password reset successfully. Please log in with your new password.');
        
        // Clear forms
        forgotEmailForm.reset();
        forgotOtpForm.reset();
        forgotPasswordForm.reset();
        
        // Close modal and open login
        toggleModal(forgotPasswordModal, false);
        openAuthModal('login');
      } else {
        showToast(data.error || 'Failed to reset password');
      }
    } catch (error) {
      showToast('Error resetting password: ' + error.message);
    }
  });

  if (authPrivacyLink) {
    authPrivacyLink.addEventListener('click', (e) => {
      e.preventDefault();
      toggleModal(privacyModal, true);
    });
  }

  skillsTabBtn.addEventListener('click', () => {
    skillsTabBtn.classList.add('active');
    educationTabBtn.classList.remove('active');
    skillsTab.classList.remove('hidden');
    educationTab.classList.add('hidden');
  });

  educationTabBtn.addEventListener('click', () => {
    educationTabBtn.classList.add('active');
    skillsTabBtn.classList.remove('active');
    educationTab.classList.remove('hidden');
    skillsTab.classList.add('hidden');
  });

  modalBackdrop.addEventListener('click', () => {
    toggleModal(authModal, false);
    toggleModal(roleModal, false);
    toggleModal(profileModal, false);
    toggleModal(jobModal, false);
    toggleModal(forgotPasswordModal, false);
    toggleModal(privacyModal, false);
    toggleModal(companiesModal, false);
  });

  roleCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedRole = card.dataset.role;
      openAuthModal('signup');
    });
  });

  authForm.addEventListener('submit', handleAuthSubmit);
  loadJobs();

  if (localStorage.getItem('token')) {
    fetchUserApplications();
    fetchNotifications();
  }

  themeToggle.addEventListener('click', () => {
    const body = document.body;
    body.classList.toggle('dark-mode');
    themeToggle.textContent = body.classList.contains('dark-mode') ? '☀️' : '🌙';
  });

  // Contact form handler (homepage)
  const contactNameInput = document.getElementById('contact-name');
  const contactEmailInput = document.getElementById('contact-email');
  const contactSubjectInput = document.getElementById('contact-subject');
  const contactMessageInput = document.getElementById('contact-message');
  const contactSubmitBtn = document.getElementById('contact-submit-btn');
  const contactStatusEl = document.getElementById('contact-status');

  // ========== CONTACT FORM - EMAILJS INTEGRATION ==========
  async function sendContactEmail() {
  // Local notification function (fallback)
  const notify = (msg, isError = false) => {
    const bgColor = isError ? '#ef4444' : '#22c55e';
    if (typeof Toastify !== 'undefined') {
      Toastify({ text: msg, duration: 3000, gravity: 'top', position: 'right', style: { background: bgColor } }).showToast();
    } else {
      alert(msg);
    }
  };

  const name = document.getElementById('contact-name')?.value.trim() || '';
  const email = document.getElementById('contact-email')?.value.trim() || '';
  const subject = document.getElementById('contact-subject')?.value.trim() || '';
  const message = document.getElementById('contact-message')?.value.trim() || '';

  if (!name || !email || !subject || !message) {
    notify('Please fill in all fields', true);
    return false;
  }

  notify('📧 Sending message...');

  try {
    await emailjs.send('service_1c2g5ev', 'template_oyn2ybp', {
      name: name,
      email: email,
      subject: subject,
      message: message
    });
    
    // Clear existing toasts
    document.querySelectorAll('.toastify').forEach(t => t.remove());
    
    setTimeout(() => {
      notify('✅ Message sent successfully!');
    }, 50);
    
    // Clear form
    document.getElementById('contact-name').value = '';
    document.getElementById('contact-email').value = '';
    document.getElementById('contact-subject').value = '';
    document.getElementById('contact-message').value = '';
    
    return true;
  } catch (error) {
    console.error(error);
    notify('❌ Failed to send. Please try again.', true);
    return false;
  }
}



  if (contactSubmitBtn) {
    contactSubmitBtn.addEventListener('click', async (e) => {
      e.preventDefault();
      if (contactSubmitBtn.disabled) return;
      
      contactSubmitBtn.disabled = true;
      await sendContactEmail();
      contactSubmitBtn.disabled = false;
    });
  }



  // Send Email form handler (dashboard)
  if (sendEmailBtn && emailToInput && emailSubjectInput && emailMessageInput) {
    sendEmailBtn.addEventListener('click', async () => { 
      const to = emailToInput.value.trim();
      const subject = emailSubjectInput.value.trim();
      const message = emailMessageInput.value.trim();


      if (!to) {
        showToast('Please enter recipient email (To).');
        return;
      }
      if (!subject) {
        showToast('Please enter email subject.');
        return;
      }
      if (!message) {
        showToast('Please enter a message.');
        return;
      }

      if (!localStorage.getItem('token')) {
        showToast('Please log in to send email.');
        return;
      }

      emailStatusEl.style.color = '#64748b';
      emailStatusEl.textContent = 'Sending...';
      sendEmailBtn.disabled = true;

      try {
        const resp = await fetch(`${API_BASE_URL}/email/send-email`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${localStorage.getItem('token')}`,
          },
          body: JSON.stringify({
            to,
            subject,
            message,
            templateVars: {
              message,
            },
          }),
        });

        const data = await resp.json().catch(() => ({}));

        if (!resp.ok) {
          const err = data.error || 'Failed to send email';
          emailStatusEl.style.color = '#ef4444';
          emailStatusEl.textContent = err;
          showToast(err);
          return;
        }

        emailStatusEl.style.color = '#22c55e';
        emailStatusEl.textContent = 'Email sent successfully.';
        showToast('Email sent successfully.');
        emailToInput.value = '';
        emailSubjectInput.value = '';
        emailMessageInput.value = '';
      } catch (e) {
        emailStatusEl.style.color = '#ef4444';
        emailStatusEl.textContent = 'Error sending email.';
        showToast('Error sending email: ' + e.message);
      } finally {
        sendEmailBtn.disabled = false;
      }
    });
  }
});


// NOTE: Email verification flow is handled inside the DOMContentLoaded block above.
// The previous duplicate block redeclared `verificationModal` and caused a SyntaxError.
