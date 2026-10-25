# Disposable Supabase Staging Verification Plan (Hardened)

**Target Migration:** `supabase/migrations/20261024_hold_court_booking_rpc.sql`  
**Target System:** Disposable Staging Project (Never Production)  
**Status:** Verification Plan (Paused — Awaiting Approval Before Live Execution)

---

## 1. Safety Framework & Execution Gates

| Phase | Operation Type | Safety Classification | Execution Requirement |
| :--- | :--- | :--- | :--- |
| **Phase 0** | Inspection & Preflight Overload Inventory | **Read-Only** | Safe to run without mutating database state. |
| **Phase 1** | Fixture Provisioning & Date Discovery | **Mutates Staging State** | **Requires human approval** before execution. |
| **Phase 2** | Migration Compatibility Gate & Schema Apply | **Mutates Schema** | **Requires human approval & Tech Lead sign-off** before execution. |
| **Phase 3** | PL/pgSQL Business-Rule & Rollback Assertions | **Mutates Staging Data** | **Requires human approval** before execution. |
| **Phase 4** | HTTP PostgREST Authorization Matrix | **Mutates Staging Data** | **Requires human approval** before execution. |
| **Phase 5** | Persistent Concurrency Testing (Branch A & B) | **Mutates Concurrency Slots** | **Requires human approval & 2 persistent sessions** before execution. |
| **Phase 6** | Strictly ID-Based Transactional Cleanup | **Removes Test Data** | **Requires human approval** before execution. |

---

## Phase 0: Read-Only Preflight & Fail-Closed Project Verification
*(Read-Only — Does not alter database state)*

### Step 0A: Fail-Closed Shell Environment & Target Project Verification
Validates the complete standard Supabase project URL format, asserts the parsed reference against a separately configured human-approved staging reference, rejects localhost/custom domains/malformed URLs, and requires the operator to verify the project identity in the Supabase Dashboard before executing any mutating work:

```bash
#!/usr/bin/env bash
set -euo pipefail

# 1. Ensure command tracing is disabled to protect credentials
set +x

# 2. Fail closed if any required environment variable is missing or empty
if [ -z "${SUPABASE_URL:-}" ]; then
  echo "FATAL: SUPABASE_URL is unset. Failing closed without side effects." >&2
  exit 1
fi

if [ -z "${EXPECTED_STAGING_PROJECT_REF:-}" ]; then
  echo "FATAL: EXPECTED_STAGING_PROJECT_REF is unset. It must be explicitly configured and never derived from the target URL." >&2
  exit 1
fi

if [ -z "${PRODUCTION_PROJECT_REF:-}" ]; then
  echo "FATAL: PRODUCTION_PROJECT_REF is unset. It must be explicitly configured as a negative safety boundary." >&2
  exit 1
fi

# 3. Validate complete standard Supabase project URL format: https://<20-char-ref>.supabase.co
# Rejects localhost, custom domains, unencrypted HTTP, and malformed URLs.
if [[ ! "$SUPABASE_URL" =~ ^https://([a-z0-9]{20})\.supabase\.co/?$ ]]; then
  echo "FATAL: SUPABASE_URL '$SUPABASE_URL' does not match the standard Supabase project URL format (https://<20-char-ref>.supabase.co)." >&2
  echo "       Localhost, custom domains, unencrypted HTTP, and malformed URLs are strictly rejected." >&2
  exit 1
fi

ACTUAL_PROJECT_REF="${BASH_REMATCH[1]}"

# 4. Strict identity verification against allowlist and blocklist
if [ "$ACTUAL_PROJECT_REF" = "$PRODUCTION_PROJECT_REF" ]; then
  echo "FATAL: Target reference '$ACTUAL_PROJECT_REF' matches PRODUCTION_PROJECT_REF ($PRODUCTION_PROJECT_REF)! Halting immediately." >&2
  exit 1
fi

if [ "$ACTUAL_PROJECT_REF" != "$EXPECTED_STAGING_PROJECT_REF" ]; then
  echo "FATAL: Target reference '$ACTUAL_PROJECT_REF' does not match human-approved EXPECTED_STAGING_PROJECT_REF '$EXPECTED_STAGING_PROJECT_REF'." >&2
  exit 1
fi

# 5. Interactive Operator Dashboard Verification Gate
# Required prior to any migration, fixture creation, test execution, or cleanup
echo "================================================================================"
echo "OPERATOR DASHBOARD VERIFICATION REQUIRED BEFORE ANY MUTATING WORK"
echo "Target Project Reference: $ACTUAL_PROJECT_REF"
echo "Supabase Dashboard URL:   https://supabase.com/dashboard/project/$ACTUAL_PROJECT_REF"
echo "Instructions:"
echo "  1. Open the dashboard URL above in an authenticated browser session."
echo "  2. Confirm the project name clearly indicates staging/disposable (e.g. 'crosshair-dinkers-staging')."
echo "  3. Confirm the Organization is NOT the production organization."
echo "  4. In Project Settings > General, confirm 'Reference ID' matches '$ACTUAL_PROJECT_REF'."
echo "================================================================================"

read -r -p "Type 'CONFIRM_DISPOSABLE_STAGING' to confirm the target project identity: " CONFIRMATION
if [ "$CONFIRMATION" != "CONFIRM_DISPOSABLE_STAGING" ]; then
  echo "FATAL: Operator confirmation failed ('$CONFIRMATION' != 'CONFIRM_DISPOSABLE_STAGING'). Aborting without side effects." >&2
  exit 1
fi

echo "VERIFICATION PASSED: Confirmed connection to approved disposable staging reference: $ACTUAL_PROJECT_REF"
```

In the SQL Editor, verify runtime database connection properties:
```sql
SELECT 
    current_database() AS db_name,
    current_user AS connected_user,
    inet_server_addr() AS server_ip,
    pg_is_in_recovery() AS is_replica;
```

---

### Step 0B: Required Table & Extension Check
```sql
SELECT 
    c.relname AS table_name,
    pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
FROM pg_catalog.pg_class c
JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relname IN ('courts', 'bookings', 'payments', 'profiles', 'operating_hours', 'customers')
ORDER BY c.relname;

SELECT extname, extversion FROM pg_catalog.pg_extension WHERE extname IN ('pgcrypto', 'uuid-ossp');
```
*Pass criterion: All 6 tables and a UUID extension exist.*

---

### Step 0C: Foreign Key, Trigger, & Auth Trigger Inventory
```sql
-- 1. Inward foreign keys referencing bookings or payments
SELECT 
    conrelid::regclass AS child_table,
    conname AS constraint_name,
    confrelid::regclass AS parent_table,
    pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE confrelid IN ('public.bookings'::regclass, 'public.payments'::regclass);

-- 2. Outward foreign keys from bookings
SELECT 
    conname AS constraint_name,
    confrelid::regclass AS parent_table,
    pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid = 'public.bookings'::regclass 
  AND confrelid IN ('public.customers'::regclass, 'public.profiles'::regclass, 'auth.users'::regclass);

-- 3. Check for automatic profile-creation triggers on auth.users
SELECT 
    tgname AS trigger_name,
    proname AS trigger_procedure
FROM pg_catalog.pg_trigger tr
JOIN pg_catalog.pg_proc p ON p.oid = tr.tgfoid
WHERE tgrelid = 'auth.users'::regclass AND NOT tgisinternal;
```

---

### Step 0D: Preflight RPC Overload & Dependency Inventory
Inspects all deployed overloads of the target functions and any dependent database objects prior to applying the migration:

```sql
-- 1. Inventory all deployed overloads
SELECT 
    p.proname AS function_name,
    p.oid AS function_oid,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS exact_signature,
    pg_catalog.pg_get_function_result(p.oid) AS result_type,
    pg_catalog.pg_get_userbyid(p.proowner) AS function_owner,
    p.prosecdef AS is_security_definer
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('hold_court_booking', 'create_walk_in_booking')
ORDER BY p.proname, p.oid;

-- 2. Inspect dependent database objects that rely on the functions to be dropped
SELECT 
    d.classid::regclass AS dependent_class,
    d.objid::regclass AS dependent_object,
    d.deptype AS dependency_type,
    p.proname AS target_function,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS target_signature
FROM pg_catalog.pg_depend d
JOIN pg_catalog.pg_proc p ON p.oid = d.refobjid
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('hold_court_booking', 'create_walk_in_booking')
  AND d.deptype = 'n'; -- normal dependency
```

