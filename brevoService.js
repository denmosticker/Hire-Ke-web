const axios = require('axios');

const BREVO_API_KEY = process.env.BREVO_API_KEY;

// Brevo List IDs (as per your request)
const BREVO_LISTS = {
  jobseeker: 3, // Corresponds to Brevo List #3 (Job Seekers)
  employer: 4   // Corresponds to Brevo List #4 (Employers)
};

/**
 * Sends user contact data to Brevo for marketing list segmentation.
 * @param {string} email User's email address.
 * @param {string} firstName User's first name.
 * @param {'jobseeker' | 'recruiter'} role User's role in HireKe.
 * @param {string} county User's county.
 * @param {string} industry User's industry.
 */
async function sendContactToBrevo(email, firstName, role, county, industry) {
  if (!BREVO_API_KEY) {
    console.warn('Brevo API Key is not configured. Skipping Brevo contact registration.');
    return;
  }

  // Map HireKe role to Brevo's expected role for list segmentation
  const brevoRole = role === 'recruiter' ? 'employer' : role;
  const listId = BREVO_LISTS[brevoRole];

  if (!listId) {
    console.warn(`Invalid or unmapped role '${role}' for Brevo contact. Skipping.`);
    return;
  }

  try {
    await axios.post(
      "https://api.brevo.com/v3/contacts",
      { email, attributes: { FIRSTNAME: firstName, ROLE: brevoRole, COUNTY: county || "", INDUSTRY: industry || "" }, listIds: [listId], updateEnabled: true },
      { headers: { "api-key": BREVO_API_KEY, "Content-Type": "application/json" } }
    );
    console.log(`✓ Contact ${email} (${brevoRole}) added/updated in Brevo List #${listId}`);
  } catch (error) {
    console.error(`✗ Failed to add contact ${email} to Brevo:`, error.response?.data || error.message);
  }
}

async function sendTransactionalEmail({ to, subject, html }) {
  if (!BREVO_API_KEY) {
    throw new Error('Brevo API Key is not configured.');
  }

  const senderEmail = process.env.BREVO_SENDER_EMAIL || process.env.SMTP_USER;
  const senderName = process.env.BREVO_SENDER_NAME || 'HireKe';

  if (!senderEmail) {
    throw new Error('Brevo sender email is not configured.');
  }

  await axios.post(
    'https://api.brevo.com/v3/smtp/email',
    {
      sender: { name: senderName, email: senderEmail },
      to: [{ email: to }],
      subject,
      htmlContent: html,
    },
    { headers: { 'api-key': BREVO_API_KEY, 'Content-Type': 'application/json' } }
  );
}

module.exports = { sendContactToBrevo, sendTransactionalEmail };
