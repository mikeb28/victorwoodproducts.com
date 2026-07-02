// Netlify event-triggered function.
//
// The name `submission-created` is special: Netlify runs this automatically
// whenever a form submission is VERIFIED — i.e. it has already PASSED Netlify's
// spam filter. Spam submissions never trigger it, so GA4 only ever sees real
// leads. This is what makes our conversion count spam-proof.
//
// It forwards the lead to GA4 using the Measurement Protocol (server-to-server),
// firing a `generate_lead` event that you can mark as a Key event / import into
// Google Ads as a conversion.
//
// Requires one environment variable set in Netlify (Site settings → Environment
// variables): GA4_API_SECRET  (created in GA4: Admin → Data Streams → your stream
// → Measurement Protocol API secrets → Create). See GA4_SETUP.md.

const GA4_MEASUREMENT_ID = process.env.GA4_MEASUREMENT_ID || 'G-KKHJB7JPMH';
const GA4_API_SECRET = process.env.GA4_API_SECRET;

exports.handler = async (event) => {
  try {
    if (!GA4_API_SECRET) {
      // Don't hard-fail the build/deploy or retry-storm — just log and move on.
      console.error('GA4_API_SECRET is not set — skipping GA4 event.');
      return { statusCode: 200, body: 'Skipped: GA4_API_SECRET not configured' };
    }

    const body = JSON.parse(event.body || '{}');
    const submission = body.payload || {};
    const data = submission.data || {};

    // Only act on the quote/contact form (ignore any other Netlify form).
    const formName = submission.form_name || data['form-name'];
    if (formName && formName !== 'contact') {
      return { statusCode: 200, body: `Ignored form: ${formName}` };
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
      const detail = await res.text();
      console.error('GA4 Measurement Protocol error', res.status, detail);
      return { statusCode: 200, body: `GA4 responded ${res.status}` };
    }

    console.log(`generate_lead sent to GA4 (client_id=${clientId}, product=${params.product_interest})`);
    return { statusCode: 200, body: 'generate_lead sent to GA4' };
  } catch (err) {
    // Log but return 200 so Netlify doesn't retry a bad payload repeatedly.
    console.error('submission-created function error:', err);
    return { statusCode: 200, body: 'Error logged; not retrying.' };
  }
};