*Evidence-Based Stop Rules (Catalog Results are Evidence, Not Assumptions):*
1. **Catalog Results are Evidence:** The operator must treat catalog output as empirical evidence requiring verification, not as an assumption.
2. **Reconciling Deployed Overloads with Migration Drops:**
   - **`hold_court_booking`:** This is a newly introduced RPC (6 parameters: `uuid, date, time, time, uuid, numeric`). In a fresh staging database, Query 1 is expected to return 0 rows for `hold_court_booking`. If Query 1 returns a 6-parameter signature, the migration's `DROP FUNCTION IF EXISTS public.hold_court_booking(uuid, date, time, time, uuid, numeric);` safely replaces it. If Query 1 returns ANY legacy or unexpected overload (such as a 5-parameter prototype `uuid, date, time, uuid, numeric`), **STOP IMMEDIATELY**. Review Query 2 (`pg_depend`) to confirm no objects depend on it; do not assume the migration will drop unlisted overloads. With tech lead approval and verified zero dependencies, add an explicit targeted drop statement to prevent PostgREST `PGRST203` candidate ambiguity before applying the migration.
   - **`create_walk_in_booking`:** The migration explicitly drops historical 8-parameter (`uuid, uuid, text, date, time, time, numeric, text`) and 7-parameter (`uuid, uuid, text, date, time, time, numeric`) signatures, as well as the 9-parameter replacement signature for idempotence. If Query 1 returns an unknown or unhandled overload, **STOP IMMEDIATELY**.
3. **Dependent Objects Found:** If query 2 returns any dependent views, triggers, foreign keys, or functions (`d.deptype = 'n'`), **STOP IMMEDIATELY**. Dropping the functions would fail or cause cascading schema breakage.
4. **Repository Search Limitation:** Repository search confirms that Crosshair Dinkers frontend and backend callers use the new 6-param and 9-param signatures, but **repository inspection cannot establish the absence of external consumers** (such as external cron jobs, mobile applications, partner integrations, or webhooks).
5. **Mandatory Approval:** Applying the migration requires human sign-off confirming that no external consumers depend on the old signatures.

---

### Step 0E: Baseline Telemetry & Orphan Payment Isolation
```sql
SELECT 
    (SELECT count(*) FROM public.courts) AS base_courts,
    (SELECT count(*) FROM public.bookings) AS base_bookings,
    (SELECT count(*) FROM public.payments) AS base_payments,
    (SELECT count(*) FROM public.profiles) AS base_profiles,
    (SELECT count(*) FROM public.customers) AS base_customers;

-- Record pre-existing orphan payments (must match post-cleanup count)
SELECT id AS pre_existing_orphan_payment_id, booking_id, amount, status
FROM public.payments
WHERE booking_id NOT IN (SELECT id FROM public.bookings);
```

---

## Phase 1: Fixture Provisioning & Concrete Date Discovery
*(Mutates Staging State — Requires Human Approval)*

### Phase 1 Execution Gate & Prerequisite Verification
Before executing fixture provisioning, the operator must verify:
- [ ] Step 0A completed successfully with human dashboard confirmation of `EXPECTED_STAGING_PROJECT_REF`.
- [ ] Active project reference is verified to NOT match `PRODUCTION_PROJECT_REF`.
- [ ] Step 0B verified that all 6 required tables (`courts`, `bookings`, `payments`, `profiles`, `operating_hours`, `customers`) and UUID extension exist.
- [ ] Step 0E baseline telemetry counts recorded.
- [ ] Any uncertainty or discrepancy is a MANDATORY HARD STOP without side effects.

### Step 1A: Dedicated Auth Users via Supabase Admin API
Create disposable test users and capture their dynamically generated UUIDs:

```bash
# 1. Staging Admin
ADMIN_JSON=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-admin@test.local","password":"StagingAdminPass123!","email_confirm":true}')
export TEST_ADMIN_ID=$(echo "$ADMIN_JSON" | jq -r .id)

# 2. Staging Customer 1
CUST1_JSON=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-player1@test.local","password":"StagingPlayer1Pass123!","email_confirm":true}')
export TEST_CUSTOMER_1_ID=$(echo "$CUST1_JSON" | jq -r .id)

# 3. Staging Customer 2
CUST2_JSON=$(curl -s -X POST "$SUPABASE_URL/auth/v1/admin/users" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-player2@test.local","password":"StagingPlayer2Pass123!","email_confirm":true}')
export TEST_CUSTOMER_2_ID=$(echo "$CUST2_JSON" | jq -r .id)

# Verify token acquisition immediately
TEST_TOKEN=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-player1@test.local","password":"StagingPlayer1Pass123!"}' | jq -r .access_token)

if [ -z "$TEST_TOKEN" ] || [ "$TEST_TOKEN" = "null" ]; then
  echo "FATAL: Token acquisition failed for test users. Check Supabase Auth configuration." >&2
  exit 1
fi
```

---

### Step 1B: Collision-Safe Manifest Setup & Safe Fixture Seeding
Handles pre-existing manifest tables, dynamic run IDs, and `auth.users` profile triggers safely:

```sql
-- Check if manifest pre-existed before this run
CREATE TABLE IF NOT EXISTS public.staging_test_manifest (
  run_id uuid NOT NULL,
  entity_type text NOT NULL,
  record_id uuid NOT NULL,
  created_at timestamptz DEFAULT pg_catalog.now(),
  PRIMARY KEY (run_id, entity_type, record_id)
);

DO $$
DECLARE
  v_run_id uuid := pg_catalog.gen_random_uuid(); -- Fresh unique run ID
  v_admin_id uuid := 'YOUR_TEST_ADMIN_ID'::uuid;
  v_cust1_id uuid := 'YOUR_TEST_CUSTOMER_1_ID'::uuid;
  v_cust2_id uuid := 'YOUR_TEST_CUSTOMER_2_ID'::uuid;
  v_court_id uuid := 'c0000000-0000-0000-0000-000000000091'::uuid;
  v_guest_id uuid := 'c0000000-0000-0000-0000-000000000004'::uuid;
BEGIN
  -- 1. Verify Auth users exist
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_admin_id) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_cust1_id) OR
     NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_cust2_id) THEN
    RAISE EXCEPTION 'ABORT: Required Auth users missing from auth.users.';
  END IF;

  -- 2. Handle Profiles safely (accommodates automatic Auth triggers)
  -- For Admin: if trigger inserted profile, update role to admin; if missing, insert
  IF EXISTS (SELECT 1 FROM public.profiles WHERE id = v_admin_id) THEN
    UPDATE public.profiles SET role = 'admin' WHERE id = v_admin_id;
  ELSE
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (v_admin_id, 'Staging Admin', 'staging-admin@test.local', 'admin');
  END IF;

  -- For Customer 1:
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_cust1_id) THEN
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (v_cust1_id, 'Staging Player One', 'staging-player1@test.local', 'customer');
  END IF;

  -- For Customer 2:
  IF NOT EXISTS (SELECT 1 FROM public.profiles WHERE id = v_cust2_id) THEN
    INSERT INTO public.profiles (id, full_name, email, role)
    VALUES (v_cust2_id, 'Staging Player Two', 'staging-player2@test.local', 'customer');
  END IF;

  -- 3. Dedicated Test Court (fail-safe abort if already exists)
  IF EXISTS (SELECT 1 FROM public.courts WHERE id = v_court_id) THEN
    RAISE EXCEPTION 'ABORT: Court % already exists. Choose a distinct UUID.', v_court_id;
  END IF;

  INSERT INTO public.courts (id, name, court_number, surface_type, is_indoor, hourly_rate, status)
  VALUES (v_court_id, 'Staging Dedicated Test Court 91', 91, 'pro_cushion', true, 200.00, 'active');

  -- 4. Guest Customer Fixture (fail-safe abort if already exists)
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_guest_id) THEN
    RAISE EXCEPTION 'ABORT: Reserved guest customer ID % already exists.', v_guest_id;
  END IF;

  INSERT INTO public.customers (id, full_name, phone, email)
  VALUES (v_guest_id, 'Staging Walk-in Guest', '09170000000', 'guest@test.local');

  -- 5. Register fixtures in manifest under run_id
  INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
  VALUES 
    (v_run_id, 'court', v_court_id),
    (v_run_id, 'profile', v_admin_id),
    (v_run_id, 'profile', v_cust1_id),
    (v_run_id, 'profile', v_cust2_id),
    (v_run_id, 'customer', v_guest_id);

  RAISE NOTICE 'SUCCESS: Run ID % initialized with test fixtures.', v_run_id;
END $$;
```

---

### Step 1C: Concrete `TEST_DATE` Discovery & Slot Check
Uses standard PostgreSQL `date_part` syntax:

