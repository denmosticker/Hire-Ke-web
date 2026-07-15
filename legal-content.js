const POLICY_VERSION = '2026.07.14';
const EFFECTIVE_DATE = '2026-07-14';
const LAST_UPDATED = '2026-07-14';

function contactDetails() {
  const defaultSupportEmail = 'support.hirekenya@gmail.com';
  return {
    supportEmail: process.env.HIREKE_SUPPORT_EMAIL || process.env.SMTP_USER || defaultSupportEmail,
    privacyEmail: process.env.HIREKE_PRIVACY_EMAIL || process.env.HIREKE_SUPPORT_EMAIL || process.env.SMTP_USER || defaultSupportEmail,
    legalEmail: process.env.HIREKE_LEGAL_EMAIL || process.env.HIREKE_SUPPORT_EMAIL || process.env.SMTP_USER || defaultSupportEmail,
  };
}

const disclaimer = 'Legal review note: these documents are operational drafts for HireKe and should be reviewed by a qualified Kenyan lawyer before full commercial launch. They do not claim any licence, ODPC registration, PCI-DSS certification, insurance, or government approval unless HireKe later verifies and configures those details.';

function policy(slug, title, summary, sections) {
  return { slug, title, version: POLICY_VERSION, effectiveDate: EFFECTIVE_DATE, lastUpdated: LAST_UPDATED, summary, sections };
}

