(function () {
  const API_BASE_URL = window.API_BASE_URL || '/api';
  const slugFromPath = () => window.location.pathname.replace(/^\/+/, '').replace(/\/+$/, '') || 'privacy';
  const policyLinks = {
    privacy: 'Privacy',
    terms: 'Terms',
    'recruiter-terms': 'Recruiter Terms',
    'payments-refunds': 'Payments & Refunds',
    cookies: 'Cookies',
    'candidate-data-consent': 'Candidate Data Consent',
    'ai-transparency': 'AI Transparency',
    'acceptable-use': 'Acceptable Use',
    'opportunity-posting-policy': 'Opportunity Posting',
    'data-deletion': 'Data & Account Deletion',
    'intellectual-property': 'Intellectual Property',
    complaints: 'Contact & Complaints',
  };

  function el(id) {
    return document.getElementById(id);
  }

  function anchor(text, index) {
    return `${String(text || 'section').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}-${index}`;
  }

  function renderLinks(activeSlug) {
    el('legal-policy-links').innerHTML = Object.entries(policyLinks)
      .map(([slug, label]) => `<a class="${slug === activeSlug ? 'active' : ''}" href="/${slug}">${label}</a>`)
      .join('');
  }

  function renderComplaintForm(activeSlug) {
    const form = el('complaint-form');
    form.classList.toggle('hidden', activeSlug !== 'complaints');
    if (activeSlug !== 'complaints') return;
    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const status = el('complaint-status');
      const button = el('complaint-submit');
      button.classList.add('is-loading');
      status.textContent = '';
      try {
        const response = await fetch(`${API_BASE_URL}/legal/complaints`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            category: el('complaint-category').value,
            name: el('complaint-name').value,
            email: el('complaint-email').value,
            subject: el('complaint-subject').value,
            message: el('complaint-message').value,
            relatedUrl: el('complaint-url').value,
          }),
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Could not submit complaint.');
        status.textContent = `Complaint submitted. Reference: ${data.complaintId}`;
        form.reset();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        button.classList.remove('is-loading');
      }
    }, { once: true });
  }

  async function init() {
    const slug = slugFromPath();
    renderLinks(slug);
    renderComplaintForm(slug);
    try {
      const response = await fetch(`${API_BASE_URL}/legal/policies/${encodeURIComponent(slug)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Policy not found.');
      const policy = data.policy;
      document.title = `${policy.title} - HireKe`;
      el('legal-status').textContent = '';
      el('legal-title').textContent = policy.title;
      el('legal-summary').textContent = policy.summary || '';
      el('legal-version').textContent = policy.version;
      el('legal-effective').textContent = policy.effectiveDate;
      el('legal-updated').textContent = policy.lastUpdated;
      el('legal-toc').innerHTML = policy.sections.map((section, index) => {
        const id = anchor(section.heading, index);
        return `<a href="#${id}">${section.heading}</a>`;
      }).join('');
      el('legal-sections').innerHTML = '';
      policy.sections.forEach((section, index) => {
        const node = document.createElement('section');
        node.id = anchor(section.heading, index);
        const h2 = document.createElement('h2');
        h2.textContent = section.heading;
        const paragraphs = String(section.body || '').split(/\n+/).filter(Boolean).map((text) => {
          const p = document.createElement('p');
          p.textContent = text;
          return p;
        });
        node.append(h2, ...paragraphs);
        el('legal-sections').appendChild(node);
      });
    } catch (error) {
      el('legal-status').textContent = error.message;
    }
  }

  init();
}());