```sql
WITH candidate_dates AS (
  SELECT 
    d::date AS cand_date,
    CASE pg_catalog.date_part('dow', d)::integer
      WHEN 0 THEN 'Sunday'
      WHEN 1 THEN 'Monday'
      WHEN 2 THEN 'Tuesday'
      WHEN 3 THEN 'Wednesday'
      WHEN 4 THEN 'Thursday'
      WHEN 5 THEN 'Friday'
      WHEN 6 THEN 'Saturday'
    END AS day_name
  FROM pg_catalog.generate_series(
    (pg_catalog.timezone('Asia/Manila', pg_catalog.now())::date + 1),
    (pg_catalog.timezone('Asia/Manila', pg_catalog.now())::date + 14),
    interval '1 day'
  ) AS d
)
SELECT 
  c.cand_date AS selected_test_date,
  c.day_name,
  oh.open_time,
  oh.close_time
FROM candidate_dates c
JOIN public.operating_hours oh ON oh.day_of_week = c.day_name
WHERE oh.is_open = true
  AND oh.open_time <= '08:00:00'::time
  AND oh.close_time >= '22:00:00'::time
  AND NOT EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.court_id = 'c0000000-0000-0000-0000-000000000091'::uuid
      AND b.booking_date = c.cand_date
      AND b.status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
  )
ORDER BY c.cand_date ASC
LIMIT 1;
```
*Action:* Record `selected_test_date` and export `export TEST_DATE="YYYY-MM-DD"`.

Verify that all target test slots on Court 91 are unreserved:
```sql
DO $$
DECLARE
  v_test_date date := '2026-10-26'::date; -- Match selected TEST_DATE
  v_court_id uuid := 'c0000000-0000-0000-0000-000000000091'::uuid;
  v_conflicts integer;
BEGIN
  SELECT count(*) INTO v_conflicts
  FROM public.bookings
  WHERE court_id = v_court_id
    AND booking_date = v_test_date
    AND status IN ('confirmed', 'checked_in', 'in_progress', 'completed', 'pending')
    AND (
      (start_time < '10:00:00'::time AND end_time > '08:00:00'::time) OR
      (start_time < '12:00:00'::time AND end_time > '10:00:00'::time) OR
      (start_time < '14:00:00'::time AND end_time > '12:00:00'::time) OR
      (start_time < '16:00:00'::time AND end_time > '14:00:00'::time) OR
      (start_time < '18:00:00'::time AND end_time > '16:00:00'::time) OR
      (start_time < '20:00:00'::time AND end_time > '18:00:00'::time) OR
      (start_time < '22:00:00'::time AND end_time > '20:00:00'::time)
    );

  IF v_conflicts > 0 THEN
    RAISE EXCEPTION 'ABORT: % conflicting bookings on test court.', v_conflicts;
  END IF;
  RAISE NOTICE 'SUCCESS: All test slots vacant on Court 91.';
END $$;
```

---

## Phase 2: Migration Compatibility Gate & Schema Migration
*(Mutates Schema — Requires Human & Tech Lead Approval)*

### Step 2A: Migration Compatibility Sign-Off Gate
Before applying `supabase/migrations/20261024_hold_court_booking_rpc.sql`, an operator and tech lead must complete this gate:
1. **Preflight Inventory & Dependency Review:** Review the empirical results of Step 0D. Confirm that Query 1 returns no unexpected overloads, and that Query 2 returned zero dependent database objects (`deptype = 'n'`). If any unexpected overload or dependent object was found, **STOP IMMEDIATELY**.
2. **Dropped Signature Confirmation:** Confirm that applying the migration will drop:
   - `public.hold_court_booking(uuid, date, time, time, uuid, numeric)` (6 params, ensures clean re-application)
   - `public.create_walk_in_booking(uuid, text, date, time, time, numeric, uuid, uuid, text)` (9 params, replacement signature)
   - `public.create_walk_in_booking(uuid, uuid, text, date, time, time, numeric, text)` (8 params, historical walk-in signature)
   - `public.create_walk_in_booking(uuid, uuid, text, date, time, time, numeric)` (7 params, historical walk-in signature)
   Confirm that no unexpected historical 5-parameter `hold_court_booking` exists on the target database (if found in Step 0D, it must be evaluated for dependencies and dropped explicitly with tech lead approval).
3. **Application Call Sites Verification:**
   - Confirm that `src/app/api/stripe/checkout/route.ts` calls `hold_court_booking` with 6 parameters (`p_court_id`, `p_booking_date`, `p_start_time`, `p_end_time`, `p_user_id`, `p_amount`).
   - Confirm that `src/lib/services/bookings/createWalkInBooking.service.ts` calls `create_walk_in_booking` with 9 parameters (`p_court_id`, `p_customer_name`, `p_booking_date`, `p_start_time`, `p_end_time`, `p_amount`, `p_customer_id`, `p_user_id`, `p_payment_method`).
   - Confirm that the obsolete 8-parameter fallback block has been removed from `createWalkInBooking.service.ts`.
4. **External Consumer Risk Acceptance:**
   - **Critical Warning:** Repository code searches (`grep`) prove internal codebase compliance, but **cannot rule out external consumers** (e.g. mobile applications, third-party integrations, external webhooks, or unmerged branches).
   - If any external client invokes dropped signatures after migration, it will immediately fail with `404 Not Found (PGRST202)` or `SQLSTATE 42883`.
   - The operator and tech lead must explicitly confirm that this staging environment has no external consumers before proceeding.

```bash
# Operator Gate Confirmation
read -r -p "Confirm overload inventory reviewed and no external consumers depend on dropped signatures? (Type 'CONFIRM_MIGRATION_COMPATIBILITY'): " MIG_CONFIRM
if [ "$MIG_CONFIRM" != "CONFIRM_MIGRATION_COMPATIBILITY" ]; then
  echo "FATAL: Migration compatibility confirmation failed. Aborting schema change." >&2
  exit 1
fi
```

### Step 2B: Apply Schema Migration
Apply `supabase/migrations/20261024_hold_court_booking_rpc.sql` via Supabase CLI or SQL Editor.

### Step 2C: Post-Migration Catalog Privilege & Signature Verification
Verify that only the new multi-hour signatures exist and have correct permissions:

```sql
SELECT 
    p.proname,
    pg_catalog.pg_get_function_identity_arguments(p.oid) AS exact_signature,
    p.prosecdef AS is_security_definer,
    p.proconfig AS runtime_config,
    (EXISTS (
        SELECT 1 
        FROM pg_catalog.unnest(p.proacl) AS a(item) 
        WHERE item::text LIKE '=%' AND item::text LIKE '%X%'
    )) AS public_has_execute,
    has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_has_execute,
    has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_has_execute,
    has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_role_has_execute
FROM pg_catalog.pg_proc p
JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND (
    (p.proname = 'hold_court_booking' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, date, time without time zone, time without time zone, uuid, numeric')
    OR
    (p.proname = 'create_walk_in_booking' AND pg_catalog.pg_get_function_identity_arguments(p.oid) = 'uuid, text, date, time without time zone, time without time zone, numeric, uuid, uuid, text')
  );
```
*Expected Result:*
- `public_has_execute = false`
- `anon_has_execute = false`
- `authenticated_has_execute = true`
- `service_role_has_execute = true`
- `runtime_config = {search_path=""}`

---

## Phase 3: Comprehensive SQL Business-Rule & Rollback Tests
*(Mutates Staging Data & Verifies Rollback — Requires Human Approval)*

### Phase 3 Execution Gate & Prerequisite Verification
Before executing SQL business-rule tests, the operator must verify:
- [ ] Active connected database verified via Step 0A runtime check (`current_database()`, `connected_user`).
- [ ] Phase 1 fixtures (`v_run_id`, dedicated test court 91, guest customer, test profiles) are populated in `public.staging_test_manifest`.
- [ ] Phase 2 schema migration applied and catalog permissions verified in Step 2C.
- [ ] `v_test_date` set to the exact `TEST_DATE` discovered in Step 1C.
- [ ] Any discrepancy is a MANDATORY HARD STOP.

Run in SQL Editor:

