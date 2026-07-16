document.addEventListener('DOMContentLoaded', () => {
  const jobsContainer = document.getElementById('jobsContainer');
  const themeToggle = document.getElementById('themeToggle');
  const loginBtn = document.getElementById('loginBtn');
  const signupBtn = document.getElementById('signupBtn');
  const searchBtn = document.getElementById('searchBtn');
  const uploadCVBtn = document.getElementById('uploadCVBtn');
  const profileBtn = document.getElementById('profileBtn');
  const profileModal = document.getElementById('profile-modal');
  const profileClose = document.getElementById('profile-close');
  const profileForm = document.getElementById('profile-form');
  const skillsTabBtn = document.getElementById('skillsTabBtn');
  const educationTabBtn = document.getElementById('educationTabBtn');
  const skillsTab = document.getElementById('skillsTab');
  const educationTab = document.getElementById('educationTab');
  const authModal = document.getElementById('auth-modal');
  const roleModal = document.getElementById('role-modal');
  const modalBackdrop = document.getElementById('modal-backdrop');
  const authForm = document.getElementById('auth-form');
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

  let selectedRole = null;
  let currentJobId = null;
  
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
  };

  const jobs = [
    {
      id: 1,
      company: 'Safaricom',
      title: 'ICT Support Officer',
      location: 'Nairobi, Kenya',
      salary: 'KES 80,000 - 120,000',
      description: 'Support internal IT systems, maintain user endpoints, and troubleshoot network and application issues across Safaricom offices.',
      requirements: [
        'Diploma or degree in Computer Science, IT, or related field.',
        '2+ years of experience in desktop support or IT helpdesk.',
        'Strong Windows, networking, and troubleshooting skills.',
      ],
      email: 'careers@safaricom.co.ke',
      careerUrl: 'https://www.safaricom.co.ke/careers',
    },
    {
      id: 2,
      company: 'KCB Bank',
      title: 'Relationship Manager',
      location: 'Nairobi, Kenya',
      salary: 'KES 100,000 - 150,000',
      description: 'Build and manage client relationships, focus on SME growth, and deliver exceptional service for KCB customers.',
      requirements: [
        "Bachelor's degree in Business, Finance, or related field.",
        '3+ years in banking or commercial relationship management.',
        'Excellent communication and client engagement skills.',
      ],
      email: 'careers@kcbgroup.com',
      careerUrl: 'https://www.kcbgroup.com/careers',
    },
    {
      id: 3,
      company: 'UNDP Kenya',
      title: 'Project Coordinator',
      location: 'Nairobi, Kenya',
      salary: 'KES 90,000 - 130,000',
      description: 'Coordinate development initiatives, manage stakeholder engagement, and support project delivery for sustainable programs.',
      requirements: [
        "Bachelor's degree in Development Studies, Project Management or similar.",
        'Strong coordination skills and experience with donor-funded projects.',
        'Excellent report writing and stakeholder management experience.',
      ],
      email: 'kenya.hr@undp.org',
      careerUrl: null,
    },
    {
      id: 4,
      company: 'Equity Bank',
      title: 'Senior Software Engineer',
      location: 'Nairobi, Kenya',
      salary: 'KES 120,000 - 180,000',
      description: 'Develop and maintain backend systems for banking solutions, ensure code quality and system reliability.',
      requirements: [
        "Bachelor's degree in Computer Science or related field.",
        '5+ years of software development experience.',
        'Proficiency in Java, Python, or Go.',
      ],
      email: 'careers@equitybank.co.ke',
      careerUrl: 'https://www.equitybank.co.ke/careers',
    },
    {
      id: 5,
      company: 'Airtel Kenya',
      title: 'Network Engineer',
      location: 'Nairobi, Kenya',
      salary: 'KES 95,000 - 140,000',
      description: 'Design and maintain telecommunications infrastructure, optimize network performance.',
      requirements: [
        'Diploma or degree in Telecommunications or IT.',
        '3+ years in network engineering.',
        'CCNA or equivalent certification preferred.',
      ],
      email: 'careers@ke.airtel.com',
      careerUrl: 'https://www.airtel.co.ke/careers',
    },
    {
      id: 6,
      company: 'Britam',
      title: 'Insurance Claims Officer',
      location: 'Nairobi, Kenya',
      salary: 'KES 70,000 - 100,000',
      description: 'Process insurance claims, interact with clients, and ensure customer satisfaction.',
      requirements: [
        'Diploma in Insurance or related field.',
        '2+ years in claims processing.',
        'Strong customer service skills.',
      ],
      email: 'careers@britam.com',
      careerUrl: null,
    },
    {
      id: 7,
      company: 'Google Kenya',
      title: 'Data Analyst',
      location: 'Nairobi, Kenya',
      salary: 'KES 140,000 - 220,000',
      description: 'Analyze large datasets, create data visualizations, and provide insights to stakeholders.',
      requirements: [
        "Bachelor's degree in Statistics, Mathematics, or Computer Science.",
        '3+ years in data analysis.',
        'Proficiency in SQL, Python, and visualization tools.',
      ],
      email: 'careers@google.com',
      careerUrl: 'https://careers.google.com/locations/africa/',
    },
  ];

  function scanCVForATS(text) {
    const atsKeywords = {
      skills: ['java', 'python', 'javascript', 'sql', 'html', 'css', 'react', 'node', 'angular', 'c++', 'c#', 'php', 'ruby', 'swift', 'kotlin', 'golang'],
      experience: ['experience', 'worked', 'managed', 'led', 'developed', 'designed', 'implemented', 'years', 'project'],
      education: ['bachelor', 'master', 'degree', 'diploma', 'certification', 'university', 'college', 'school'],
      ats: ['email', 'phone', 'linkedin', 'portfolio', 'github', 'website'],
    };

    const lowerText = text.toLowerCase();
    let score = 0;
    let maxScore = 100;

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

    const hasLinks = /https?:\/\/[^\s]+|www\.[^\s]+/.test(text);
    if (hasLinks) score += 10;

    return Math.min(100, score);
  }

  function loadJobs() {
    jobsContainer.innerHTML = '';
    jobs.forEach((job) => {
      const isSaved = state.savedJobs.has(job.id);
      const isApplied = state.appliedJobs.has(job.id);
      
      const card = document.createElement('div');
      card.classList.add('job-card');
      card.innerHTML = `
        <div>
          <h4>${job.company}</h4>
          <h2>${job.title}</h2>
          <p>📍 ${job.location}</p>
          <p>💰 ${job.salary}</p>
        </div>
        <div class="job-card-actions">
          <button class="unlock-btn">View Details</button>
          <button class="share-btn" title="Share job" aria-label="Share job"><i class="fas fa-share-nodes" aria-hidden="true"></i></button>
          <button class="save-btn ${isSaved ? 'saved' : ''}" title="Save job">
            ${isSaved ? '❤️ Saved' : '🤍 Save'}
          </button>
          ${isApplied ? '<span class="applied-badge">✓ Applied</span>' : ''}
        </div>
      `;
      jobsContainer.appendChild(card);

      const viewBtn = card.querySelector('.unlock-btn');
      const shareBtn = card.querySelector('.share-btn');
      const saveBtn = card.querySelector('.save-btn');

      viewBtn.addEventListener('click', () => {
        if (!state.isLoggedIn) {
          openAuthModal('login');
          return;
        }
        openJobModal(job);
      });

      shareBtn.addEventListener('click', () => {
        shareJob(job);
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

  function updateWelcomeCard() {
    const savedCount = state.savedJobs.size;
    const appliedCount = state.appliedJobs.size;
    const welcomeStats = document.querySelector('.welcome-stats');
    
    if (welcomeStats) {
      welcomeStats.innerHTML = `
        <div>❤️ ${savedCount} Saved</div>
        <div>📄 ${appliedCount} Applications</div>
        <div>⭐ ${state.userProfile.cvRating > 0 ? state.userProfile.cvRating + '% Match' : 'Upload CV'}</div>
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
      if (
        authModal.classList.contains('hidden') &&
        roleModal.classList.contains('hidden') &&
        profileModal.classList.contains('hidden') &&
        jobModal.classList.contains('hidden')
      ) {
        modalBackdrop.classList.add('hidden');
      }
    }
  }

  function openJobModal(job) {
    currentJobId = job.id;
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
      state.appliedJobs.add(job.id);
      updateWelcomeCard();
      loadJobs();
      const subject = encodeURIComponent(`Application for ${job.title}`);
      const body = encodeURIComponent(`Dear Hiring Team,\n\nI am interested in the ${job.title} position at ${job.company}.\n\nPlease find my CV attached.\n\nBest regards,\n${state.userProfile.name}`);
      window.location.href = `mailto:${job.email}?subject=${subject}&body=${body}`;
      showToast('Opening email client...');
    };

    if (job.careerUrl) {
      jobModalWebsite.onclick = (e) => {
        e.preventDefault();
        state.appliedJobs.add(job.id);
        updateWelcomeCard();
        loadJobs();
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

  function openRoleModal() {
    selectedRole = null;
    authForm.dataset.mode = 'signup';
    authBack.classList.add('hidden');
    authRoleHint.textContent = 'Already have an account?';
    authSwitch.textContent = 'Log in';
    authTitle.textContent = 'Create your account';
    authSubtitle.textContent = 'Choose recruiter or job seeker.';
    authForm.reset();
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
    } else {
      authTitle.textContent = 'Create your account';
      authSubtitle.textContent = selectedRole
        ? `Signing up as a ${selectedRole === 'recruiter' ? 'recruiter' : 'job seeker'}`
        : 'Choose recruiter or job seeker first.';
      authRoleHint.textContent = 'Already have an account?';
      authSwitch.textContent = 'Log in';
      authBack.classList.remove('hidden');
    }
    authForm.reset();
    toggleModal(authModal, true);
    toggleModal(roleModal, false);
  }

  function showToast(message) {
    Toastify({
      text: message,
      duration: 2500,
      gravity: 'top',
      position: 'right',
      style: { background: '#2563eb' },
    }).showToast();
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

  async function shareJob(job) {
    const shareData = {
      title: `${job.title || 'Job'} on HireKe`,
      text: `${job.title || 'Job'} at ${job.company || 'HireKe'}`,
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
      if (error?.name !== 'AbortError') showToast('Could not share this job. Please try again.');
    }
  }

  function handleAuthSubmit(event) {
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

    state.isLoggedIn = true;
    state.role = mode === 'signup' ? selectedRole : 'jobseeker';
    state.userProfile.name = email.split('@')[0];
    loginBtn.textContent = 'Logout';
    signupBtn.style.display = 'none';
    profileBtn.classList.remove('hidden');
    updateWelcomeCard();
    toggleModal(authModal, false);
    toggleModal(roleModal, false);
    showToast(`Welcome ${state.role === 'recruiter' ? 'Recruiter' : 'Job Seeker'}!`);
  }

  function handleLogout() {
    state.isLoggedIn = false;
    state.role = null;
    state.userProfile.name = '';
    state.userProfile.cvContent = '';
    state.userProfile.cvRating = 0;
    loginBtn.textContent = 'Log In';
    signupBtn.style.display = 'inline-flex';
    profileBtn.classList.add('hidden');
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
  });

  roleCards.forEach((card) => {
    card.addEventListener('click', () => {
      selectedRole = card.dataset.role;
      openAuthModal('signup');
    });
  });

  authForm.addEventListener('submit', handleAuthSubmit);

  loadJobs();

  themeToggle.addEventListener('click', () => {
    const body = document.body;
    body.classList.toggle('dark-mode');
    themeToggle.textContent = body.classList.contains('dark-mode') ? '☀️' : '🌙';
  });
});
