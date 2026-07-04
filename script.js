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
      email: 'jobs@safaricom.co.ke',
      website: 'https://www.safaricom.co.ke/careers',
    },
    {
      company: 'KCB Bank',
      title: 'Relationship Manager',
      location: 'Nairobi, Kenya',
      salary: 'KES 100,000 - 150,000',
      description: 'Build and manage client relationships, focus on SME growth, and deliver exceptional service for KCB customers.',
      requirements: [
        'Bachelor’s degree in Business, Finance, or related field.',
        '3+ years in banking or commercial relationship management.',
        'Excellent communication and client engagement skills.',
      ],
      email: 'careers@kcbgroup.com',
      website: 'https://www.kcbgroup.com/careers',
    },
    {
      company: 'UNDP Kenya',
      title: 'Project Coordinator',
      location: 'Nairobi, Kenya',
      salary: 'KES 90,000 - 130,000',
      description: 'Coordinate development initiatives, manage stakeholder engagement, and support project delivery for sustainable programs.',
      requirements: [
        'Bachelor’s degree in Development Studies, Project Management or similar.',
        'Strong coordination skills and experience with donor-funded projects.',
        'Excellent report writing and stakeholder management experience.',
      ],
      email: 'kenya.hr@undp.org',
      website: 'https://www.ke.undp.org/content/kenya/en/home/jobs.html',
    },
    {
      company: 'M-Pesa',
      title: 'Product Growth Lead',
      location: 'Nairobi, Kenya',
      salary: 'KES 110,000 - 160,000',
      description: 'Lead product growth initiatives for M-Pesa services, define customer journeys, and work closely with marketing and operations teams.',
      requirements: [
        'Degree in Marketing, Business or related field.',
        'Experience in product growth, digital campaigns or fintech services.',
        'Strong analytical and stakeholder collaboration skills.',
      ],
      email: 'talent@mpesa.com',
      website: 'https://www.safaricom.co.ke/career',
    },
  ];

  function loadJobs() {
    jobsContainer.innerHTML = '';
    jobs.forEach((job) => {
      const card = document.createElement('div');
      card.classList.add('job-card');
      card.innerHTML = `
        <div>
          <h4>${job.company}</h4>
          <h2>${job.title}</h2>
          <p>📍 ${job.location}</p>
          <p>💰 ${job.salary}</p>
        </div>
        <div>
          <p>View the job description and apply directly.</p>
          <button class="unlock-btn">View Details</button>
        </div>
      `;
      jobsContainer.appendChild(card);

      const button = card.querySelector('.unlock-btn');
      button.addEventListener('click', () => {
        if (!state.isLoggedIn) {
          openAuthModal('login');
          return;
        }
        openJobModal(job);
      });
    });
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
    jobModalTitle.textContent = job.title;
    jobModalCompany.textContent = job.company;
    jobModalLocation.textContent = `📍 ${job.location}`;
    jobModalSalary.textContent = `💰 ${job.salary}`;
    jobModalDescription.textContent = job.description;
    jobModalRequirements.innerHTML = job.requirements.map((item) => `<li>${item}</li>`).join('');
    jobModalApply.textContent = `Send your CV to ${job.email} or use the company website to submit your application.`;
    jobModalEmail.href = `mailto:${job.email}?subject=${encodeURIComponent('Application for ' + job.title)}`;
    jobModalWebsite.href = job.website;
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

  function updateWelcomeCard() {
    const welcomeCard = document.querySelector('.welcome-card h3');
    if (welcomeCard && state.userProfile.name) {
      welcomeCard.textContent = `Welcome back, ${state.userProfile.name} 👋`;
    }
  }

  function handleLogout() {
    state.isLoggedIn = false;
    state.role = null;
    state.userProfile.name = '';
    loginBtn.textContent = 'Log In';
    signupBtn.style.display = 'inline-flex';
    profileBtn.classList.add('hidden');
    const welcomeCard = document.querySelector('.welcome-card h3');
    if (welcomeCard) {
      welcomeCard.textContent = 'Welcome back, Guest 👋';
    }
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