```sql
DO $$
DECLARE
  v_run_id uuid := 'YOUR_RUN_ID'::uuid;
  v_test_date date := '2026-10-26'::date; -- Match selected TEST_DATE from Step 1C
  v_court_id uuid := 'c0000000-0000-0000-0000-000000000091'::uuid;
  v_cust1_id uuid := 'YOUR_TEST_CUSTOMER_1_ID'::uuid;
  v_guest_id uuid := 'c0000000-0000-0000-0000-000000000004'::uuid;
  
  v_res jsonb;
  v_booking_id uuid;
  v_payment_id uuid;
  v_walkin_payment_id uuid;
  v_passed boolean;
  v_err_msg text;
BEGIN
  -- 3.1: Explicit ID-Based Rollback Assertion
  BEGIN
    v_res := public.hold_court_booking(v_court_id, v_test_date, '08:00:00'::time, '10:00:00'::time, v_cust1_id, 400.00);
    v_booking_id := (v_res->>'booking_id')::uuid;
    v_payment_id := (v_res->>'payment_id')::uuid;
    RAISE EXCEPTION 'FORCED_ROLLBACK_TEST' USING ERRCODE = 'P0001';
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg != 'FORCED_ROLLBACK_TEST' THEN RAISE; END IF;
  END;

  -- Verify exact IDs were not committed
  IF EXISTS (SELECT 1 FROM public.bookings WHERE id = v_booking_id) OR
     EXISTS (SELECT 1 FROM public.payments WHERE id = v_payment_id) THEN
    RAISE EXCEPTION 'ASSERTION FAILED: Subtransaction rollback leaked rows into database.';
  END IF;
  RAISE NOTICE 'PASSED 3.1: Rollback verified by exact ID inspection (0 rows leaked).';

  -- 3.2: Non-Hour Increment -> SQLSTATE 22000, INVALID_TIME_INCREMENT
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '08:30:00'::time, '09:30:00'::time, v_cust1_id, 200.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'INVALID_TIME_INCREMENT%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.2: Non-hour increment was accepted.'; END IF;

  -- 3.3: Inverted Time Range -> SQLSTATE 22000, INVALID_TIME_RANGE
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '10:00:00'::time, '08:00:00'::time, v_cust1_id, 400.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'INVALID_TIME_RANGE%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.3: Inverted time range was accepted.'; END IF;

  -- 3.4: Excessive Duration (4 hours) -> SQLSTATE 22000, INVALID_DURATION
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '08:00:00'::time, '12:00:00'::time, v_cust1_id, 800.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'INVALID_DURATION%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.4: 4-hour duration was accepted.'; END IF;

  -- 3.5: Past Date/Time -> SQLSTATE 22000, PAST_SLOT
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, (v_test_date - 7), '08:00:00'::time, '10:00:00'::time, v_cust1_id, 400.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'PAST_SLOT%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.5: Past date was accepted.'; END IF;

  -- 3.6: Out of Operating Hours -> SQLSTATE 22000, OUTSIDE_OPERATING_HOURS
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '05:00:00'::time, '07:00:00'::time, v_cust1_id, 400.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'OUTSIDE_OPERATING_HOURS%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.6: Out-of-hours slot was accepted.'; END IF;

  -- 3.7: Price Tampering (All preceding validation passes) -> SQLSTATE 22000, INVALID_AMOUNT
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '08:00:00'::time, '10:00:00'::time, v_cust1_id, 200.00);
  EXCEPTION WHEN SQLSTATE '22000' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg LIKE 'INVALID_AMOUNT%' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.7: Price tampering was accepted.'; END IF;

  -- 3.8: Valid Multi-Hour Hold (08:00 - 10:00) -> 400 PHP
  v_res := public.hold_court_booking(v_court_id, v_test_date, '08:00:00'::time, '10:00:00'::time, v_cust1_id, 400.00);
  v_booking_id := (v_res->>'booking_id')::uuid;
  v_payment_id := (v_res->>'payment_id')::uuid;

  INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
  VALUES (v_run_id, 'booking', v_booking_id), (v_run_id, 'payment', v_payment_id);
  RAISE NOTICE 'PASSED 3.8: Valid hold created (Booking %, Payment %)', v_booking_id, v_payment_id;

  -- 3.9: Overlap Rejection -> Asserts SQLSTATE P0001 AND message 'SLOT_UNAVAILABLE'
  v_passed := false;
  BEGIN
    PERFORM public.hold_court_booking(v_court_id, v_test_date, '09:00:00'::time, '11:00:00'::time, v_cust1_id, 400.00);
  EXCEPTION WHEN SQLSTATE 'P0001' THEN
    GET STACKED DIAGNOSTICS v_err_msg = MESSAGE_TEXT;
    IF v_err_msg = 'SLOT_UNAVAILABLE' THEN v_passed := true; END IF;
  END;
  IF NOT v_passed THEN RAISE EXCEPTION 'FAILED 3.9: Overlap was accepted or threw wrong error message.'; END IF;

  -- 3.10: Valid Walk-in Reservation (10:00 - 12:00)
  v_res := public.create_walk_in_booking(
    v_court_id,
    'Staging Walk-in Guest',
    v_test_date,
    '10:00:00'::time,
    '12:00:00'::time,
    400.00,
    v_guest_id,
    NULL,
    'cash'
  );
  v_booking_id := (v_res->>'booking_id')::uuid;

  SELECT id INTO v_walkin_payment_id FROM public.payments WHERE booking_id = v_booking_id;
  IF v_walkin_payment_id IS NULL THEN
    RAISE EXCEPTION 'FAILED 3.10: Walk-in payment record missing.';
  END IF;

  INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
  VALUES (v_run_id, 'booking', v_booking_id), (v_run_id, 'payment', v_walkin_payment_id);
  RAISE NOTICE 'PASSED 3.10: Walk-in reservation created (Booking %, Payment %).', v_booking_id, v_walkin_payment_id;
END $$;
```

---

## Phase 4: Full PostgREST HTTP Authorization Testing
*(Mutates Staging Data via HTTP — Requires Human Approval)*

### Phase 4 Execution Gate & Prerequisite Verification
Before executing HTTP authorization testing, the operator must verify:
- [ ] Staging URL verified against `EXPECTED_STAGING_PROJECT_REF` and confirmed NOT production.
- [ ] Staging Auth user tokens (`CUST1_JWT`, `ADMIN_JWT`) acquired and valid.
- [ ] Target dedicated court `c0000000-0000-0000-0000-000000000091` active with zero bookings on target slots for `$TEST_DATE`.
- [ ] Command tracing `set +x` confirmed; service-role credentials confined to secure environment and never logged.
- [ ] Any failure or unexpected response is a MANDATORY HARD STOP.

### PostgREST Error Mapping & Authorization Architecture
1. **Gateway / Role Privilege Rejections (Anon):** Unauthenticated (`anon`) calls to functions lacking `EXECUTE` privilege return HTTP `401 Unauthorized` (`PGRST301`) or HTTP `404 Not Found` (`PGRST202` — hidden from schema cache for unprivileged roles).
2. **Function Authorization Rejections (`SQLSTATE 42501` / `insufficient_privilege`):** PostgREST maps this explicitly to **HTTP 403 Forbidden** with response payload `{"code":"42501","message":"FORBIDDEN: ..."}`.
3. **Business Validation Rejections (`SQLSTATE P0001` or `22000`):** PostgREST maps these to **HTTP 400 Bad Request** with response payload `{"code":"P0001"|"22000","message":"..."}`. (Never assume `P0001` returns HTTP 403).
4. **Dual Baseline & Fail-Closed Side-Effect Verification:** Before every negative request, the script captures baseline record IDs for BOTH `public.bookings` and `public.payments` within the isolated test scope. Following the request, it queries both tables again. The verification **fails closed** if curl fails, HTTP status is not 200, JSON fails parsing, or current IDs diverge from baseline IDs. Pre-existing matching records are never treated as newly created side effects.
5. **Credential Protection:** Command tracing is disabled (`set +x`) and service-role keys are never echoed, logged, or printed.

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x # Prevent credential exposure in command traces

