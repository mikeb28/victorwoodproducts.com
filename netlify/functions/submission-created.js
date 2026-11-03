// Netlify event-triggered function.
//
// The name `submission-created` is special: Netlify runs this automatically
// whenever a form submission is VERIFIED — i.e. it has already PASSED Netlify's
// spam filter. Netlify's filter is a probability score, though, and bots that
// POST straight to Netlify (skipping the page, the honeypot and reCAPTCHA)
// still get through as "verified" now and then. So this function applies its
// own stricter check before doing anything:
//
//   1. Emails the lead to the owner (Resend), so the inbox only gets real leads.
//      Netlify's own form-notification email should be turned OFF once this works.
//   2. Forwards the lead to GA4 using the Measurement Protocol (server-to-server),
//      firing a `generate_lead` event that you can mark as a Key event / import
//      into Google Ads as a conversion.
//
// Environment variables (Netlify → Site settings → Environment variables):
//   RESEND_API_KEY  — from resend.com → API Keys. See GA4_SETUP.md.
//   LEAD_EMAIL_TO   — where lead emails go (comma-separate several addresses).
//   LEAD_EMAIL_FROM — optional; defaults to Resend's shared sender, which can
//                     only deliver to the email the Resend account signed up with.
//   GA4_API_SECRET  — created in GA4: Admin → Data Streams → your stream
//                     → Measurement Protocol API secrets → Create.

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || 'G-KKHJB7JPMH';
const GA4_API_SECRET = process.env.GA4_API_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const LEAD_EMAIL_TO = process.env.LEAD_EMAIL_TO;
const LEAD_EMAIL_FROM =
  process.env.LEAD_EMAIL_FROM || 'Victor Wood Products Website <onboarding@resend.dev>';

// Bots that POST directly never see the product dropdown, and the page won't let
// a person submit without picking one — so a real option here means a real visitor.
const VALID_PRODUCTS = [
  'New Wood Pallets',
  'Custom Crates & Boxes',
  'Lumber & Wood Sales',
  'Government Contract',
  'Other',
];

const EMAIL_FIELDS = [
  ['Name', 'name'],
  ['Company', 'company'],
  ['Email', 'email'],
  ['Phone', 'phone'],
  ['Looking for', 'product'],
  ['Details', 'message'],
];

async function sendLeadEmail(data) {
  if (!RESEND_API_KEY || !LEAD_EMAIL_TO) {
    console.error('RESEND_API_KEY or LEAD_EMAIL_TO is not set — lead email NOT sent.');
    return;
  }

  // Plain text only: submissions can contain HTML/links and must not render.
  const text = EMAIL_FIELDS
    .map(([label, key]) => `${label}:\n${(data[key] || '').toString().trim() || '—'}`)
    .join('\n\n');

  const email = {
    from: LEAD_EMAIL_FROM,
    to: LEAD_EMAIL_TO.split(',').map((s) => s.trim()).filter(Boolean),
    subject: `New quote request: ${data.product} — ${data.name || 'website visitor'}`,
    text,
  };
  // Hitting Reply in the inbox goes straight to the customer.
  if (data.email) email.reply_to = data.email;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(email),
  });

  if (!res.ok) {
    console.error('Resend error — lead email NOT sent', res.status, await res.text());
    return;
  }
  console.log(`Lead email sent (product=${data.product})`);
}

async function sendGa4Lead(data) {
  if (!GA4_API_SECRET) {
    // Don't hard-fail the build/deploy or retry-storm — just log and move on.
    console.error('GA4_API_SECRET is not set — skipping GA4 event.');
    return;
  }

  // GA client id is captured client-side into a hidden field (see index.html).
  // If it's missing for any reason, fall back to a synthetic id so the lead
  // still records — it just won't be tied back to the original session/source.
  const clientId =
    data.ga_client_id ||
    `${Math.floor(Math.random() * 1e10)}.${Math.floor(Date.now() / 1000)}`;
  const sessionId = data.ga_session_id;

  const params = {
    lead_source: 'website_quote_form',
    product_interest: data.product || '(not set)',
    // Non-zero engagement time helps GA4 attribute/process the event.
    engagement_time_msec: 1,
  };
  // Passing session_id ties the conversion to the visitor's original session,
  // which is what carries the traffic source / campaign attribution.
  if (sessionId) params.session_id = sessionId;

  const payload = {
    client_id: clientId,
    events: [{ name: 'generate_lead', params }],
  };

  const url =
    'https://www.google-analytics.com/mp/collect' +
    `?measurement_id=${encodeURIComponent(GA4_MEASUREMENT_ID)}` +
    `&api_secret=${encodeURIComponent(GA4_API_SECRET)}`;

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    console.error('GA4 Measurement Protocol error', res.status, await res.text());
    return;
  }
  console.log(`generate_lead sent to GA4 (client_id=${clientId}, product=${params.product_interest})`);
}

exports.handler = async (event) => {
  try {
    const body = JSON.parse(event.body || '{}');
    const submission = body.payload || {};
    const data = submission.data || {};

    // Only act on the quote/contact form (ignore any other Netlify form).
    const formName = submission.form_name || data['form-name'];
    if (formName && formName !== 'contact') {
      return { statusCode: 200, body: `Ignored form: ${formName}` };
    }

    if (!VALID_PRODUCTS.includes(data.product) || data['bot-field']) {
      console.log(`Skipped likely spam (product=${data.product || '(none)'})`);
      return { statusCode: 200, body: 'Skipped: likely spam' };
    }

    // Run both; one failing must not stop the other (the email matters most).
    const results = await Promise.allSettled([sendLeadEmail(data), sendGa4Lead(data)]);
    results
      .filter((r) => r.status === 'rejected')
      .forEach((r) => console.error('Lead step failed:', r.reason));
    return { statusCode: 200, body: 'Lead processed' };
  } catch (err) {
    // Log but return 200 so Netlify doesn't retry a bad payload repeatedly.
    console.error('submission-created function error:', err);
    return { statusCode: 200, body: 'Error logged; not retrying.' };
  }
};
