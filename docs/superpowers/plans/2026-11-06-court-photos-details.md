# Court Photos and Details Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Staff (owner and front desk) can give each court a photo and a one-line details text in the admin Edit Court window, and the landing page "Our courts" section shows them, keeping the drawn court as the fallback.

**Architecture:** Two nullable columns on `courts` (`photo_url`, `details`) and a public `court-photos` storage bucket that only staff can write. The Edit Court window uploads the file straight to storage (as Settings does for the GCash QR) and sends the public URL and details to `PATCH /api/admin/courts`, which only accepts URLs inside that bucket. The showcase renders `<img>` when a court has a photo.

**Tech Stack:** Next.js 16 / React 19, Supabase Postgres + Storage, `node --test`, Playwright on the local stack.

**Spec:** Agreed in chat on 2026-11-06 (after `2026-11-06-courts-showcase.md`). Decisions restated below.

## Global Constraints

- Who: owner and front desk staff (`is_admin()`), same as court name and status today.
- Photo: one per court; JPG, PNG or WebP; at most 5 MB (5242880 bytes); preview and a "Remove photo" button in Edit Court.
- Details: one free-text line, at most 80 characters, optional; e.g. "Covered · LED lights · Spectator bench". No tags.
- Landing page: the photo replaces the drawn court in the featured view and in the list thumbnail; no photo → the drawing stays. Details show under the court name in the featured view only.
- `PATCH /api/admin/courts` accepts a `photo_url` only if it starts with `<NEXT_PUBLIC_SUPABASE_URL>/storage/v1/object/public/court-photos/`; anything else is 400 `The photo must be uploaded here.` Details over 80 → 400 `Keep the details under 80 characters.` Omitted keys leave the column unchanged.
- Production: the migration is applied to production only after the user approves; the app code must not be pushed before production has the columns (the landing page selects them).

## Review Focus

- A non-image or a 6 MB file is refused with a clear message before anything uploads → storage bucket limits (Task 1) + modal check (Task 2), checked by hand.
- Replacing or removing a photo leaves no stray file behind → modal deletes the old object after a successful save (Task 2), checked in the e2e by counting objects.
- A crafted PATCH with an outside URL (`https://evil.example/x.png`) is refused → e2e request test in Task 2.
- Details with only spaces are saved as empty (NULL), not as "   " → API trims; covered in the e2e.
- A court without a photo keeps the drawing in both the featured view and the list → e2e after removing the photo.

---

### Task 1: Columns, bucket and the URL check

**Files:**
- Create: `supabase/migrations/pending_court_photos_details.sql` (renamed to the production version after it is applied)
- Create: `src/lib/services/courts/courtPhoto.ts`
- Test: `tests/court-photo.test.mjs`

**Interfaces:**
- Produces:
  - Columns `public.courts.photo_url text NULL`, `public.courts.details text NULL CHECK (char_length(details) <= 80)`.
  - Bucket `court-photos` (public, 5242880 bytes, `{image/jpeg,image/png,image/webp}`); storage policies: select for everyone, insert/update/delete for `public.is_admin()`.
  - `COURT_PHOTO_BUCKET = "court-photos"` and `isCourtPhotoUrl(url: string, supabaseUrl: string): boolean` — true only for `${supabaseUrl without trailing slash}/storage/v1/object/public/court-photos/<one or more non-slash chars>`.

- [ ] **Step 1: Failing unit test** `isCourtPhotoUrl accepts only this project's court-photos bucket`: base `http://127.0.0.1:54321`; true for `${base}/storage/v1/object/public/court-photos/c1-1.png` and with base given as `${base}/`; false for `https://evil.example/x.png`, `${base}/storage/v1/object/public/club-assets/qr.png`, `${base}/storage/v1/object/public/court-photos/`, `${base}/storage/v1/object/public/court-photos/../club-assets/qr.png`.
- [ ] **Step 2: Run** `npm test` — FAIL, module not found.
- [ ] **Step 3: Implement** `courtPhoto.ts`; write the migration (columns + bucket + policies, idempotent like `20261031032012_gcash_storage.sql`) and apply it to the local stack: `docker exec -i supabase_db_localdb psql -U postgres -v ON_ERROR_STOP=1 < supabase/migrations/pending_court_photos_details.sql`.
- [ ] **Step 4: Run** `npm test` — all pass; `select photo_url, details from public.courts limit 1` works locally.
- [ ] **Step 5: Commit** (local only) `feat(courts): photo and details columns, court-photos bucket`

