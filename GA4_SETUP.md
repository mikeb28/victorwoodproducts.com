# GA4 Lead Tracking — Setup Notes

Spam-proof lead conversion tracking for the quote form. Built but **not yet live** —
finish the manual steps below, then deploy.

## How it works

1. A visitor submits the quote form on `index.html` (Netlify form, name `contact`).
2. Netlify runs its spam filter (Akismet + `bot-field` honeypot).
3. **Only verified (non-spam) submissions** trigger the Netlify function
   `netlify/functions/submission-created.js`.
4. That function sends a `generate_lead` event to GA4 via the Measurement Protocol.

Because the function runs *after* Netlify's spam filter, GA4 only ever counts real
leads — the bots that fill out the form are dropped before GA4 ever hears about them.

Netlify stays the source of truth for lead *count*; GA4 tells you which traffic /
keywords produced them.

## What's already in the code

- `netlify/functions/submission-created.js` — the server-side function.
- `index.html` — two hidden fields (`ga_client_id`, `ga_session_id`) on the form,
  plus a script that fills them from gtag so leads attribute to their source.
- GA4 tag `G-KKHJB7JPMH` and Google Ads tag `AW-17635954418` were already installed.

## Manual steps remaining (do these, then deploy)

1. **Create a GA4 Measurement Protocol API secret**
   GA4 → Admin → Data Streams → (the victorwoodproducts.com web stream) →
   Measurement Protocol API secrets → **Create**. Copy the secret value.

2. **Add it to Netlify as an environment variable**
   Netlify → Site settings → Environment variables → Add:
   - Key: `GA4_API_SECRET`
   - Value: (the secret from step 1)
   (Optional: `GA4_MEASUREMENT_ID` — defaults to `G-KKHJB7JPMH` if not set.)

3. **Mark `generate_lead` as a Key event in GA4**
   GA4 → Admin → Key events → New key event → enter `generate_lead`.
   (It also appears under Events to toggle on once it has fired at least once.)

4. **(When ready) import the conversion into Google Ads**
   GA4 → Admin → Product links → Google Ads → link `AW-17635954418`, then in
   Google Ads import `generate_lead` as a conversion. This is what lets Ads
   optimize toward real leads instead of bots.

## How to verify after deploy

- Submit a real test lead on the live site.
- GA4 → Admin → DebugView, or Reports → Realtime → look for `generate_lead`.
- Compare GA4 `generate_lead` count vs Netlify's verified submissions — they
  should track closely. If GA4 drifts well above Netlify, that's bot leakage.
- Netlify → Functions → `submission-created` → check the logs for
  "generate_lead sent to GA4".

## Notes

- Netlify Functions run on Node 18+ (global `fetch` available) — no dependencies.
- The function returns HTTP 200 even on error (logs the problem) so a bad payload
  never triggers a retry storm.