# Helper: Query exact record IDs from PostgREST with strict fail-closed validation
query_scope_ids() {
  local endpoint="$1" # "bookings" or "payments"
  local query_params="$2"
  local step_label="$3"
  local res status body ids

  res=$(curl -s -w "\n%{http_code}" -X GET \
    "$SUPABASE_URL/rest/v1/$endpoint?$query_params" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")
  status=$(echo "$res" | tail -n 1)
  body=$(echo "$res" | head -n -1)

  if [ "$status" != "200" ]; then
    echo "FATAL $step_label: Query to $endpoint failed with HTTP $status: $body" >&2
    exit 1
  fi

  # Validate JSON is an array and extract comma-separated sorted IDs
  ids=$(echo "$body" | jq -e 'if type=="array" then [.[].id] | sort | join(",") else error("not array") end' 2>/dev/null) || {
    echo "FATAL $step_label: Verification response for $endpoint failed to parse as JSON array: $body" >&2
    exit 1
  }

  echo "$ids"
}

# Helper: Assert no new bookings or payments were created beyond baseline in isolated test scope
assert_no_negative_side_effects() {
  local slot_time="$1"
  local base_booking_ids="$2"
  local base_payment_ids="$3"
  local step_label="$4"

  local curr_booking_ids curr_payment_ids
  
  # 1. Check public.bookings in isolated test scope (Court 91, TEST_DATE, slot_time)
  curr_booking_ids=$(query_scope_ids "bookings" \
    "select=id&court_id=eq.c0000000-0000-0000-0000-000000000091&booking_date=eq.$TEST_DATE&start_time=eq.$slot_time" \
    "$step_label:curr_bookings")
  
  if [ "$curr_booking_ids" != "$base_booking_ids" ]; then
    echo "FATAL $step_label: Database side-effect detected in public.bookings!" >&2
    echo "  Baseline IDs: '$base_booking_ids'" >&2
    echo "  Current IDs:  '$curr_booking_ids'" >&2
    exit 1
  fi

  # 2. Check public.payments referencing bookings in isolated test scope
  curr_payment_ids=$(query_scope_ids "payments" \
    "select=id,bookings!inner(court_id,booking_date,start_time)&bookings.court_id=eq.c0000000-0000-0000-0000-000000000091&bookings.booking_date=eq.$TEST_DATE&bookings.start_time=eq.$slot_time" \
    "$step_label:curr_payments")

  if [ "$curr_payment_ids" != "$base_payment_ids" ]; then
    echo "FATAL $step_label: Database side-effect detected in public.payments!" >&2
    echo "  Baseline IDs: '$base_payment_ids'" >&2
    echo "  Current IDs:  '$curr_payment_ids'" >&2
    exit 1
  fi
}

# 1. Obtain Authenticated User Tokens
CUST1_JWT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-player1@test.local","password":"StagingPlayer1Pass123!"}' | jq -r .access_token)

ADMIN_JWT=$(curl -s -X POST "$SUPABASE_URL/auth/v1/token?grant_type=password" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"email":"staging-admin@test.local","password":"StagingAdminPass123!"}' | jq -r .access_token)

# 4.1: Anonymous hold_court_booking Rejected at Gateway
BASE_B_4_1=$(query_scope_ids "bookings" "select=id&court_id=eq.c0000000-0000-0000-0000-000000000091&booking_date=eq.$TEST_DATE&start_time=eq.12:00:00" "4.1:base_b")
BASE_P_4_1=$(query_scope_ids "payments" "select=id,bookings!inner(court_id,booking_date,start_time)&bookings.court_id=eq.c0000000-0000-0000-0000-000000000091&bookings.booking_date=eq.$TEST_DATE&bookings.start_time=eq.12:00:00" "4.1:base_p")

RES_4_1=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/hold_court_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_booking_date":"'"$TEST_DATE"'","p_start_time":"12:00:00","p_end_time":"14:00:00","p_user_id":"'"$TEST_CUSTOMER_1_ID"'","p_amount":400}')
STATUS_4_1=$(echo "$RES_4_1" | tail -n 1)
BODY_4_1=$(echo "$RES_4_1" | head -n -1)
[ "$STATUS_4_1" = "401" ] || [ "$STATUS_4_1" = "404" ] || { echo "FATAL 4.1: Expected HTTP 401 or 404 for anon hold, got $STATUS_4_1 ($BODY_4_1)"; exit 1; }
assert_no_negative_side_effects "12:00:00" "$BASE_B_4_1" "$BASE_P_4_1" "4.1"

# 4.2: Anonymous create_walk_in_booking Rejected at Gateway
BASE_B_4_2=$(query_scope_ids "bookings" "select=id&court_id=eq.c0000000-0000-0000-0000-000000000091&booking_date=eq.$TEST_DATE&start_time=eq.12:00:00" "4.2:base_b")
BASE_P_4_2=$(query_scope_ids "payments" "select=id,bookings!inner(court_id,booking_date,start_time)&bookings.court_id=eq.c0000000-0000-0000-0000-000000000091&bookings.booking_date=eq.$TEST_DATE&bookings.start_time=eq.12:00:00" "4.2:base_p")

RES_4_2=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/create_walk_in_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_customer_name":"Anon","p_booking_date":"'"$TEST_DATE"'","p_start_time":"12:00:00","p_end_time":"14:00:00","p_amount":400,"p_customer_id":"c0000000-0000-0000-0000-000000000004"}')
STATUS_4_2=$(echo "$RES_4_2" | tail -n 1)
BODY_4_2=$(echo "$RES_4_2" | head -n -1)
[ "$STATUS_4_2" = "401" ] || [ "$STATUS_4_2" = "404" ] || { echo "FATAL 4.2: Expected HTTP 401 or 404 for anon walk-in, got $STATUS_4_2 ($BODY_4_2)"; exit 1; }
assert_no_negative_side_effects "12:00:00" "$BASE_B_4_2" "$BASE_P_4_2" "4.2"

# 4.3: Customer Self-Booking Succeeded (12:00 - 14:00)
RES_4_3=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/hold_court_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $CUST1_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_booking_date":"'"$TEST_DATE"'","p_start_time":"12:00:00","p_end_time":"14:00:00","p_user_id":"'"$TEST_CUSTOMER_1_ID"'","p_amount":400}')
STATUS_4_3=$(echo "$RES_4_3" | tail -n 1)
BODY_4_3=$(echo "$RES_4_3" | head -n -1)
[ "$STATUS_4_3" = "200" ] || [ "$STATUS_4_3" = "201" ] || { echo "FATAL 4.3: Self-booking failed with HTTP $STATUS_4_3: $BODY_4_3"; exit 1; }
export P4_HTTP_BOOKING_ID=$(echo "$BODY_4_3" | jq -r .booking_id)
export P4_HTTP_PAYMENT_ID=$(echo "$BODY_4_3" | jq -r .payment_id)

# 4.4: Customer Impersonation Rejected by Function Authorization (14:00 - 16:00)
# Customer 1 attempts to book using Customer 2's user_id -> SQLSTATE 42501 -> PostgREST HTTP 403
BASE_B_4_4=$(query_scope_ids "bookings" "select=id&court_id=eq.c0000000-0000-0000-0000-000000000091&booking_date=eq.$TEST_DATE&start_time=eq.14:00:00" "4.4:base_b")
BASE_P_4_4=$(query_scope_ids "payments" "select=id,bookings!inner(court_id,booking_date,start_time)&bookings.court_id=eq.c0000000-0000-0000-0000-000000000091&bookings.booking_date=eq.$TEST_DATE&bookings.start_time=eq.14:00:00" "4.4:base_p")

RES_4_4=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/hold_court_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $CUST1_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_booking_date":"'"$TEST_DATE"'","p_start_time":"14:00:00","p_end_time":"16:00:00","p_user_id":"'"$TEST_CUSTOMER_2_ID"'","p_amount":400}')
STATUS_4_4=$(echo "$RES_4_4" | tail -n 1)
BODY_4_4=$(echo "$RES_4_4" | head -n -1)
[ "$STATUS_4_4" = "403" ] || { echo "FATAL 4.4: Expected HTTP 403 Forbidden for impersonation, got $STATUS_4_4 ($BODY_4_4)"; exit 1; }
echo "$BODY_4_4" | grep -q '"code":"42501"' || { echo "FATAL 4.4: Expected SQLSTATE 42501 in response body: $BODY_4_4"; exit 1; }
echo "$BODY_4_4" | grep -q "FORBIDDEN: Cannot hold court on behalf of another player" || { echo "FATAL 4.4: Missing expected forbidden message: $BODY_4_4"; exit 1; }
assert_no_negative_side_effects "14:00:00" "$BASE_B_4_4" "$BASE_P_4_4" "4.4"

# 4.5: Customer Walk-in Attempt Rejected by Function Authorization (14:00 - 16:00)
# Customer role attempts admin walk-in -> SQLSTATE 42501 -> PostgREST HTTP 403
BASE_B_4_5=$(query_scope_ids "bookings" "select=id&court_id=eq.c0000000-0000-0000-0000-000000000091&booking_date=eq.$TEST_DATE&start_time=eq.14:00:00" "4.5:base_b")
BASE_P_4_5=$(query_scope_ids "payments" "select=id,bookings!inner(court_id,booking_date,start_time)&bookings.court_id=eq.c0000000-0000-0000-0000-000000000091&bookings.booking_date=eq.$TEST_DATE&bookings.start_time=eq.14:00:00" "4.5:base_p")

RES_4_5=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/create_walk_in_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $CUST1_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_customer_name":"Unauthorized","p_booking_date":"'"$TEST_DATE"'","p_start_time":"14:00:00","p_end_time":"16:00:00","p_amount":400,"p_customer_id":"c0000000-0000-0000-0000-000000000004"}')
STATUS_4_5=$(echo "$RES_4_5" | tail -n 1)
BODY_4_5=$(echo "$RES_4_5" | head -n -1)
[ "$STATUS_4_5" = "403" ] || { echo "FATAL 4.5: Expected HTTP 403 Forbidden for non-admin walkin, got $STATUS_4_5 ($BODY_4_5)"; exit 1; }
echo "$BODY_4_5" | grep -q '"code":"42501"' || { echo "FATAL 4.5: Expected SQLSTATE 42501 in response body: $BODY_4_5"; exit 1; }
echo "$BODY_4_5" | grep -q "FORBIDDEN: Admin privileges required to record walk-in reservations" || { echo "FATAL 4.5: Missing expected forbidden message: $BODY_4_5"; exit 1; }
assert_no_negative_side_effects "14:00:00" "$BASE_B_4_5" "$BASE_P_4_5" "4.5"

# 4.6: Admin Walk-in Succeeded (14:00 - 16:00)
RES_4_6=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/create_walk_in_booking" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Authorization: Bearer $ADMIN_JWT" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_customer_name":"Staging Walk-in Guest","p_booking_date":"'"$TEST_DATE"'","p_start_time":"14:00:00","p_end_time":"16:00:00","p_amount":400,"p_customer_id":"c0000000-0000-0000-0000-000000000004","p_payment_method":"cash"}')
STATUS_4_6=$(echo "$RES_4_6" | tail -n 1)
BODY_4_6=$(echo "$RES_4_6" | head -n -1)
[ "$STATUS_4_6" = "200" ] || [ "$STATUS_4_6" = "201" ] || { echo "FATAL 4.6: Admin walk-in failed with HTTP $STATUS_4_6: $BODY_4_6"; exit 1; }
export P4_ADMIN_WALKIN_BOOKING_ID=$(echo "$BODY_4_6" | jq -r .booking_id)

# 4.7: Service-Role Invocation (Simulates server-side Stripe checkout hold: 16:00 - 18:00)
RES_4_7=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/rest/v1/rpc/hold_court_booking" \
  -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" \
  -d '{"p_court_id":"c0000000-0000-0000-0000-000000000091","p_booking_date":"'"$TEST_DATE"'","p_start_time":"16:00:00","p_end_time":"18:00:00","p_user_id":"'"$TEST_CUSTOMER_2_ID"'","p_amount":400}')