---

### Task 2: Edit Court window, API and the landing page

**Files:**
- Modify: `src/app/api/admin/courts/route.ts` (PATCH), `src/lib/services/courts/updateCourt.service.ts`, `src/lib/services/courts/courtsTypes.ts`, `src/lib/services/courts/courtsData.service.ts:19` (select the two columns), `src/components/admin/courts/editCourtModal.tsx`, `src/components/customers/courts-showcase.tsx`, `src/app/page.tsx` (courts select)
- Test: `tests/e2e/admin-courts.spec.mjs` (new test), `tests/e2e/courts-showcase.spec.mjs` (photo assertions)

**Interfaces:**
- Consumes: `isCourtPhotoUrl`, `COURT_PHOTO_BUCKET` (Task 1).
- Produces: `Court.photo_url?: string | null`, `Court.details?: string | null`; `updateCourt(id, name, status, maintenance?, extras?: { photo_url?: string | null; details?: string })`; `ShowcaseCourt` gains `photo_url: string | null; details: string | null`.

- [ ] **Step 1: Failing e2e** in `admin-courts.spec.mjs`, `"staff add a photo and details to a court, and the landing page shows them"`: as ADMIN open Edit Court for the first court; fill "Details" with `"  Covered · LED lights  "`; set the "Court photo" file input to a tiny PNG buffer; save; expect DB `details = 'Covered · LED lights'` and `photo_url` containing `/court-photos/`; visit `/`, the `Featured court` group shows an `img` whose `src` contains `/court-photos/` and the text `Covered · LED lights`; back in Edit Court click "Remove photo", save; DB `photo_url` is NULL, the `court-photos` bucket holds 0 objects for this court, and `/` shows no `img` in the featured group. Plus `"the courts API refuses a photo from outside the bucket"`: PATCH with `photo_url: "https://evil.example/x.png"` → 400 `The photo must be uploaded here.`; details of 81 chars → 400 `Keep the details under 80 characters.`
- [ ] **Step 2: Run** `scripts/e2e-test.sh tests/e2e/admin-courts.spec.mjs` — FAIL, no "Details" field.
- [ ] **Step 3: Implement.** API: read optional `details` (trim; empty → null; > 80 → 400) and `photo_url` (null or `isCourtPhotoUrl` → else 400); add only the keys present in the body to the update. Modal: "Court photo" file input (accept `image/jpeg,image/png,image/webp`; refuse > 5 MB or other types in the browser with an inline message), preview of the pending or saved photo, "Remove photo" button, "Details" input `maxLength={80}`; on save upload a pending file to `court-photos/<courtId>-<Date.now()>.<ext>`, PATCH, then best-effort remove the replaced object. Showcase and page: select and pass `photo_url, details`; `<img>` (`object-cover`, featured `alt={`${name} court`}`, thumbnail `alt=""`) when present, else the drawing; details line under the featured name.
- [ ] **Step 4: Run** `npx tsc --noEmit -p . && npm test && scripts/e2e-test.sh tests/e2e/admin-courts.spec.mjs tests/e2e/courts-showcase.spec.mjs` — all pass.
- [ ] **Step 5: Check by hand** the modal and the landing page at 1280px and 390px with a real-looking photo.
- [ ] **Step 6: Commit** (local only) `feat(courts): staff set a photo and details for each court`

### Then

Ask the user before applying the migration to production; after it is applied, rename the migration file to the version production recorded, commit, and push.