function allPolicies() {
  const c = contactDetails();
  return {
    privacy: policy('privacy', 'Privacy Policy', 'How HireKe collects, uses, shares, stores, and protects personal data for job seekers, recruiters, payments, CVs, messaging, and AI-assisted matching.', [
      { heading: 'Legal Status And Contact', body: `${disclaimer}\n\nHireKe can be contacted about privacy and support matters by email. Privacy contact: ${c.privacyEmail}. Support contact: ${c.supportEmail}. HireKe does not claim an ODPC registration number or regulatory approval in these documents unless that status is separately confirmed and published.` },
      { heading: 'Information We Collect', body: 'HireKe may collect names, email addresses, phone numbers, account credentials, role, company information, profile photos or logos, CVs and resumes, education, skills, employment history, experience, projects, certifications, languages, location, salary preferences, opportunity interests, applications, messages, recruiter notes, verification documents, payment transaction references, device and browser information, IP addresses, logs, security events, cookies, localStorage preferences, and AI matching data such as embeddings, match scores, reasons, and profile text used for recommendations.' },
      { heading: 'How Information Is Collected', body: 'Information is collected when users create accounts, verify email, complete profiles, upload CVs or documents, post opportunities, apply for opportunities, message other users, make PalPlus/M-Pesa payments, contact support, submit complaints, use AI matching, or browse the website.' },
      { heading: 'Why HireKe Processes Data', body: 'HireKe processes data to provide accounts, authentication, email verification, job seeker profiles, recruiter dashboards, opportunity posting, Easy Apply, external application tracking, messaging, Opportunity Passport features, AI-assisted opportunity recommendations, recruiter candidate matching, verification services, billing, fraud prevention, platform security, support, legal compliance, analytics needed to operate the service, and user-requested communications.' },
      { heading: 'Lawful Bases And Consent', body: 'Depending on the activity, processing may rely on contract performance, consent, legitimate interests such as security and fraud prevention, legal obligations, and user-requested steps before a contract. CV processing, recruiter visibility, and optional AI-assisted matching use separate consent or preference controls where technically supported. Users may withdraw optional consent, although some features may stop working.' },
      { heading: 'Public And Private Profiles', body: 'Public professional profile visibility is controlled separately from CV upload. Recruiters do not receive unrestricted access to every private profile or CV. A candidate applying to a recruiter opportunity may allow appropriate application context to be shown to that recruiter under HireKe application rules.' },
      { heading: 'CVs And Opportunity Passport', body: 'CVs may be stored in configured object storage, parsed to extract professional information, used to improve profile completion and Opportunity Passport information, and used for candidate-requested applications and matching. Users can replace or delete their current CV from their account controls.' },
      { heading: 'AI Matching', body: 'HireKe may use profile, CV, skills, experience, education, location, preferences, and opportunity requirements to estimate matches and explain recommendations. AI scores are estimates and do not guarantee employment, scholarship, funding, selection, candidates, or hiring results. Recruiters remain responsible for human hiring decisions.' },
      { heading: 'Payments And M-Pesa', body: 'HireKe may store payment references, invoice details, transaction status, gateway references, checkout request identifiers, and package details for PalPlus and M-Pesa transactions. HireKe does not ask for, receive, or store a user’s M-Pesa PIN.' },
      { heading: 'Sharing And Service Providers', body: 'HireKe may share data with recruiters in the context of profiles made visible by the candidate, applications initiated by the candidate, messaging, or recruiter tools. HireKe may use cloud hosting, Postgres database hosting, object/file storage such as Cloudflare R2, email providers, AI service providers, and payment processors such as PalPlus/M-Pesa to run the service.' },
      { heading: 'International Processing', body: 'Some infrastructure or service providers may process data outside Kenya. HireKe should assess cross-border transfer requirements before scaling commercial operations and should use appropriate safeguards where required.' },
      { heading: 'Retention And Deletion', body: 'HireKe keeps account, profile, application, message, payment, security, and support records for as long as needed to provide the service, meet legal obligations, resolve disputes, prevent fraud, and maintain backups. Deleting a CV removes it from the active profile; backup and audit copies may persist for a limited period where technically or legally necessary.' },
      { heading: 'Security', body: 'HireKe uses authentication, role-based access controls, rate limiting for sensitive flows, server-side validation, protected admin endpoints, and hosted storage/database services. No internet service can guarantee absolute security.' },
      { heading: 'Children And Minors', body: 'HireKe is intended for users who can lawfully use employment and opportunity services. Minors should only use HireKe with appropriate parental or guardian involvement where required by Kenyan law.' },
      { heading: 'User Rights And Complaints', body: 'Users may request access, correction, deletion, restriction, objection, portability where applicable, consent withdrawal, account closure, and complaint review. Privacy requests may be sent through the Privacy & Data settings or to the privacy contact. Users may also have complaint rights with Kenya’s Office of the Data Protection Commissioner.' },
      { heading: 'Policy Updates', body: 'HireKe may update this policy. Material changes may require renewed acknowledgement in the future. The policy version and accepted versions are stored with user consent records.' },
    ]),
    terms: policy('terms', 'Terms of Service', 'Platform rules for job seekers, recruiters, accounts, applications, CVs, messages, payments, AI matching, and acceptable conduct.', [
      { heading: 'Acceptance', body: 'By creating or using a HireKe account, you agree to these Terms and acknowledge the Privacy Policy. If you do not agree, do not use the service.' },
      { heading: 'Legal Review Note', body: `${disclaimer}\n\nHireKe’s business model, especially recruiter matching, verification services, subscription limits, and any commission-after-hire model introduced later, may need separate Kenyan legal review.` },
      { heading: 'Accounts And Eligibility', body: 'Users must provide accurate information, keep passwords secure, verify email when required, and use the correct role. Job seeker, recruiter, and admin features have different permissions. Admin tools are for authorised HireKe operators only.' },
      { heading: 'Job Seekers And Content', body: 'Job seekers own their CVs, profile content, photos, education, skills, work history, Opportunity Passport information, messages, and application materials. Users grant HireKe a limited licence to host, process, display, transmit, and analyse that content only to provide the service, applications, security, support, and matching features.' },
      { heading: 'Recruiters And Opportunities', body: 'Recruiters must have authority to act for the organisation they represent, provide accurate company details, post genuine opportunities, and handle candidate data lawfully. Recruiter-specific obligations are in the Recruiter Terms.' },
      { heading: 'Applications And Messaging', body: 'HireKe supports Easy Apply, external application links, email application methods, WhatsApp links, and messaging where enabled. HireKe does not guarantee that an application will be reviewed, that a candidate will be hired, or that a recruiter will receive suitable candidates.' },
      { heading: 'AI Matching', body: 'AI recommendations, explanations, and match scores are informational tools. They are not guaranteed hiring, employment, scholarship, funding, tender, grant, or selection decisions. Recruiters remain responsible for human review and final decisions.' },
      { heading: 'Payments', body: 'Paid services are subject to the Payment, Billing and Refund Policy. HireKe does not receive or store M-Pesa PINs. Do not submit payment credentials in HireKe forms.' },
      { heading: 'Prohibited Conduct', body: 'Users must not create fake accounts, fake CVs, fake companies, fraudulent credentials, fake opportunities, scams, phishing, spam, harassment, discriminatory abuse, malware, credential theft, scraping, payment fraud, or attempts to bypass platform restrictions.' },
      { heading: 'Suspension And Termination', body: 'HireKe may remove content, restrict features, suspend, or terminate accounts for policy breaches, fraud risk, unpaid fees, legal risk, or platform security issues. Users may request account deletion through privacy controls.' },
      { heading: 'Intellectual Property', body: 'HireKe branding, website code, design assets, and platform materials belong to HireKe or its licensors. User and recruiter content remains owned by the relevant user, subject to the limited service licence described here.' },
      { heading: 'Availability And Liability', body: 'HireKe aims to provide a reliable service but does not guarantee uninterrupted availability or error-free matching, payments, emails, or integrations. Liability is limited to the extent allowed by applicable Kenyan law.' },
      { heading: 'Governing Law And Disputes', body: 'These Terms are intended to be governed by the laws of Kenya, subject to legal review. Users should first contact HireKe through the complaints process so issues can be reviewed promptly.' },
    ]),
    'recruiter-terms': policy('recruiter-terms', 'Recruiter Terms', 'Extra rules for recruiter accounts, company identity, candidate data, subscriptions, postings, and hiring conduct.', [
      { heading: 'Recruiter Eligibility And Identity', body: 'Recruiters must provide accurate company identity, company name, logo where used, contact information, and have authority to post and communicate on behalf of the organisation.' },
      { heading: 'Posting Standards', body: 'Recruiters may post only genuine opportunities with accurate title, organisation, type, description, requirements, location, deadline, eligibility, compensation where provided, fees where legitimate, and application method.' },
      { heading: 'Candidate Data', body: 'Recruiters may use candidate data only for the opportunity, application, hiring, or communication context allowed by HireKe. Recruiters must not scrape, harvest, export for unrelated use, resell, or spam candidates.' },
      { heading: 'CV And Opportunity Passport Access', body: 'CV access and profile visibility depend on candidate settings, applications, and platform rules. A CV upload does not make every candidate searchable or public.' },
      { heading: 'Fraud And Fees', body: 'Fake recruitment, fake companies, recruitment scams, phishing, misleading urgency, fabricated government opportunities, fake grants, and unlawful or misleading candidate fees are prohibited.' },
      { heading: 'Non-Discrimination', body: 'Recruiters are responsible for ensuring opportunity content and hiring decisions comply with applicable Kenyan law and do not use discriminatory wording or selection practices.' },
      { heading: 'Plans And Limits', body: 'Recruiter plans, active opportunity limits, seats, featured jobs, AI, API, CV parsing, and billing cycles are controlled by the live payment catalog and subscription code. HireKe should keep displayed pricing aligned with code before launch.' },
      { heading: 'AI Matching', body: 'AI candidate rankings are estimates for prioritisation and explanation. Recruiters remain responsible for final decisions and must not treat match scores as certifications of suitability.' },
      { heading: 'Suspension And Investigations', body: 'HireKe may suspend recruiter features, remove opportunities, review payments, and request verification where fraud, abuse, spam, scraping, or policy violations are suspected.' },
      { heading: 'Data Deletion Obligations', body: 'If a candidate withdraws, closes an account, or asks for deletion, recruiters must respect lawful deletion or restriction instructions communicated by HireKe, subject to applicable record-retention obligations.' },
    ]),
    'payments-refunds': policy('payments-refunds', 'Payment, Billing And Refund Policy', 'How HireKe handles recruiter subscriptions, verification payments, featured opportunities, PalPlus STK Push, M-Pesa references, failures, and refunds.', [
      { heading: 'Paid Services', body: 'HireKe may charge for recruiter subscriptions, verification services, featured opportunities, add-ons, and other paid platform services shown in the live catalog. Prices are generally displayed in Kenyan shillings where applicable.' },
      { heading: 'Payment Initiation', body: 'For PalPlus/M-Pesa STK Push, HireKe displays the selected product and amount, asks for the M-Pesa phone number, sends the STK Push, and waits for payment verification or callback. Users enter their M-Pesa PIN only on their phone prompt. HireKe does not receive or store M-Pesa PINs.' },
      { heading: 'Callbacks And Activation', body: 'HireKe stores transaction references, checkout request identifiers, invoice references, status, and gateway references. Subscriptions, verification priority, or featured opportunity benefits activate only after successful payment or zero-value checkout where supported.' },
      { heading: 'Renewal', body: 'The current code records monthly or annual periods but does not implement automatic recurring billing. Users should not assume automatic renewal unless HireKe later adds and discloses that feature.' },
      { heading: 'Failed, Cancelled, Or Duplicate Payments', body: 'Failed or cancelled STK requests do not activate paid services. Duplicate payments, confirmed technical failures, payments made without service activation, and disputed transactions may be reviewed for refund or correction.' },
      { heading: 'Refund Requests', body: 'Refunds are reviewed case by case, especially for duplicate payments, confirmed technical failures, fraud review, and non-activation. HireKe may request transaction references and account details needed to investigate.' },
      { heading: 'Suspension For Unpaid Fees', body: 'Paid recruiter benefits may be suspended, downgraded, or expire if payment is not completed or the subscription period ends.' },
      { heading: 'Taxes', body: 'Taxes, levies, or statutory charges may apply depending on HireKe’s final business and tax position. This requires legal and accounting review.' },
    ]),
    cookies: policy('cookies', 'Cookie Policy', 'How HireKe uses essential storage, authentication tokens, preferences, and browser storage.', [
      { heading: 'Current Storage Use', body: 'The current HireKe frontend uses localStorage for authentication tokens, user role, saved UI state, theme preference, and other browser-side preferences. The codebase does not currently prove use of Google Analytics, Meta Pixel, Hotjar, or similar third-party marketing trackers.' },
      { heading: 'Essential And Security Storage', body: 'Authentication tokens and security-related browser storage are needed to keep users signed in, load dashboards, protect API requests, and restore user state after reload.' },
      { heading: 'Preference Storage', body: 'Theme and UI preferences may be stored so users can keep their preferred experience. HireKe opens in light mode by default unless a user actively chooses otherwise.' },
      { heading: 'Analytics And Marketing', body: 'HireKe should not claim analytics or marketing cookies unless those tools are added and disclosed. If added later, HireKe should update this policy and provide appropriate consent controls where required.' },
      { heading: 'Managing Storage', body: 'Users can clear browser storage through their browser settings, but doing so may log them out or reset preferences.' },
    ]),
    'candidate-data-consent': policy('candidate-data-consent', 'Candidate Data And CV Consent Notice', 'Plain-language notice for CV upload and professional information processing.', [
      { heading: 'CV Processing Consent', body: 'When you upload a CV, HireKe stores and processes it to provide profile, application, and opportunity-matching services. Information may be extracted from the CV and used to help build your Opportunity Passport and professional profile.' },
      { heading: 'Applications And Recruiter Access', body: 'Your CV may be included in applications you initiate. Recruiter access depends on your profile visibility settings and application context. Uploading a CV does not force your profile or CV to become public.' },
      { heading: 'AI Use', body: 'HireKe may analyse professional information to recommend opportunities and estimate matches if AI matching is enabled. AI recommendations may be wrong and do not guarantee a job or selection.' },
      { heading: 'Your Controls', body: 'You can replace your CV, delete the active CV from your profile, disable recruiter profile visibility, and disable optional AI matching where supported.' },
    ]),
    'ai-transparency': policy('ai-transparency', 'AI Transparency Notice', 'How HireKe uses AI-assisted matching and what its limits are.', [
      { heading: 'How Matching Works', body: 'HireKe may compare profile information, skills, experience, education, location, salary preferences where available, opportunity interests, CV text, and opportunity requirements to estimate match scores and explanations.' },
      { heading: 'Recruiter Rankings', body: 'Recruiter candidate rankings are generated from candidate and opportunity information and may prioritise applicants or visible candidates. They are estimates, not employment decisions.' },
      { heading: 'Limits And Bias Risk', body: 'AI can be inaccurate, incomplete, biased, or affected by missing profile data. Users should keep profiles current and report incorrect recommendations.' },
      { heading: 'Human Responsibility', body: 'AI does not guarantee a job and does not make the final hiring decision unless HireKe deliberately builds and discloses such a system later. Recruiters remain responsible for employment decisions.' },
      { heading: 'User Choice', body: 'Users can disable optional AI-assisted recommendations and match estimates in Privacy & Data settings where technically supported.' },
    ]),
    'acceptable-use': policy('acceptable-use', 'Acceptable Use Policy', 'Conduct rules for keeping HireKe safe and trustworthy.', [
      { heading: 'Banned Conduct', body: 'HireKe bans fake accounts, fake CVs, fraudulent credentials, fake companies, fake opportunities, phishing, recruitment scams, candidate scraping, data harvesting, spam, malware, credential theft, impersonation, harassment, discriminatory abuse, illegal content, harmful platform probing, payment fraud, manipulating subscriptions, bypassing account restrictions, and automated scraping without written authorisation.' },
      { heading: 'Enforcement', body: 'HireKe may remove content or opportunities, issue warnings, temporarily suspend access, permanently terminate accounts, review payments, preserve evidence, and cooperate with lawful investigations where legally required.' },
    ]),
    'opportunity-posting-policy': policy('opportunity-posting-policy', 'Job And Opportunity Posting Policy', 'Rules for jobs and all opportunity types supported by HireKe.', [
      { heading: 'Covered Opportunity Types', body: 'This policy applies to full-time, part-time, contract, internship, attachment, apprenticeship, graduate trainee, scholarship, grant, fellowship, competition, tender, government opportunity, startup funding, incubator/accelerator, training, bootcamp, volunteer, remote work, freelance, consultancy, event, and other opportunities.' },
      { heading: 'Required Accuracy', body: 'Each post must have an accurate title, real organisation, correct type, clear description, genuine deadline, accurate location, accurate application method, transparent eligibility, accurate salary or compensation where provided, and clear fees where legitimate.' },
      { heading: 'Prohibited Posts', body: 'HireKe prohibits misleading urgency, impersonation, fabricated government opportunities, fake grants, pay-to-get-a-job scams, unlawful discriminatory wording, and public application forms that collect unnecessary sensitive data.' },
      { heading: 'Reporting And Review', body: 'Users can report suspicious opportunities through complaints. HireKe may review, edit, reject, suspend, or remove opportunities and investigate recruiter accounts.' },
    ]),
    'data-deletion': policy('data-deletion', 'Data Deletion And Account Closure Policy', 'How users request deletion, account closure, CV deletion, and data export.', [
      { heading: 'Account Closure', body: 'Users may request account deletion or closure from Privacy & Data settings or by contacting HireKe. HireKe may need to verify identity before acting on requests.' },
      { heading: 'What Deletion Covers', body: 'Deletion may remove or deactivate profile content, CV links, profile photos, public profile access, preferences, and account access. Some application records, messages, payment references, security logs, invoices, support records, and fraud investigation records may be retained where legally or operationally necessary.' },
      { heading: 'CV And File Deletion', body: 'Users can delete the active CV from their profile. Object storage and backup deletion may take additional time depending on provider and retention settings.' },
      { heading: 'Backups And Legal Holds', body: 'Immediate deletion from every backup is not guaranteed. Active disputes, fraud reviews, legal obligations, and payment records may require limited retention.' },
      { heading: 'Recruiter Closure', body: 'Recruiter account closure may also affect active postings, applications, subscriptions, invoices, and candidate communications. Subscription cancellation and refund issues are handled under the Payment, Billing and Refund Policy.' },
    ]),
    'intellectual-property': policy('intellectual-property', 'Copyright And Intellectual Property Policy', 'Ownership and complaint process for HireKe assets, user content, CVs, and recruiter posts.', [
      { heading: 'HireKe Materials', body: 'HireKe branding, logos, website code, design assets, and platform materials are owned by HireKe or its licensors. Users may not copy or misuse them without permission.' },
      { heading: 'User And Recruiter Content', body: 'Users retain ownership of CVs, profile content, photos, application content, and recruiter opportunity content. HireKe receives a limited licence to host, display, transmit, process, and analyse content to provide the service.' },
      { heading: 'Infringement Reports', body: `Send intellectual property complaints to ${c.legalEmail} with the content URL, ownership explanation, contact details, and requested action. HireKe may remove content, ask for more information, restore content if a complaint is false, and restrict repeat infringers.` },
      { heading: 'False Complaints', body: 'Knowingly false copyright or IP complaints may lead to account restrictions and responsibility for resulting harm where allowed by law.' },
    ]),
    complaints: policy('complaints', 'Contact, Complaints And Dispute Procedure', 'How users report support, privacy, payments, fake opportunities, harassment, IP, AI, and account appeal issues.', [
      { heading: 'Contact Channels', body: `General support: ${c.supportEmail}. Privacy requests: ${c.privacyEmail}. Legal/IP complaints: ${c.legalEmail}.` },
      { heading: 'Complaint Categories', body: 'HireKe accepts general support, privacy complaints, data requests, recruiter complaints, payment complaints, fake opportunity reports, fake profile reports, harassment reports, copyright/IP complaints, AI matching complaints, and account appeals.' },
      { heading: 'Review Process', body: 'HireKe may acknowledge, triage, request more information, review logs and account activity, restrict content or accounts, mark the complaint reviewed or resolved, and communicate an outcome where appropriate.' },
      { heading: 'External Rights', body: 'Privacy complaints may also be raised with Kenya’s Office of the Data Protection Commissioner where applicable.' },
    ]),
  };
}

function listPolicies() {
  return Object.values(allPolicies()).map(({ sections, ...meta }) => meta);
}

function getPolicy(slug) {
  return allPolicies()[slug] || null;
}

const CONSENT_TYPES = {
  terms: 'terms_acceptance',
  privacy: 'privacy_acknowledgement',
  cv: 'cv_processing',
  recruiterVisibility: 'recruiter_visibility',
  ai: 'ai_matching',
};

module.exports = {
  POLICY_VERSION,
  EFFECTIVE_DATE,
  LAST_UPDATED,
  CONSENT_TYPES,
  listPolicies,
  getPolicy,
  allPolicies,
  contactDetails,
};