STATUS_4_7=$(echo "$RES_4_7" | tail -n 1)
BODY_4_7=$(echo "$RES_4_7" | head -n -1)
[ "$STATUS_4_7" = "200" ] || [ "$STATUS_4_7" = "201" ] || { echo "FATAL 4.7: Service-role invocation failed with HTTP $STATUS_4_7: $BODY_4_7"; exit 1; }
export P4_SRV_BOOKING_ID=$(echo "$BODY_4_7" | jq -r .booking_id)
export P4_SRV_PAYMENT_ID=$(echo "$BODY_4_7" | jq -r .payment_id)

echo "SUCCESS: All HTTP security assertions and dual booking/payment zero-side-effect checks passed."
```

Register HTTP IDs into manifest:
```sql
DO $$
DECLARE
  v_run_id uuid := 'YOUR_RUN_ID'::uuid;
  v_walkin_payment_id uuid;
BEGIN
  SELECT id INTO v_walkin_payment_id FROM public.payments WHERE booking_id = 'YOUR_P4_ADMIN_WALKIN_BOOKING_ID'::uuid;

  INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
  VALUES 
    (v_run_id, 'booking', 'YOUR_P4_HTTP_BOOKING_ID'::uuid),
    (v_run_id, 'payment', 'YOUR_P4_HTTP_PAYMENT_ID'::uuid),
    (v_run_id, 'booking', 'YOUR_P4_ADMIN_WALKIN_BOOKING_ID'::uuid),
    (v_run_id, 'payment', v_walkin_payment_id),
    (v_run_id, 'booking', 'YOUR_P4_SRV_BOOKING_ID'::uuid),
    (v_run_id, 'payment', 'YOUR_P4_SRV_PAYMENT_ID'::uuid);
