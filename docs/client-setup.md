# New client setup

One client = one Supabase project + one Vercel project, both built from this same repo.
You change no code except the venue-specific text in step 5.

## 1. Accounts (in the client's name where possible)

| Service | What to create |
|---|---|
| Supabase | A new project: the client's own database |
| Vercel | A new project from this GitHub repo |
| Domain | Their domain or subdomain (e.g. `book.their-venue.ph`) pointed at Vercel |
| Resend | Their sending domain, verified (emails come from `bookings@their-domain`) |
| Sentry | A new project in your own Sentry account, so you watch every client in one place |
| Stripe | Their business account, so payments go to them |

## 2. Database (Supabase)

1. Do **not** run every migration from the start: the base tables predate the migration files, so the oldest
   migrations fail on an empty project.
   - First run `supabase/schema.sql` (a snapshot of the whole database). In the SQL editor, delete its two `psql`-only
     lines first: `\restrict schemasnapshot` near the top and `\unrestrict schemasnapshot` near the end.
   - Its header names the last migration it includes. Then run only the files in `supabase/migrations/` newer than
     that one, in filename order (`ls supabase/migrations | awk '$0 > "<that file name>"'` lists them).
   - Simpler: refresh the snapshot first with `scripts/dump-schema.sh` (needs the local Supabase stack in Docker),
     so it covers every migration and step 1 is just `schema.sql`.
2. Cron: re-run the `cron.schedule` calls in `*_supabase_cron_cleanup.sql` and `*_profile_on_confirm.sql`.
   Set the Vault secrets they read first (the cron URL on their domain and `CRON_SECRET`).
3. Auth → URL Configuration: Site URL and Redirect URLs on their domain.
4. Auth → SMTP: their sender, so sign-up and reset emails come from them. Paste the templates from `supabase/templates/`.
5. Auth → Sign In / Providers: decide "Confirm email" on or off. Off means sign-ups aren't email-verified.
6. Auth → Passwords: turn on leaked-password protection.

## 3. Hosting settings (Vercel → Settings → Environment Variables, Production)

Every setting is listed in `.env.example`. Per client:

- Supabase: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`
- Stripe: `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`
- Venue: `NEXT_PUBLIC_VENUE_NAME`, `NEXT_PUBLIC_VENUE_CITY`, `NEXT_PUBLIC_SITE_URL`
- Emails: `RESEND_API_KEY`, `EMAIL_FROM` (e.g. `Their Venue <bookings@their-domain.ph>`)
- Sentry: `SENTRY_DSN` and `NEXT_PUBLIC_SENTRY_DSN` (same value), `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT`

`NEXT_PUBLIC_*` values are built into the site: **redeploy after changing any setting.**

Stripe webhook: `https://their-domain/api/stripe/webhook` with events `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
`refund.updated`, `refund.failed`, `charge.refund.updated`.

## 4. Venue setup in the app

1. Owner account: they sign up on the site, then in Supabase SQL:
   `update public.profiles set role = 'admin', is_owner = true where email = 'owner@their-email';`
2. Settings: contact phone, email and address; GCash name, number and QR; booking policies.
3. Pricing: base hourly rate, minimum hours, peak windows (a window can also be cheaper than base, for off-peak deals).
4. Schedules: operating hours, closed dates.
5. Courts: names, photos, details.
6. Open Play: weekly schedules, if they run open play.
7. Staff: front-desk accounts sign up, then the owner gives them access in Settings.

## 5. Code to edit (venue-specific text)

- `src/components/customers/faq-section.tsx`: FAQ answers (facility, lights, shoe rules)
- `src/app/(customer)/terms/page.tsx` and `src/app/(customer)/privacy/page.tsx`: their rules and business details
- Optional: colours in `src/app/globals.css` and the logo icon

These edits are per client, so a client with custom text needs its own copy of the site (a branch or fork). Make
this text editable in Settings if that becomes a burden.

## 6. Before handing over

- One real test booking: pay, then check the confirmation email arrives.
- One test error, then check it appears in Sentry.
- Agree licence, ownership and backups (their Supabase plan) with the client.

Not yet rehearsed end to end: building a brand-new Supabase project from `schema.sql` plus the newer migrations.
Do one dry run before the first sale.