END $$;
```

---

## Phase 5: Concurrency Verification: Branch A & Branch B
*(Mutates Concurrency Slots — Requires Human Approval & Persistent Sessions)*

### Phase 5 Execution Gate & Prerequisite Verification
Before executing concurrency testing, the operator must verify:
- [ ] Active database connection verified via Step 0A to match `EXPECTED_STAGING_PROJECT_REF` and confirmed NOT production.
- [ ] Two persistent, independent database sessions established (e.g. two separate interactive `psql` shells; NOT the Supabase Dashboard SQL Editor).
- [ ] Backend PIDs dynamically recorded via `SELECT pg_backend_pid();` for Terminal 1 (`PID1`) and Terminal 2 (`PID2`).
- [ ] Dedicated test court `c0000000-0000-0000-0000-000000000091` verified to have zero existing bookings for `:test_date` on target slots `18:00:00-20:00:00` and `20:00:00-22:00:00`.
- [ ] Test date variable explicitly set in both sessions: `\set test_date 'YYYY-MM-DD'` matching the concrete `$TEST_DATE` established in Step 1C (e.g. `'2026-10-26'`).
- [ ] Session 3 (monitor session) verified and ready to execute the `pg_blocking_pids` query before any commit or rollback.
- [ ] Any unexpected lock state, connection failure, or mismatch is a MANDATORY HARD STOP.

### Persistent Connection Architecture & Preconditions
1. **Persistent Sessions Required:** Concurrency testing cannot be performed via the Supabase Dashboard SQL Editor because connection poolers execute independent statements across arbitrary pooled worker processes without retaining session states or row locks. The operator must establish two independent, persistent interactive database connections (e.g. two separate `psql` shell sessions).
2. **Explicit Concurrency Test Date:** Set the session variable in both `psql` sessions to match the single concrete `$TEST_DATE` established in Step 1C:
   ```sql
   \set test_date '2026-10-26' -- Must match Step 1C TEST_DATE exactly
   ```
   Both branches, fixture queries, lock queries, and final-state queries must reference this identical date.
3. **Dynamic Backend PIDs:** Do not hard-code process IDs. Each session dynamically obtains its backend PID via `SELECT pg_backend_pid();`.
4. **Mandatory Proof of Blocking:** Session 3 (a monitor query in a separate session) must explicitly verify that Session 2 is actively waiting on the row lock held by Session 1 before Session 1 executes `COMMIT` or `ROLLBACK`. If Session 2 is not blocked, the test cannot validate race condition prevention; abort immediately.
5. **Static Review Limitation Notice:** Static code analysis can verify SQL statements, table locking clauses (`FOR UPDATE`), and error codes, but **static review cannot prove live concurrency behavior**, lock acquisition timing, connection queuing, or race-condition resilience. Live execution on staging is mandatory.

---

### Branch A: Session 1 COMMITS -> Session 2 Fails with SLOT_UNAVAILABLE
Target slot: `18:00:00` to `20:00:00` on dedicated test court `c0000000-0000-0000-0000-000000000091`

1. **Session 1 (Terminal 1):**
   ```sql
   -- Discover Session 1 PID
   SELECT pg_backend_pid() AS session_1_pid; -- Note PID1 (e.g., 4210)

   BEGIN;
   SELECT public.hold_court_booking(
     'c0000000-0000-0000-0000-000000000091'::uuid,
     :'test_date'::date,
     '18:00:00'::time,
     '20:00:00'::time,
     'YOUR_TEST_CUSTOMER_1_ID'::uuid,
     400.00
   );
   -- Keep transaction open! Court row lock is currently held.
   ```
   *Record the returned JSON: `{"booking_id": "<CONC_A_BOOKING_ID>", "payment_id": "<CONC_A_PAYMENT_ID>"}`.*

2. **Session 2 (Terminal 2):**
   ```sql
   -- Discover Session 2 PID
   SELECT pg_backend_pid() AS session_2_pid; -- Note PID2 (e.g., 4215)

   BEGIN;
   SELECT public.hold_court_booking(
     'c0000000-0000-0000-0000-000000000091'::uuid,
     :'test_date'::date,
     '18:00:00'::time,
     '20:00:00'::time,
     'YOUR_TEST_CUSTOMER_2_ID'::uuid,
     400.00
   );
   -- Query HANGS waiting for row lock held by Session 1.
   ```

3. **Session 3 (Monitor / Staging SQL Editor):**
   Execute with the actual dynamic PIDs recorded above:
   ```sql
   SELECT 
     pid AS blocked_pid,
     pg_catalog.pg_blocking_pids(pid) AS blocking_pids,
     wait_event_type,
     wait_event,
     state
   FROM pg_catalog.pg_stat_activity
   WHERE pid = <PID2> 
     AND <PID1> = ANY(pg_catalog.pg_blocking_pids(pid));
   ```
   *Pass Criterion & Blocking Proof Gate:*
   **MANDATORY PROOF OF BLOCKING:** Exactly 1 row must be returned showing `blocked_pid = <PID2>`, `blocking_pids` containing `<PID1>`, and `wait_event_type = 'Lock'`. If 0 rows return, Session 2 is NOT blocked by Session 1. **DO NOT COMMIT SESSION 1 OR PROCEED.** Abort immediately.

4. **Session 1 (Terminal 1):**
   ```sql
   COMMIT;
   ```
   *Session 1 commits successfully.*

5. **Session 2 (Terminal 2):**
   Unblocks immediately upon Session 1's commit and raises:
   ```text
   ERROR: SLOT_UNAVAILABLE (SQLSTATE P0001)
   ```
   Execute recovery:
   ```sql
   ROLLBACK;
   ```

6. **Branch A Persisted-State & Manifest Assertions:**
   In SQL Editor / Monitor:
   ```sql
   -- 1. Verify winning Session 1 booking persisted with 'pending' status
   -- (hold_court_booking inserts holds as 'pending' prior to Stripe payment confirmation)
   SELECT id, status, total_amount, user_id 
   FROM public.bookings 
   WHERE id = '<CONC_A_BOOKING_ID>'::uuid
     AND status = 'pending';
   -- Must return 1 row
   
   -- 2. Verify winning Session 1 payment persisted with 'pending' status
   SELECT id, booking_id, amount, status 
   FROM public.payments 
   WHERE id = '<CONC_A_PAYMENT_ID>'::uuid
     AND status = 'pending';
   -- Must return 1 row

   -- 3. Verify losing/rolled-back Session 2 created ZERO booking rows
   SELECT count(*) AS leaked_session_2_bookings
   FROM public.bookings
   WHERE court_id = 'c0000000-0000-0000-0000-000000000091'::uuid
     AND booking_date = :'test_date'::date
     AND user_id = 'YOUR_TEST_CUSTOMER_2_ID'::uuid
     AND start_time = '18:00:00'::time;
   -- Must return 0

   -- 4. Verify losing/rolled-back Session 2 created ZERO payment rows
   SELECT count(*) AS leaked_session_2_payments
   FROM public.payments p
   JOIN public.bookings b ON b.id = p.booking_id
   WHERE b.court_id = 'c0000000-0000-0000-0000-000000000091'::uuid
     AND b.booking_date = :'test_date'::date
     AND b.user_id = 'YOUR_TEST_CUSTOMER_2_ID'::uuid;
   -- Must return 0
   ```

   **Register Branch A Winning Records in Manifest (Execute immediately):**
   ```sql
   INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
   VALUES 
     ('YOUR_RUN_ID'::uuid, 'booking', '<CONC_A_BOOKING_ID>'::uuid),
     ('YOUR_RUN_ID'::uuid, 'payment', '<CONC_A_PAYMENT_ID>'::uuid);
   ```

---

### Branch B: Session 1 ROLLS BACK -> Session 2 Succeeds
Target slot: `20:00:00` to `22:00:00` on dedicated test court `c0000000-0000-0000-0000-000000000091`

1. **Session 1 (Terminal 1):**
   ```sql
   BEGIN;
   SELECT public.hold_court_booking(
     'c0000000-0000-0000-0000-000000000091'::uuid,
     :'test_date'::date,
     '20:00:00'::time,
     '22:00:00'::time,
     'YOUR_TEST_CUSTOMER_1_ID'::uuid,
     400.00
   );
   -- Keep transaction open!
   ```

2. **Session 2 (Terminal 2):**
   ```sql
   BEGIN;
   SELECT public.hold_court_booking(
     'c0000000-0000-0000-0000-000000000091'::uuid,
     :'test_date'::date,
     '20:00:00'::time,
     '22:00:00'::time,
     'YOUR_TEST_CUSTOMER_2_ID'::uuid,
     400.00
   );
   -- Query HANGS waiting for row lock held by Session 1.
   ```

3. **Session 3 (Monitor):**
   ```sql
   SELECT 
     pid AS blocked_pid,
     pg_catalog.pg_blocking_pids(pid) AS blocking_pids,
     wait_event_type,
     wait_event,
     state
   FROM pg_catalog.pg_stat_activity
   WHERE pid = <PID2> 
     AND <PID1> = ANY(pg_catalog.pg_blocking_pids(pid));
   ```
   *Pass Criterion & Blocking Proof Gate:*
   **MANDATORY PROOF OF BLOCKING:** Exactly 1 row must be returned confirming Session 2 is actively blocked by Session 1. If 0 rows return, Session 2 is NOT blocked. **DO NOT ROLLBACK SESSION 1 OR PROCEED.** Abort immediately.

4. **Session 1 (Terminal 1):**
   ```sql
   ROLLBACK;
   ```
   *Session 1 aborts without committing.*

5. **Session 2 (Terminal 2):**
   Unblocks immediately, acquires the court lock, confirms the slot is available, and successfully returns:
   ```json
   {"booking_id": "<CONC_B_BOOKING_ID>", "payment_id": "<CONC_B_PAYMENT_ID>"}
   ```
   Commit Session 2:
   ```sql
   COMMIT;
   ```

6. **Branch B Persisted-State & Manifest Assertions:**
   In SQL Editor / Monitor:
   ```sql
   -- 1. Verify winning Session 2 booking persisted with 'pending' status
   -- (hold_court_booking inserts holds as 'pending' prior to Stripe payment confirmation)
   SELECT id, status, total_amount, user_id 
   FROM public.bookings 
   WHERE id = '<CONC_B_BOOKING_ID>'::uuid
     AND status = 'pending';
   -- Must return 1 row

   -- 2. Verify winning Session 2 payment persisted with 'pending' status
   SELECT id, booking_id, amount, status 
   FROM public.payments 
   WHERE id = '<CONC_B_PAYMENT_ID>'::uuid
     AND status = 'pending';
   -- Must return 1 row

   -- 3. Verify losing/rolled-back Session 1 created ZERO booking rows
   SELECT count(*) AS leaked_session_1_rows
   FROM public.bookings
   WHERE court_id = 'c0000000-0000-0000-0000-000000000091'::uuid
     AND booking_date = :'test_date'::date
     AND user_id = 'YOUR_TEST_CUSTOMER_1_ID'::uuid
     AND start_time = '20:00:00'::time;
   -- Must return 0

   -- 4. Verify losing/rolled-back Session 1 created ZERO payment rows
   SELECT count(*) AS leaked_session_1_payments
   FROM public.payments p
   JOIN public.bookings b ON b.id = p.booking_id
   WHERE b.court_id = 'c0000000-0000-0000-0000-000000000091'::uuid
     AND b.booking_date = :'test_date'::date
     AND b.user_id = 'YOUR_TEST_CUSTOMER_1_ID'::uuid;
   -- Must return 0
   ```

   **Register Branch B Winning Records in Manifest (Execute immediately):**
   ```sql
   INSERT INTO public.staging_test_manifest (run_id, entity_type, record_id)
   VALUES 
     ('YOUR_RUN_ID'::uuid, 'booking', '<CONC_B_BOOKING_ID>'::uuid),
     ('YOUR_RUN_ID'::uuid, 'payment', '<CONC_B_PAYMENT_ID>'::uuid);
   ```

---

## Phase 6: Strictly ID-Based Cleanup & Post-Verification
*(Removes Test Data — Requires Human Approval)*

### Phase 6 Execution Gate & Prerequisite Verification
Before executing cleanup, the operator must verify:
- [ ] Active project reference verified against `EXPECTED_STAGING_PROJECT_REF` and confirmed NOT production.
- [ ] Verification Phases 1 through 5 completed, with all created booking and payment IDs populated in `public.staging_test_manifest`.
- [ ] Manifest integrity confirmed: no NULL `record_id`s, no unexpected duplicate rows for `v_run_id`.
- [ ] Expected row counts confirmed: exactly 7 bookings and 7 payments recorded in `public.staging_test_manifest` for `v_run_id` (Phase 3: 2, Phase 4: 3, Phase 5: 2).
- [ ] Network retry policy understood: In the event of an ambiguous network failure or timeout during cleanup, **DO NOT automatically retry destructive operations**. Perform read-only verification first.
- [ ] Any uncertainty or manifest corruption is a MANDATORY HARD STOP.

### Step 6A: Clean Up Specific Database Records by ID
Enforces strict ID deduplication, parent-child relationship assertions, fixture creation provenance, transactional atomicity, and row-count verification.

> [!CAUTION]
> **Network Retry Policy:** If a network timeout, socket drop, or ambiguous outcome occurs during execution of this cleanup block, **DO NOT automatically retry destructive operations**. The operator must first execute read-only queries against `public.staging_test_manifest`, `public.bookings`, and `public.payments` to determine exactly which rows were removed before taking targeted action.

```sql
DO $$
DECLARE
  v_run_id uuid := 'YOUR_RUN_ID'::uuid;
  v_court_id uuid := 'c0000000-0000-0000-0000-000000000091'::uuid;
  v_guest_id uuid := 'c0000000-0000-0000-0000-000000000004'::uuid;
  v_payment_ids uuid[];
  v_booking_ids uuid[];
  v_profile_ids uuid[];
  v_deleted_count integer;
  v_expected_payments integer;
  v_expected_bookings integer;
  v_expected_profiles integer;
BEGIN
  -- 1. Check for Manifest Corruption (Nulls or Unexpected Duplicates)
  IF EXISTS (
    SELECT 1 FROM public.staging_test_manifest
    WHERE run_id = v_run_id AND record_id IS NULL
  ) THEN
    RAISE EXCEPTION 'ABORT: Manifest contains NULL record_id for run %.', v_run_id;
  END IF;

  IF EXISTS (
    SELECT record_id, entity_type, count(*)
    FROM public.staging_test_manifest
    WHERE run_id = v_run_id
    GROUP BY record_id, entity_type
    HAVING count(*) > 1
  ) THEN
    RAISE EXCEPTION 'ABORT: Corrupt manifest. Unexpected duplicate record IDs detected for run %.', v_run_id;
  END IF;

  -- 2. Retrieve deduplicated exact payment and booking IDs
  SELECT COALESCE(pg_catalog.array_agg(DISTINCT record_id), ARRAY[]::uuid[]) INTO v_payment_ids
  FROM public.staging_test_manifest
  WHERE run_id = v_run_id AND entity_type = 'payment';

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT record_id), ARRAY[]::uuid[]) INTO v_booking_ids
  FROM public.staging_test_manifest
  WHERE run_id = v_run_id AND entity_type = 'booking';

  SELECT COALESCE(pg_catalog.array_agg(DISTINCT record_id), ARRAY[]::uuid[]) INTO v_profile_ids
  FROM public.staging_test_manifest
  WHERE run_id = v_run_id AND entity_type = 'profile';

  v_expected_payments := COALESCE(pg_catalog.array_length(v_payment_ids, 1), 0);
  v_expected_bookings := COALESCE(pg_catalog.array_length(v_booking_ids, 1), 0);
  v_expected_profiles := COALESCE(pg_catalog.array_length(v_profile_ids, 1), 0);

  -- Verify all 7 planned test reservations (Phases 3, 4, 5) were registered:
  -- Phase 3: 2 bookings + 2 payments (Hold 3.8, Walk-in 3.10)
  -- Phase 4: 3 bookings + 3 payments (Customer hold 4.3, Walk-in 4.6, Service hold 4.7)
  -- Phase 5: 2 bookings + 2 payments (Branch A winner, Branch B winner)
  IF v_expected_bookings != 7 OR v_expected_payments != 7 THEN
    RAISE EXCEPTION 'ABORT: Manifest record count mismatch for run %. Expected exactly 7 bookings and 7 payments, found % bookings and % payments. Verify Phase 3, 4, and both Phase 5 branches registered their IDs.', v_run_id, v_expected_bookings, v_expected_payments;
  END IF;

  -- 3. Verify Payment Ownership & Parent Relationship
  -- Every payment ID must reference a booking ID created by this active test run
  IF EXISTS (
    SELECT 1 FROM public.payments p
    WHERE p.id = ANY(v_payment_ids)
      AND (p.booking_id IS NULL OR p.booking_id != ALL(v_booking_ids))
  ) THEN
    RAISE EXCEPTION 'ABORT: Payment ownership assertion failed for run %. Some payments do not belong to active run bookings.', v_run_id;
  END IF;

  -- 4. Verify Booking Ownership & Court Relationship
  -- Every booking ID must belong to the dedicated test court
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.id = ANY(v_booking_ids)
      AND b.court_id != v_court_id
  ) THEN
    RAISE EXCEPTION 'ABORT: Booking ownership assertion failed for run %. Some bookings do not belong to dedicated test court %.', v_run_id, v_court_id;
  END IF;

  -- 5. Verify Fixture Provenance: Court must have been created by current run
  IF NOT EXISTS (
    SELECT 1 FROM public.staging_test_manifest
    WHERE run_id = v_run_id AND entity_type = 'court' AND record_id = v_court_id
  ) THEN
    RAISE EXCEPTION 'ABORT: Dedicated test court % was not created by run %.', v_court_id, v_run_id;
  END IF;

  -- Ensure test court has no unrelated bookings that would be orphaned or destroyed
  IF EXISTS (
    SELECT 1 FROM public.bookings b
    WHERE b.court_id = v_court_id AND b.id != ALL(v_booking_ids)
  ) THEN
    RAISE EXCEPTION 'ABORT: Test court % has bookings outside the active test manifest. Refusing to delete.', v_court_id;
  END IF;

  -- 6. Verify Fixture Provenance: Guest customer must have been created by current run
  IF NOT EXISTS (
    SELECT 1 FROM public.staging_test_manifest
    WHERE run_id = v_run_id AND entity_type = 'customer' AND record_id = v_guest_id
  ) THEN
    RAISE EXCEPTION 'ABORT: Guest customer % was not created by run %.', v_guest_id, v_run_id;
  END IF;

  -- 7. Execute Deletions Transactionally with Strict Row-Count Assertions

  -- 7.1: Delete payments first (prevents foreign-key violations)
  DELETE FROM public.payments WHERE id = ANY(v_payment_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count != v_expected_payments THEN
    RAISE EXCEPTION 'ABORT: Payment deletion row count mismatch. Expected %, got %.', v_expected_payments, v_deleted_count;
  END IF;

  -- 7.2: Delete bookings
  DELETE FROM public.bookings WHERE id = ANY(v_booking_ids);
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count != v_expected_bookings THEN
    RAISE EXCEPTION 'ABORT: Booking deletion row count mismatch. Expected %, got %.', v_expected_bookings, v_deleted_count;
  END IF;

  -- 7.3: Delete guest customer (ensure no other bookings reference it)
  IF EXISTS (SELECT 1 FROM public.bookings WHERE customer_id = v_guest_id) THEN
    RAISE EXCEPTION 'ABORT: Guest customer % still has associated bookings.', v_guest_id;
  END IF;
  DELETE FROM public.customers WHERE id = v_guest_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count != 1 THEN
    RAISE EXCEPTION 'ABORT: Guest customer deletion mismatch. Expected 1, got %.', v_deleted_count;
  END IF;

  -- 7.4: Delete dedicated test court
  DELETE FROM public.courts WHERE id = v_court_id;
  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  IF v_deleted_count != 1 THEN
    RAISE EXCEPTION 'ABORT: Court deletion mismatch. Expected 1, got %.', v_deleted_count;
  END IF;

  -- 7.5: Delete test profiles created for this run
  IF v_expected_profiles > 0 THEN
    DELETE FROM public.profiles WHERE id = ANY(v_profile_ids);
    GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
    IF v_deleted_count != v_expected_profiles THEN
      RAISE EXCEPTION 'ABORT: Profile deletion mismatch. Expected %, got %.', v_expected_profiles, v_deleted_count;
    END IF;
  END IF;

  -- 7.6: Remove manifest records for this run
  DELETE FROM public.staging_test_manifest WHERE run_id = v_run_id;

  -- 7.7: Manifest table lifecycle: drop ONLY if completely empty across all runs
  IF NOT EXISTS (SELECT 1 FROM public.staging_test_manifest) THEN
    DROP TABLE public.staging_test_manifest;
    RAISE NOTICE 'SUCCESS: Manifest table empty across all runs; dropped.';
  ELSE
    RAISE NOTICE 'SUCCESS: Manifest table retained for other test runs.';
  END IF;

  RAISE NOTICE 'TRANSACTION SUCCESS: All % payments, % bookings, and fixtures cleaned up strictly by ID.',
    v_expected_payments, v_expected_bookings;
END $$;
```

---

### Step 6B: Delete Dedicated Auth Users via Admin API
Executed separately from the SQL transaction. Never hides failures: tracks unremoved IDs and returns a nonzero exit status if any user cannot be removed:

```bash
#!/usr/bin/env bash
set -euo pipefail
set +x

FAILED_AUTH_USERS=()

for UID in "$TEST_ADMIN_ID" "$TEST_CUSTOMER_1_ID" "$TEST_CUSTOMER_2_ID"; do
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" -X DELETE \
    "$SUPABASE_URL/auth/v1/admin/users/$UID" \
    -H "apikey: $SUPABASE_SERVICE_ROLE_KEY" \
    -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY")

  if [ "$HTTP_CODE" = "200" ] || [ "$HTTP_CODE" = "204" ]; then
    echo "SUCCESS: Deleted Auth user $UID."
  else
    echo "ERROR: Failed to delete Auth user $UID (HTTP $HTTP_CODE)." >&2
    FAILED_AUTH_USERS+=("$UID")
  fi
done

if [ ${#FAILED_AUTH_USERS[@]} -gt 0 ]; then
  echo "FATAL: Auth user cleanup incomplete! The following UUIDs could not be deleted:" >&2
  for F_UID in "${FAILED_AUTH_USERS[@]}"; do
    echo "  - $F_UID" >&2
  done
  echo "Operator intervention required in Supabase Auth Dashboard." >&2
  exit 1
fi

echo "SUCCESS: All dedicated Auth users cleaned up."
```

---

### Step 6C: Post-Cleanup Baseline & Orphan Integrity Verification
```sql
SELECT 
    (SELECT count(*) FROM public.courts) AS current_courts,
    (SELECT count(*) FROM public.bookings) AS current_bookings,
    (SELECT count(*) FROM public.payments) AS current_payments,
    (SELECT count(*) FROM public.profiles) AS current_profiles,
    (SELECT count(*) FROM public.customers) AS current_customers;

-- Verify zero new orphaned payments were created
SELECT count(*) AS orphan_payment_count
FROM public.payments
WHERE booking_id NOT IN (SELECT id FROM public.bookings);
```
*Pass criterion: All counts match Phase 0 baseline counts.*
