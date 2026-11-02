// tests/integration/run-pg-integration.mjs
// Isolated local PostgreSQL integration test runner for Crosshair Dinkers Hold Court Booking RPCs.
// Uses an ephemeral Docker container bound strictly to 127.0.0.1:5433.
// Zero production credentials, zero new npm dependencies.

import { spawn, spawnSync, execFileSync } from "node:child_process";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = path.resolve(__dirname, "../..");

const CONTAINER_NAME = "crosshair-pg-test";
const LOCAL_HOST = "127.0.0.1";
const LOCAL_PORT = 5433;
const TEST_DB = "crosshair_test_db";
const POSTGRES_USER = "postgres";
const POSTGRES_PASSWORD = "test_only_password_12345";
const PG_IMAGE = process.env.PG_IMAGE || "postgres:15-alpine";

let containerCreatedByScript = false;

// -----------------------------------------------------------------------------
// Safety Assertions & Guardrails
// -----------------------------------------------------------------------------

function assertLocalSafety() {
  const ALLOWED_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

  // 1. Refuse any connection string or env targeting remote domains
  const checkEnvs = [
    { key: "DATABASE_URL", val: process.env.DATABASE_URL },
    { key: "SUPABASE_DB_URL", val: process.env.SUPABASE_DB_URL },
    { key: "POSTGRES_URL", val: process.env.POSTGRES_URL },
  ].filter((e) => Boolean(e.val));

  for (const { key, val } of checkEnvs) {
    try {
      const parsed = new URL(val);
      if (!ALLOWED_HOSTS.has(parsed.hostname)) {
        throw new Error(
          `SAFETY VIOLATION: ${key} hostname '${parsed.hostname}' is not in allowed local hosts (${[...ALLOWED_HOSTS].join(", ")}). Refusing to run tests against non-local host.`
        );
      }
    } catch (urlErr) {
      if (urlErr.message.includes("SAFETY VIOLATION")) throw urlErr;
      throw new Error(
        `SAFETY VIOLATION: Malformed ${key} ('${val}'). Unable to confirm local-only safety: ${urlErr.message}`
      );
    }
  }

  // 2. Refuse if Docker is not accessible
  const dockerInfo = spawnSync("docker", ["info"], { encoding: "utf8" });
  if (dockerInfo.status !== 0) {
    throw new Error(
      `Docker is not running or accessible. Please start Docker Engine first.\nDetails: ${dockerInfo.stderr}`
    );
  }

  // 3. Refuse if container name already exists to prevent clobbering existing containers
  const existingContainer = spawnSync(
    "docker",
    ["ps", "-a", "--filter", `name=^/${CONTAINER_NAME}$`, "--format", "{{.Names}}"],
    { encoding: "utf8" }
  );

  if (existingContainer.stdout && existingContainer.stdout.trim() === CONTAINER_NAME) {
    throw new Error(
      `SAFETY REFUSAL: A container named '${CONTAINER_NAME}' already exists. The runner will not remove or overwrite pre-existing containers. Please remove it manually or rename.`
    );
  }
}

// -----------------------------------------------------------------------------
// Container Lifecycle Helpers
// -----------------------------------------------------------------------------

function cleanup() {
  if (containerCreatedByScript) {
    console.log(`[Teardown] Removing ephemeral test container '${CONTAINER_NAME}'...`);
    try {
      execFileSync("docker", ["rm", "-f", CONTAINER_NAME], { stdio: "ignore" });
      containerCreatedByScript = false;
      console.log(`[Teardown] Cleaned up container '${CONTAINER_NAME}'.`);
    } catch (err) {
      console.warn(`[Teardown] Warning: Failed to remove container '${CONTAINER_NAME}':`, err.message);
    }
  }
}

// Register exit handlers
process.on("SIGINT", () => {
  cleanup();
  process.exit(130);
});
process.on("SIGTERM", () => {
  cleanup();
  process.exit(143);
});
process.on("exit", () => {
  cleanup();
});

function runPsqlCommand(sql, { db = TEST_DB, role = null, uid = null, asRole = false } = {}) {
  let sessionPreamble = "";
  if (asRole && role) {
    sessionPreamble += `SET LOCAL ROLE ${role};\n`;
  }
  if (role) {
    sessionPreamble += `SET LOCAL request.jwt.claim.role = '${role}';\n`;
  }
  if (uid) {
    sessionPreamble += `SET LOCAL request.jwt.claim.sub = '${uid}';\n`;
  }

  const fullSql = sessionPreamble ? `BEGIN;\n${sessionPreamble}${sql};\nCOMMIT;\n` : sql;

  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER_NAME,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-v",
      "VERBOSITY=verbose",
      "-q",
      "-A",
      "-t",
    ],
    {
      input: fullSql,
      encoding: "utf8",
    }
  );

  return {
    status: res.status,
    stdout: res.stdout ? res.stdout.trim() : "",
    stderr: res.stderr ? res.stderr.trim() : "",
  };
}

function runPsqlFile(filePath, { db = TEST_DB } = {}) {
  const content = fs.readFileSync(filePath, "utf8");
  const res = spawnSync(
    "docker",
    [
      "exec",
      "-i",
      CONTAINER_NAME,
      "psql",
      "-U",
      POSTGRES_USER,
      "-d",
      db,
      "-v",
      "ON_ERROR_STOP=1",
      "-q",
    ],
    {
      input: content,
      encoding: "utf8",
    }
  );

  if (res.status !== 0) {
    throw new Error(`Failed to apply SQL file ${filePath}:\n${res.stderr}`);
  }
}

// -----------------------------------------------------------------------------
// Test Runner Main
// -----------------------------------------------------------------------------

async function main() {
  console.log("================================================================================");
  console.log("Crosshair Dinkers: Hold Court Booking Integration Test Runner (PostgreSQL)");
  console.log("================================================================================");

  // 1. Safety check
  assertLocalSafety();
  console.log("✔ Safety checks passed: Host verified as local, no conflicting containers.");

  // 2. Start container
  console.log(`[Launch] Starting ephemeral PostgreSQL container '${CONTAINER_NAME}' on ${LOCAL_HOST}:${LOCAL_PORT}...`);
  const runRes = spawnSync("docker", [
    "run",
    "--name",
    CONTAINER_NAME,
    "-e",
    `POSTGRES_PASSWORD=${POSTGRES_PASSWORD}`,
    "-p",
    `${LOCAL_HOST}:${LOCAL_PORT}:5432`,
    "-d",
    PG_IMAGE,
  ]);

  if (runRes.status !== 0) {
    throw new Error(`Failed to start docker container: ${runRes.stderr.toString()}`);
  }
  containerCreatedByScript = true;

  // 3. Wait for PostgreSQL readiness
  console.log("[Launch] Waiting for PostgreSQL readiness...");
  let ready = false;
  for (let i = 0; i < 30; i++) {
    const probe = spawnSync("docker", [
      "exec",
      CONTAINER_NAME,
      "psql",
      "-h",
      "127.0.0.1", // TCP: the image's temporary init server only listens on the unix socket
      "-U",
      POSTGRES_USER,
      "-c",
      "SELECT 1;",
    ]);
    if (probe.status === 0) {
      ready = true;
      break;
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!ready) {
    throw new Error("PostgreSQL failed to become ready within 15 seconds.");
  }
  console.log("✔ PostgreSQL container is ready.");

  // 4. Create dedicated disposable test database
  console.log(`[Setup] Creating dedicated test database '${TEST_DB}'...`);
  const createDbRes = spawnSync("docker", [
    "exec",
    CONTAINER_NAME,
    "psql",
    "-U",
    POSTGRES_USER,
    "-c",
    `CREATE DATABASE ${TEST_DB};`,
  ]);
  if (createDbRes.status !== 0) {
    throw new Error(`Failed to create test database: ${createDbRes.stderr.toString()}`);
  }

  // 5. Verify local database identity
  const idCheck = runPsqlCommand(
    "SELECT current_database(), current_user, inet_server_addr() IS NULL OR inet_server_addr() = '127.0.0.1'::inet;"
  );
  assert.equal(idCheck.status, 0, `Database identity query failed: ${idCheck.stderr}`);
  const [connectedDb, connectedUser, isLocalAddress] = idCheck.stdout.split("|").map((s) => s.trim());
  assert.equal(connectedDb, TEST_DB, `Expected connected database to be exactly '${TEST_DB}', got '${connectedDb}'`);
  assert.equal(connectedUser, POSTGRES_USER, `Expected connected user to be '${POSTGRES_USER}', got '${connectedUser}'`);
  assert.equal(isLocalAddress, "t", `Expected local server-address check to return 't' (true), got '${isLocalAddress}'`);
  console.log(`✔ Verified target is strictly local disposable database '${TEST_DB}' with local server address.`);

  // 6. Apply schema fixture
  const fixturePath = path.join(__dirname, "fixture.sql");
  console.log(`[Setup] Applying test schema fixture from ${fixturePath}...`);
  runPsqlFile(fixturePath);
  console.log("✔ Schema fixture applied successfully.");

  // 7. Apply migration under test
  const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261024_hold_court_booking_rpc.sql");
  console.log(`[Setup] Applying migration under test: 20261024_hold_court_booking_rpc.sql...`);
  runPsqlFile(migrationPath);
  console.log("✔ Migration applied successfully with 0 errors.");

  // 8. Apply Stage 2 migration under test
  const stage2MigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261025_stage2_game_day_status_tracking.sql");
  console.log(`[Setup] Applying Stage 2 migration: 20261025_stage2_game_day_status_tracking.sql...`);
  runPsqlFile(stage2MigrationPath);
  console.log("✔ Stage 2 migration applied successfully with 0 errors.");

  // 9. Apply Stage 1 Hold Expiry & Checkout Compatibility migration
  const stage1HoldExpiryPath = path.join(PROJECT_ROOT, "supabase/migrations/20261026_stage1_hold_expiry_and_checkout_compatibility.sql");
  console.log(`[Setup] Applying Stage 1 hold expiry migration: 20261026_stage1_hold_expiry_and_checkout_compatibility.sql...`);
  runPsqlFile(stage1HoldExpiryPath);
  console.log("✔ Stage 1 hold expiry migration applied successfully with 0 errors.");

  // 10. Apply Phase 2 Payment Reconciliation & Refund Ledger migration
  const paymentReconciliationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261027_payment_reconciliation_and_refund_ledger.sql");
  console.log(`[Setup] Applying Phase 2 migration: 20261027_payment_reconciliation_and_refund_ledger.sql...`);
  runPsqlFile(paymentReconciliationPath);
  console.log("✔ Phase 2 migration applied successfully with 0 errors.");

  // 11. Apply Phase 2 Corrective: reconcile_booking_payment refund fix
  const paymentRefundFixPath = path.join(PROJECT_ROOT, "supabase/migrations/20261028_reconcile_booking_payment_refund_fix.sql");
  console.log(`[Setup] Applying Phase 2 corrective migration: 20261028_reconcile_booking_payment_refund_fix.sql...`);
  runPsqlFile(paymentRefundFixPath);
  console.log("✔ Phase 2 corrective migration applied successfully with 0 errors.");

  // 12. Apply RLS migration: 20261029_enable_rls_on_core_tables.sql
  const rlsMigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261028141752_20261029_enable_rls_on_core_tables.sql");
  console.log(`[Setup] Applying RLS migration: 20261029_enable_rls_on_core_tables.sql...`);
  runPsqlFile(rlsMigrationPath);
  console.log("✔ RLS migration applied successfully with 0 errors.");

  // 13. Apply cancel_expired_booking resilience migration: 20261030_cancel_expired_booking_resilience.sql
  const resilienceMigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261030_cancel_expired_booking_resilience.sql");
  console.log(`[Setup] Applying resilience migration: 20261030_cancel_expired_booking_resilience.sql...`);
  runPsqlFile(resilienceMigrationPath);
  console.log("✔ Resilience migration applied successfully with 0 errors.");

  // 14. Apply tightened RLS & walk-in RPC migration: 20261031_tighten_core_rls_and_walk_in_rpc.sql
  const tightenRlsMigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261028141848_20261031_tighten_core_rls_and_walk_in_rpc.sql");
  console.log(`[Setup] Applying tightened RLS migration: 20261031_tighten_core_rls_and_walk_in_rpc.sql...`);
  runPsqlFile(tightenRlsMigrationPath);
  console.log("✔ Tightened RLS migration applied successfully with 0 errors.");

  // 15. Apply 20261101 secure profiles & public slot availability migration
  const secureProfilesMigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261028154959_20261101_secure_profiles_and_public_slot_availability.sql");
  console.log(`[Setup] Applying secure profiles migration: 20261101_secure_profiles_and_public_slot_availability.sql...`);
  runPsqlFile(secureProfilesMigrationPath);
  console.log("✔ Secure profiles migration applied successfully with 0 errors.");

  // 16. Apply 20261102 launch hardening migration
  const launchHardeningMigrationPath = path.join(PROJECT_ROOT, "supabase/migrations/20261028142111_20261102_launch_hardening.sql");
  console.log(`[Setup] Applying launch hardening migration: 20261102_launch_hardening.sql...`);
  runPsqlFile(launchHardeningMigrationPath);
  console.log("✔ Launch hardening migration applied successfully with 0 errors.");

  // 17. Apply hold release grace period migration (file renamed to its hosted version once applied)
  const graceMigrationPath = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations"))
    .filter((f) => f.endsWith("hold_release_grace_period.sql"))
    .map((f) => path.join(PROJECT_ROOT, "supabase/migrations", f))[0];
  assert.ok(graceMigrationPath, "hold_release_grace_period migration file not found");
  console.log(`[Setup] Applying grace period migration: ${path.basename(graceMigrationPath)}...`);
  runPsqlFile(graceMigrationPath);
  console.log("✔ Grace period migration applied successfully with 0 errors.");

  // ---------------------------------------------------------------------------
  // Test Cases Execution
  // ---------------------------------------------------------------------------
  console.log("\n--- Executing SQL Integration Test Suite ---");

  const adminUid = "11111111-1111-1111-1111-111111111111";
  const aliceUid = "22222222-2222-2222-2222-222222222222";
  const bobUid = "33333333-3333-3333-3333-333333333333";
  // Owns the long-lived holds Groups 2 and 4 build on, so they do not count toward Alice/Bob hold caps
  const danaUid = "55555555-5555-5555-5555-555555555555";
  const guestCustId = "44444444-4444-4444-4444-444444444444";
  const activeCourtId = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
  const maintCourtId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

  // Pick deterministic future dates relative to current UTC/Manila time
  // 2029-10-23 is a Tuesday (open 07:00-22:00)
  // 2029-10-22 is a Monday (closed)
  const openDate = "2029-10-23";
  const closedDate = "2029-10-22";

  let passedTests = 0;

  async function runTest(name, fn) {
    // Tests build their own Alice/Bob holds; expire leftovers so the 3-active-holds cap
    // (20261102) only sees holds created by the current test.
    const expireLeftovers = runPsqlCommand(
      `UPDATE public.bookings SET hold_expires_at = now() - interval '1 hour'
       WHERE status = 'pending' AND user_id IN ('${aliceUid}', '${bobUid}')
         AND coalesce(hold_expires_at, created_at + interval '35 minutes') > now();`
    );
    assert.equal(expireLeftovers.status, 0, expireLeftovers.stderr);
    try {
      await fn();
      console.log(`  ✔ PASS: ${name}`);
      passedTests++;
    } catch (err) {
      console.error(`  ✖ FAIL: ${name}`);
      console.error(err);
      throw err;
    }
  }

  // --- Group 1: Walk-in Payment Method Whitelist & Payment Status ---

  await runTest("Walk-in payment with 'cash' records confirmed booking and paid payment", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Cash Walkin',
        p_booking_date => '${openDate}',
        p_start_time => '07:00:00',
        p_end_time => '08:00:00',
        p_amount => 200,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'cash'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(res.status, 0, res.stderr);
    const bookingId = JSON.parse(res.stdout).booking_id;

    // Verify persisted database state
    const check = runPsqlCommand(
      `SELECT b.status, p.status, p.payment_method, p.amount, p.paid_at IS NOT NULL
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
       WHERE b.id = '${bookingId}';`
    );
    assert.equal(check.stdout, "confirmed|paid|cash|200|t");
  });

  await runTest("Walk-in payment with 'gcash' records confirmed booking and paid payment", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Gcash Walkin',
        p_booking_date => '${openDate}',
        p_start_time => '08:00:00',
        p_end_time => '09:00:00',
        p_amount => 200,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'gcash'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(res.status, 0, res.stderr);
    const bookingId = JSON.parse(res.stdout).booking_id;

    const check = runPsqlCommand(
      `SELECT b.status, p.status, p.payment_method, p.paid_at IS NOT NULL
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
       WHERE b.id = '${bookingId}';`
    );
    assert.equal(check.stdout, "confirmed|paid|gcash|t");
  });

  await runTest("Walk-in payment with NULL (unpaid) records confirmed booking and pending payment", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Unpaid Member Walkin',
        p_booking_date => '${openDate}',
        p_start_time => '09:00:00',
        p_end_time => '10:00:00',
        p_amount => 200,
        p_user_id => '${aliceUid}',
        p_payment_method => NULL
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(res.status, 0, res.stderr);
    const bookingId = JSON.parse(res.stdout).booking_id;

    const check = runPsqlCommand(
      `SELECT b.status, p.status, p.payment_method IS NULL, p.paid_at IS NULL
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
       WHERE b.id = '${bookingId}';`
    );
    assert.equal(check.stdout, "confirmed|pending|t|t");
  });

  await runTest("Walk-in payment with invalid method 'card' raises 22000 and persists nothing", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Card Player',
        p_booking_date => '${openDate}',
        p_start_time => '12:00:00',
        p_end_time => '13:00:00',
        p_amount => 200,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'card'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"), `Expected SQLSTATE 22000, got: ${res.stderr}`);
    assert.ok(res.stderr.includes("payment_method must be cash, gcash, or null"));

    // Verify nothing persisted
    const check = runPsqlCommand(
      `SELECT count(*) FROM public.bookings WHERE customer_name = 'Card Player';`
    );
    assert.equal(check.stdout, "0");
  });

  await runTest("Walk-in payment with invalid string 'unpaid' raises 22000 and specific error message", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Unpaid String Player',
        p_booking_date => '${openDate}',
        p_start_time => '12:00:00',
        p_end_time => '13:00:00',
        p_amount => 200,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'unpaid'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"), `Expected SQLSTATE 22000, got: ${res.stderr}`);
    assert.ok(
      res.stderr.includes("payment_method must be cash, gcash, or null"),
      `Expected payment_method error message, got: ${res.stderr}`
    );

    // Verify nothing persisted
    const check = runPsqlCommand(
      `SELECT count(*) FROM public.bookings WHERE customer_name = 'Unpaid String Player';`
    );
    assert.equal(check.stdout, "0");
  });

  // --- Group 2: Durations, Boundary Checks, & Pricing ---

  await runTest("Online hold accepts 1, 2, and 3-hour durations at flat PHP 200/hr", () => {
    // 1 hour
    const r1 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '13:00:00', '14:00:00', '${danaUid}', 200);`,
      { role: "authenticated", uid: danaUid }
    );
    assert.equal(r1.status, 0, r1.stderr);

    // 2 hours
    const r2 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '14:00:00', '16:00:00', '${danaUid}', 400);`,
      { role: "authenticated", uid: danaUid }
    );
    assert.equal(r2.status, 0, r2.stderr);

    // 3 hours
    const r3 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '16:00:00', '19:00:00', '${danaUid}', 600);`,
      { role: "authenticated", uid: danaUid }
    );
    assert.equal(r3.status, 0, r3.stderr);
  });

  await runTest("Online hold rejects 4-hour duration with INVALID_DURATION (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '12:00:00', '16:00:00', '${aliceUid}', 800);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("INVALID_DURATION"));
  });

  await runTest("Online hold rejects non-whole-hour times with INVALID_TIME_INCREMENT (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '12:30:00', '13:30:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("INVALID_TIME_INCREMENT"));
  });

  await runTest("Online hold rejects underpayment price tampering with INVALID_AMOUNT (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '19:00:00', '21:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("INVALID_AMOUNT"));
  });

  // --- Group 3: Operating Hours & Past Slots ---

  await runTest("Rejects booking on closed venue day with VENUE_CLOSED (P0001)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${closedDate}', '08:00:00', '09:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("P0001"));
    assert.ok(res.stderr.includes("VENUE_CLOSED"));
  });

  await runTest("Rejects booking before opening time with OUTSIDE_OPERATING_HOURS (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '06:00:00', '07:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("OUTSIDE_OPERATING_HOURS"));
  });

  await runTest("Rejects booking extending past closing time with OUTSIDE_OPERATING_HOURS (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '21:00:00', '23:00:00', '${aliceUid}', 400);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("OUTSIDE_OPERATING_HOURS"));
  });

  await runTest("Rejects past date/time slot with PAST_SLOT (22000)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '2020-01-07', '10:00:00', '11:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("22000"));
    assert.ok(res.stderr.includes("PAST_SLOT"));
  });

  // --- Group 4: Overlapping and Adjacent Slot Boundaries ---

  await runTest("Detects conflict on partial overlap with SLOT_UNAVAILABLE (P0001)", () => {
    // Slot 13:00-14:00 is already held from Group 2. Request 13:00-15:00.
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '13:00:00', '15:00:00', '${bobUid}', 400);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("P0001"));
    assert.ok(res.stderr.includes("SLOT_UNAVAILABLE"));
  });

  await runTest("Allows adjacent slots touching boundaries without overlap", () => {
    const r1 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '19:00:00', '20:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(r1.status, 0, r1.stderr);

    const rAdjacentAfter = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '20:00:00', '21:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(rAdjacentAfter.status, 0, rAdjacentAfter.stderr);
  });

  // --- Group 5: Court Status & Not Found ---

  await runTest("Rejects booking on court under maintenance with COURT_UNAVAILABLE (P0001)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${maintCourtId}', '${openDate}', '08:00:00', '09:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("P0001"));
    assert.ok(res.stderr.includes("COURT_UNAVAILABLE"));
  });

  await runTest("Rejects booking on nonexistent court with NOT_FOUND (P0002)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('99999999-9999-9999-9999-999999999999', '${openDate}', '08:00:00', '09:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("P0002"));
    assert.ok(res.stderr.includes("NOT_FOUND"));
  });

  // --- Group 6: Authorization & Role Enforcement ---

  await runTest("Anonymous caller on hold_court_booking is rejected with UNAUTHORIZED (42501)", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '21:00:00', '22:00:00', '${aliceUid}', 200);`,
      { role: "anon", uid: null }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("42501"));
    assert.ok(res.stderr.includes("UNAUTHORIZED"));
  });

  await runTest("Customer reserving on behalf of another player is rejected with FORBIDDEN (42501)", () => {
    // Alice is authenticated caller, but passes Bob's uid
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '21:00:00', '22:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("42501"));
    assert.ok(res.stderr.includes("FORBIDDEN: Cannot hold court on behalf of another player"));
  });

  await runTest("Non-admin regular customer calling create_walk_in_booking is rejected with FORBIDDEN (42501)", () => {
    const res = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Sneaky Player',
        p_booking_date => '${openDate}',
        p_start_time => '21:00:00',
        p_end_time => '22:00:00',
        p_amount => 200,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'cash'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(res.status, 0);
    assert.ok(res.stderr.includes("42501"));
    assert.ok(res.stderr.includes("FORBIDDEN: Admin privileges required"));
  });

  await runTest("Service role can hold court and specify player uid", () => {
    const res = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '21:00:00', '22:00:00', '${bobUid}', 200);`,
      { role: "service_role", uid: null }
    );
    assert.equal(res.status, 0, res.stderr);
    const bookingId = JSON.parse(res.stdout).booking_id;
    const check = runPsqlCommand(`SELECT user_id FROM public.bookings WHERE id = '${bookingId}';`);
    assert.equal(check.stdout, bobUid);
  });

  // --- Group 7: Transaction Atomicity & Rollback ---

  await runTest("Failure during payment insertion in RPC automatically rolls back booking row", () => {
    const dateRollback = "2029-10-24"; // Wednesday
    try {
      // 1. Install a temporary trigger that fails during payment insertion specifically on the designated test date
      const setupRes = runPsqlCommand(`
        CREATE OR REPLACE FUNCTION public.fail_payment_trigger() RETURNS trigger AS $$
        BEGIN
          IF EXISTS (
            SELECT 1 FROM public.bookings b
            WHERE b.id = NEW.booking_id AND b.booking_date = '${dateRollback}'
          ) THEN
            RAISE EXCEPTION 'TRIGGER_SIMULATED_PAYMENT_FAILURE' USING ERRCODE = 'P0001';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql;

        DROP TRIGGER IF EXISTS trg_fail_payment ON public.payments;
        CREATE TRIGGER trg_fail_payment
        BEFORE INSERT ON public.payments
        FOR EACH ROW EXECUTE FUNCTION public.fail_payment_trigger();
      `);
      assert.equal(setupRes.status, 0, `Trigger creation failed: ${setupRes.stderr}`);

      // Record baseline counts before failed walk-in RPC
      const bookingsBefore1 = runPsqlCommand("SELECT count(*) FROM public.bookings;").stdout;
      const paymentsBefore1 = runPsqlCommand("SELECT count(*) FROM public.payments;").stdout;

      // 2. Call the actual create_walk_in_booking RPC on the target date
      const res = runPsqlCommand(
        `SELECT public.create_walk_in_booking(
          p_court_id => '${activeCourtId}',
          p_customer_name => 'Rollback Target Player',
          p_booking_date => '${dateRollback}',
          p_start_time => '08:00:00',
          p_end_time => '09:00:00',
          p_amount => 200,
          p_customer_id => '${guestCustId}',
          p_payment_method => 'cash'
        );`,
        { role: "authenticated", uid: adminUid }
      );

      // Verify the RPC failed with SQLSTATE P0001 and trigger error message
      assert.notEqual(res.status, 0, "RPC should have failed due to payment trigger failure");
      assert.ok(res.stderr.includes("P0001"), `Expected SQLSTATE P0001, got: ${res.stderr}`);
      assert.ok(
        res.stderr.includes("TRIGGER_SIMULATED_PAYMENT_FAILURE"),
        `Expected trigger failure message, got: ${res.stderr}`
      );

      // Verify booking and payment counts are unchanged after failed walk-in RPC
      const bookingsAfter1 = runPsqlCommand("SELECT count(*) FROM public.bookings;").stdout;
      const paymentsAfter1 = runPsqlCommand("SELECT count(*) FROM public.payments;").stdout;
      assert.equal(bookingsAfter1, bookingsBefore1, "Booking count must be unchanged after failed walk-in RPC");
      assert.equal(paymentsAfter1, paymentsBefore1, "Payment count must be unchanged after failed walk-in RPC");

      // Verify that zero booking rows exist on the rollback date
      const countDateBookings1 = runPsqlCommand(
        `SELECT count(*) FROM public.bookings WHERE booking_date = '${dateRollback}';`
      ).stdout;
      assert.equal(countDateBookings1, "0", "Atomic rollback verified: 0 booking rows must exist on rollback date");

      // Record baseline counts before failed hold RPC
      const bookingsBefore2 = runPsqlCommand("SELECT count(*) FROM public.bookings;").stdout;
      const paymentsBefore2 = runPsqlCommand("SELECT count(*) FROM public.payments;").stdout;

      // 3. Test hold_court_booking rollback as well on the same target date
      const holdRes = runPsqlCommand(
        `SELECT public.hold_court_booking(
          '${activeCourtId}',
          '${dateRollback}',
          '10:00:00',
          '11:00:00',
          '${aliceUid}',
          200
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.notEqual(holdRes.status, 0, "hold_court_booking should have failed due to payment trigger failure");
      assert.ok(holdRes.stderr.includes("P0001"), `Expected SQLSTATE P0001, got: ${holdRes.stderr}`);
      assert.ok(
        holdRes.stderr.includes("TRIGGER_SIMULATED_PAYMENT_FAILURE"),
        `Expected trigger failure message, got: ${holdRes.stderr}`
      );

      // Verify booking and payment counts are unchanged after failed hold RPC
      const bookingsAfter2 = runPsqlCommand("SELECT count(*) FROM public.bookings;").stdout;
      const paymentsAfter2 = runPsqlCommand("SELECT count(*) FROM public.payments;").stdout;
      assert.equal(bookingsAfter2, bookingsBefore2, "Booking count must be unchanged after failed hold RPC");
      assert.equal(paymentsAfter2, paymentsBefore2, "Payment count must be unchanged after failed hold RPC");

      const countDateBookings2 = runPsqlCommand(
        `SELECT count(*) FROM public.bookings WHERE booking_date = '${dateRollback}';`
      ).stdout;
      assert.equal(countDateBookings2, "0", "Atomic rollback verified: 0 booking rows must exist after hold_court_booking failure");
    } finally {
      // Clean up trigger safely even if assertions or setup fail
      try {
        const cleanupRes = runPsqlCommand(`
          DROP TRIGGER IF EXISTS trg_fail_payment ON public.payments;
          DROP FUNCTION IF EXISTS public.fail_payment_trigger();
        `);
        if (cleanupRes.status !== 0) {
          console.error(`[Rollback Test Cleanup Warning] Failed to drop temporary trigger: ${cleanupRes.stderr}`);
        }
      } catch (cleanupErr) {
        console.error(`[Rollback Test Cleanup Error] Failed to execute trigger cleanup:`, cleanupErr);
      }
    }
  });

  // --- Group 8: Concurrency & Row-Lock Serialization ---

  await runTest("Concurrent competing transactions on the same court serialize cleanly via FOR UPDATE", async () => {
    const raceDate = "2029-10-25"; // Thursday
    const raceStart = "10:00:00";
    const raceEnd = "12:00:00"; // 2 hours

    // Spawn Worker 1 in independent psql session: locks court row, holds for 1.2s, calls hold_court_booking, commits
    const worker1Sql = `
      BEGIN;
      SELECT status FROM public.courts WHERE id = '${activeCourtId}' FOR UPDATE;
      SELECT pg_sleep(1.2);
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${aliceUid}';
      SELECT public.hold_court_booking('${activeCourtId}', '${raceDate}', '${raceStart}', '${raceEnd}', '${aliceUid}', 400);
      COMMIT;
    `;

    // Worker 2 starts 300ms later in a separate psql session: attempts walkin for overlapping slot (11:00-13:00)
    const worker2Sql = `
      BEGIN;
      SET LOCAL request.jwt.claim.role = 'authenticated';
      SET LOCAL request.jwt.claim.sub = '${adminUid}';
      SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}',
        p_customer_name => 'Contender Walkin',
        p_booking_date => '${raceDate}',
        p_start_time => '11:00:00',
        p_end_time => '13:00:00',
        p_amount => 400,
        p_customer_id => '${guestCustId}',
        p_payment_method => 'cash'
      );
      COMMIT;
    `;

    const p1 = new Promise((resolve) => {
      const child = spawn("docker", [
        "exec",
        "-i",
        CONTAINER_NAME,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        TEST_DB,
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
      ]);
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(worker1Sql);
    });

    // Wait 300ms so worker 1 definitely grabs court row lock first
    await new Promise((r) => setTimeout(r, 300));

    const p2 = new Promise((resolve) => {
      const child = spawn("docker", [
        "exec",
        "-i",
        CONTAINER_NAME,
        "psql",
        "-U",
        POSTGRES_USER,
        "-d",
        TEST_DB,
        "-v",
        "ON_ERROR_STOP=1",
        "-q",
      ]);
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => (stdout += d));
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stdout, stderr }));
      child.stdin.end(worker2Sql);
    });

    const [res1, res2] = await Promise.all([p1, p2]);

    assert.equal(res1.code, 0, `Worker 1 failed: ${res1.stderr}`);
    assert.notEqual(res2.code, 0, "Worker 2 should have been rejected due to lock serialization");
    assert.ok(res2.stderr.includes("SLOT_UNAVAILABLE") || res2.stderr.includes("P0001"));

    // Verify exact persisted counts
    const countCheck = runPsqlCommand(
      `SELECT count(*) FROM public.bookings WHERE court_id = '${activeCourtId}' AND booking_date = '${raceDate}';`
    );
    assert.equal(countCheck.stdout, "1", "Exactly one booking must exist from concurrent race");
  });

  // --- Group 8: Stage 2 Game-Day Status Tracking & Concurrency Tests ---

  await runTest("Stage 2: Check constraint permits game-day statuses and audit timestamps", () => {
    // 1. Verify audit columns exist
    const colCheck = runPsqlCommand(
      `SELECT column_name, data_type 
       FROM information_schema.columns 
       WHERE table_schema = 'public' 
         AND table_name = 'bookings' 
         AND column_name IN ('checked_in_at', 'started_at', 'completed_at', 'no_show_at')
       ORDER BY column_name;`
    );
    assert.ok(colCheck.stdout.includes("checked_in_at|timestamp with time zone"));
    assert.ok(colCheck.stdout.includes("started_at|timestamp with time zone"));
    assert.ok(colCheck.stdout.includes("completed_at|timestamp with time zone"));
    assert.ok(colCheck.stdout.includes("no_show_at|timestamp with time zone"));

    // 2. Inserting invalid status fails check constraint
    const invalidStatusRes = runPsqlCommand(
      `INSERT INTO public.bookings (
        user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount
      ) VALUES (
        '${aliceUid}', 'Alice Invalid', '${activeCourtId}', '2029-10-24', '08:00:00', '09:00:00', 'invalid_status', 200
      );`
    );
    assert.notEqual(invalidStatusRes.status, 0, "Invalid status should fail check constraint");
    assert.ok(invalidStatusRes.stderr.includes("bookings_status_check") || invalidStatusRes.stderr.includes("23514"));
  });

  await runTest("Stage 2: checked_in and in_progress statuses block conflicting online reservations", () => {
    const stage2TestDate = "2029-10-25"; // Thursday
    const slotStart = "08:00:00";
    const slotEnd = "09:00:00";

    // 1. Insert a booking with status = checked_in and checked_in_at timestamp
    const insertCheckedIn = runPsqlCommand(
      `INSERT INTO public.bookings (
        id, user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, checked_in_at
      ) VALUES (
        '10101010-1010-1010-1010-101010101010', '${aliceUid}', 'Alice CheckedIn', '${activeCourtId}', '${stage2TestDate}', '${slotStart}', '${slotEnd}', 'checked_in', 200, now()
      ) RETURNING id;`
    );
    assert.equal(insertCheckedIn.status, 0, insertCheckedIn.stderr);

    // 2. hold_court_booking must REJECT overlapping hold with SLOT_UNAVAILABLE (P0001)
    const holdRes1 = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage2TestDate}',
        p_start_time => '${slotStart}',
        p_end_time => '${slotEnd}',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(holdRes1.status, 0, "Online hold must be rejected when court is checked_in");
    assert.ok(holdRes1.stderr.includes("SLOT_UNAVAILABLE") || holdRes1.stderr.includes("P0001"));

    // 3. Transition booking to in_progress with started_at timestamp
    const updateInProgress = runPsqlCommand(
      `UPDATE public.bookings 
       SET status = 'in_progress', started_at = now() 
       WHERE id = '10101010-1010-1010-1010-101010101010';`
    );
    assert.equal(updateInProgress.status, 0, updateInProgress.stderr);

    // 4. hold_court_booking must STILL REJECT overlapping hold
    const holdRes2 = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage2TestDate}',
        p_start_time => '${slotStart}',
        p_end_time => '${slotEnd}',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(holdRes2.status, 0, "Online hold must be rejected when court is in_progress");
    assert.ok(holdRes2.stderr.includes("SLOT_UNAVAILABLE") || holdRes2.stderr.includes("P0001"));
  });

  await runTest("Stage 2: no_show status releases court slot immediately", () => {
    const stage2TestDate = "2029-10-26"; // Friday
    const slotStart = "10:00:00";
    const slotEnd = "11:00:00";

    // 1. Insert a booking with status = confirmed
    const insertConfirmed = runPsqlCommand(
      `INSERT INTO public.bookings (
        id, user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount
      ) VALUES (
        '20202020-2020-2020-2020-202020202020', '${aliceUid}', 'Alice NoShow', '${activeCourtId}', '${stage2TestDate}', '${slotStart}', '${slotEnd}', 'confirmed', 200
      ) RETURNING id;`
    );
    assert.equal(insertConfirmed.status, 0, insertConfirmed.stderr);

    // 2. Admin marks no_show with no_show_at timestamp
    const markNoShow = runPsqlCommand(
      `UPDATE public.bookings 
       SET status = 'no_show', no_show_at = now() 
       WHERE id = '20202020-2020-2020-2020-202020202020';`
    );
    assert.equal(markNoShow.status, 0, markNoShow.stderr);

    // 3. Slot is released: Bob can now hold this court slot successfully
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage2TestDate}',
        p_start_time => '${slotStart}',
        p_end_time => '${slotEnd}',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(holdRes.status, 0, `Bob should be able to book released no-show slot: ${holdRes.stderr}`);
    const holdBookingId = JSON.parse(holdRes.stdout).booking_id;
    assert.ok(holdBookingId, "Expected valid booking_id returned after court released from no_show");
  });

  // --- Group 9: Stage 1 Hold Expiry & Checkout Compatibility Tests ---

  const stage1TestDate = "2029-10-27"; // Saturday (open 07:00 - 22:00)

  await runTest("Stage 1: Legacy 6-argument hold_court_booking succeeds and sets 35m hold_expires_at buffer", () => {
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}',
        '${stage1TestDate}',
        '08:00:00',
        '09:00:00',
        '${aliceUid}',
        200
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, `6-arg hold_court_booking must succeed: ${holdRes.stderr}`);
    const parsed = JSON.parse(holdRes.stdout);
    assert.ok(parsed.booking_id, "Expected booking_id");
    assert.ok(parsed.hold_expires_at, "Expected hold_expires_at returned");

    // Direct DB invariant verification: hold_expires_at must be between +33m and +36m
    const dbCheck = runPsqlCommand(
      `SELECT (hold_expires_at > (created_at + interval '33 minutes') AND hold_expires_at <= (created_at + interval '36 minutes'))::text
       FROM public.bookings WHERE id = '${parsed.booking_id}';`
    );
    assert.equal(dbCheck.stdout, "true", "Legacy 6-arg call must set safe 35m expiry buffer");
  });

  await runTest("Stage 1: New 7-argument hold_court_booking sets exact p_hold_expires_at within the 40-minute customer window", () => {
    const explicitExpiry = runPsqlCommand(`SELECT date_trunc('second', now() + interval '33 minutes');`).stdout;
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '10:00:00',
        p_end_time => '11:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200,
        p_hold_expires_at => '${explicitExpiry}'::timestamptz
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, `7-arg hold_court_booking must succeed: ${holdRes.stderr}`);
    const parsed = JSON.parse(holdRes.stdout);
    assert.ok(parsed.booking_id, "Expected booking_id");

    const dbCheck = runPsqlCommand(
      `SELECT (hold_expires_at = '${explicitExpiry}'::timestamptz)::text
       FROM public.bookings WHERE id = '${parsed.booking_id}';`
    );
    assert.equal(dbCheck.stdout, "true", "7-arg call must preserve exact passed hold_expires_at");
  });

  await runTest("20261102: customer cannot hold or extend a slot beyond 40 minutes (indefinite-hold attack)", () => {
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '2029-11-03', '15:00:00', '16:00:00',
        '${aliceUid}', 200, '2099-01-01 00:00:00+00'::timestamptz);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id: bookingId, payment_id: paymentId } = JSON.parse(holdRes.stdout);

    const clamped = runPsqlCommand(
      `SELECT (hold_expires_at <= now() + interval '40 minutes')::text FROM public.bookings WHERE id = '${bookingId}';`
    );
    assert.equal(clamped.stdout, "true", "hold_court_booking must clamp customer-supplied expiry");

    const extendRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold('${bookingId}', '${paymentId}', 'cs_clamp_1', '2099-01-01 00:00:00+00'::timestamptz);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(extendRes.status, 0, extendRes.stderr);
    const extended = runPsqlCommand(
      `SELECT (hold_expires_at <= now() + interval '40 minutes')::text FROM public.bookings WHERE id = '${bookingId}';`
    );
    assert.equal(extended.stdout, "true", "confirm_checkout_hold must clamp customer-supplied expiry");

    // Service role (webhooks/cron) keeps full control
    const svcRes = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '2029-11-03', '17:00:00', '18:00:00',
        '${bobUid}', 200, now() + interval '2 hours');`,
      { role: "service_role" }
    );
    assert.equal(svcRes.status, 0, svcRes.stderr);
    const svcCheck = runPsqlCommand(
      `SELECT (hold_expires_at > now() + interval '90 minutes')::text FROM public.bookings WHERE id = '${JSON.parse(svcRes.stdout).booking_id}';`
    );
    assert.equal(svcCheck.stdout, "true", "service_role expiry must not be clamped");
  });

  await runTest("20261102: customer cannot hold more than 3 active slots", () => {
    for (const [start, end] of [["07:00:00", "08:00:00"], ["08:00:00", "09:00:00"], ["09:00:00", "10:00:00"]]) {
      const r = runPsqlCommand(
        `SELECT public.hold_court_booking('${activeCourtId}', '2029-10-30', '${start}', '${end}', '${bobUid}', 200);`,
        { role: "authenticated", uid: bobUid }
      );
      assert.equal(r.status, 0, r.stderr);
    }
    const fourth = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '2029-10-30', '11:00:00', '12:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(fourth.status, 0, "4th active hold must be rejected");
    assert.ok(fourth.stderr.includes("TOO_MANY_HOLDS"), fourth.stderr);

    // Once a hold expires, the customer can hold again
    runPsqlCommand(
      `UPDATE public.bookings SET hold_expires_at = now() - interval '1 second'
       WHERE user_id = '${bobUid}' AND booking_date = '2029-10-30' AND start_time = '07:00:00';`
    );
    const afterExpiry = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '2029-10-30', '11:00:00', '12:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(afterExpiry.status, 0, afterExpiry.stderr);
  });

  await runTest("Stage 1: Active unexpired pending hold blocks overlapping reservations", () => {
    // 1. Alice creates pending hold for 12:00 - 14:00 with future expiry (+30m)
    const holdResAlice = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '12:00:00',
        p_end_time => '14:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 400,
        p_hold_expires_at => (now() + interval '30 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdResAlice.status, 0, holdResAlice.stderr);

    // 2. Bob attempts to hold overlapping slot 13:00 - 15:00
    const holdResBob = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '13:00:00',
        p_end_time => '15:00:00',
        p_user_id => '${bobUid}',
        p_amount => 400
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(holdResBob.status, 0, "Unexpired pending hold must block overlapping reservation");
    assert.ok(holdResBob.stderr.includes("SLOT_UNAVAILABLE") || holdResBob.stderr.includes("P0001"));
  });

  await runTest("Stage 1: Expired pending hold does NOT block new reservations once its grace period has passed", () => {
    // 1. Insert a pending hold for 15:00 - 16:00 that expired longer ago than the 20-minute grace period
    const expiredInsert = runPsqlCommand(
      `INSERT INTO public.bookings (
        user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at
      ) VALUES (
        '${aliceUid}', 'Alice Expired', '${activeCourtId}', '${stage1TestDate}', '15:00:00', '16:00:00', 'pending', 200, now() - interval '25 minutes', now() - interval '60 minutes'
      ) RETURNING id;`
    );
    assert.equal(expiredInsert.status, 0, expiredInsert.stderr);

    // 2. Bob attempts to hold the same slot 15:00 - 16:00
    const holdResBob = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '15:00:00',
        p_end_time => '16:00:00',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(holdResBob.status, 0, `Expired pending hold must not block slot: ${holdResBob.stderr}`);
    const parsed = JSON.parse(holdResBob.stdout);
    assert.ok(parsed.booking_id, "Bob must receive valid booking_id over expired hold");
  });

  await runTest("Stage 1: Pre-creation failure cleanup frees slot immediately", () => {
    // 1. Create a hold for 17:00 - 18:00
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '17:00:00',
        p_end_time => '18:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id, payment_id } = JSON.parse(holdRes.stdout);

    // 2. Simulate pre-creation failure cleanup (e.g. StripeInvalidRequestError / auth failure)
    const cleanupRes = runPsqlCommand(
      `DELETE FROM public.payments WHERE id = '${payment_id}';
       DELETE FROM public.bookings WHERE id = '${booking_id}';`
    );
    assert.equal(cleanupRes.status, 0, cleanupRes.stderr);

    // 3. Slot 17:00 - 18:00 can be immediately held by another customer
    const retryRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '17:00:00',
        p_end_time => '18:00:00',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(retryRes.status, 0, `Slot must be free after pre-creation failure cleanup: ${retryRes.stderr}`);
    assert.ok(JSON.parse(retryRes.stdout).booking_id, "Bob must receive valid booking_id");
  });

  await runTest("Stage 1: Coordinated hold update (session.expires_at + 120s) protects slot then frees upon expiry", () => {
    // 1. Initial RPC hold creates pending hold for 18:00 - 19:00 with initial 33m buffer
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '18:00:00',
        p_end_time => '19:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200,
        p_hold_expires_at => (now() + interval '33 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id } = JSON.parse(holdRes.stdout);

    // 2. Coordinated update after Stripe session creation: hold_expires_at aligned to session.expires_at + 120s
    const updateRes = runPsqlCommand(
      `UPDATE public.bookings
       SET hold_expires_at = now() + interval '33 minutes'
       WHERE id = '${booking_id}';`
    );
    assert.equal(updateRes.status, 0, updateRes.stderr);

    // 3. Bob attempts to hold overlapping slot while unexpired -> blocked
    const conflictRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '18:00:00',
        p_end_time => '19:00:00',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(conflictRes.status, 0, "Unexpired coordinated hold must block conflict");

    // 4. Simulate time passing past coordinated hold expiry (e.g. checkout abandoned)
    const expireRes = runPsqlCommand(
      `UPDATE public.bookings
       SET hold_expires_at = now() - interval '1 second'
       WHERE id = '${booking_id}';`
    );
    assert.equal(expireRes.status, 0, expireRes.stderr);

    // 4b. Just expired: still inside the 20-minute grace period, so a late Stripe webhook can still confirm it
    const graceRes = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${stage1TestDate}', '18:00:00', '19:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(graceRes.status, 0, "A hold inside its grace period must still block the slot");
    assert.ok(graceRes.stderr.includes("SLOT_UNAVAILABLE"), graceRes.stderr);
    runPsqlCommand(`UPDATE public.bookings SET hold_expires_at = now() - interval '21 minutes' WHERE id = '${booking_id}';`);

    // 5. Bob attempts to hold the same slot -> succeeds once the grace period has passed, proving expired hold does not permanently block
    const unblockRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '18:00:00',
        p_end_time => '19:00:00',
        p_user_id => '${bobUid}',
        p_amount => 200
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(unblockRes.status, 0, `Expired hold must not block: ${unblockRes.stderr}`);
    assert.ok(JSON.parse(unblockRes.stdout).booking_id, "Bob must receive valid booking_id after hold expiry");
  });

  await runTest("Stage 1: confirm_checkout_hold atomically updates hold_expires_at and stripe_session_id", () => {
    // 1. Create a hold for 20:00 - 21:00
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '20:00:00',
        p_end_time => '21:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200,
        p_hold_expires_at => (now() + interval '35 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id, payment_id } = JSON.parse(holdRes.stdout);

    // 2. Confirm hold with Stripe session ID
    // Within the 40-minute customer window (20261102), so the exact value is kept
    const newExpiry = runPsqlCommand(`SELECT date_trunc('second', now() + interval '35 minutes');`).stdout;
    const confirmRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        p_booking_id => '${booking_id}',
        p_payment_id => '${payment_id}',
        p_stripe_session_id => 'cs_test_123456789',
        p_hold_expires_at => '${newExpiry}'::timestamptz
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(confirmRes.status, 0, confirmRes.stderr);

    // Verify DB state
    const checkRes = runPsqlCommand(
      `SELECT b.hold_expires_at = '${newExpiry}'::timestamptz, p.stripe_session_id
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
       WHERE b.id = '${booking_id}';`
    );
    assert.equal(checkRes.stdout, "t|cs_test_123456789");
  });

  await runTest("Stage 1: confirm_checkout_hold PREVENTS expired-hold resurrection when slot is claimed by another user", () => {
    // 1. Alice creates hold for 21:00 - 22:00
    const holdResAlice = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '21:00:00',
        p_end_time => '22:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200,
        p_hold_expires_at => (now() + interval '35 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdResAlice.status, 0, holdResAlice.stderr);
    const { booking_id: aliceBookingId, payment_id: alicePaymentId } = JSON.parse(holdResAlice.stdout);

    // 2. Alice's hold expires before Stripe session creation finishes
    const expireAlice = runPsqlCommand(
      `UPDATE public.bookings SET hold_expires_at = now() - interval '21 minutes' WHERE id = '${aliceBookingId}';`
    );
    assert.equal(expireAlice.status, 0, expireAlice.stderr);

    // 3. Bob claims the slot for 21:00 - 22:00 (succeeds because Alice's hold is expired)
    const holdResBob = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '${stage1TestDate}',
        p_start_time => '21:00:00',
        p_end_time => '22:00:00',
        p_user_id => '${bobUid}',
        p_amount => 200,
        p_hold_expires_at => (now() + interval '35 minutes')
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(holdResBob.status, 0, holdResBob.stderr);
    const { booking_id: bobBookingId } = JSON.parse(holdResBob.stdout);
    assert.ok(bobBookingId, "Bob successfully secured the slot");

    // 4. Alice's delayed process attempts confirm_checkout_hold -> MUST BE REJECTED with SLOT_UNAVAILABLE!
    const aliceResurrectAttempt = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        p_booking_id => '${aliceBookingId}',
        p_payment_id => '${alicePaymentId}',
        p_stripe_session_id => 'cs_test_late_resurrect',
        p_hold_expires_at => (now() + interval '33 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(aliceResurrectAttempt.status, 0, "Resurrecting an expired hold after slot is claimed MUST fail");
    // Since 20261102 Bob's hold releases (cancels) Alice's expired hold, so the attempt fails INVALID_STATUS
    assert.ok(
      aliceResurrectAttempt.stderr.includes("SLOT_UNAVAILABLE") || aliceResurrectAttempt.stderr.includes("INVALID_STATUS"),
      `Expected SLOT_UNAVAILABLE or INVALID_STATUS error, got: ${aliceResurrectAttempt.stderr}`
    );
    const aliceStatus = runPsqlCommand(`SELECT b.status || '|' || p.status FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${aliceBookingId}';`);
    assert.equal(aliceStatus.stdout, "cancelled|failed", "Expired overlapping hold is released when Bob claims the slot");

    // 5. Verify Bob's booking is completely unharmed and Alice's hold was NOT updated
    const verifyBob = runPsqlCommand(
      `SELECT status FROM public.bookings WHERE id = '${bobBookingId}';`
    );
    assert.equal(verifyBob.stdout, "pending", "Bob's booking must remain active and pending");

    const verifyAlice = runPsqlCommand(
      `SELECT (hold_expires_at < now()), (p.stripe_session_id IS NULL)
       FROM public.bookings b
       JOIN public.payments p ON p.booking_id = b.id
       WHERE b.id = '${aliceBookingId}';`
    );
    assert.equal(verifyAlice.stdout, "t|t", "Alice's hold must remain expired and session ID must remain NULL");
  });

  await runTest("Stage 1: confirm_checkout_hold enforces authentication and ownership", () => {
    // 1. Alice creates a hold
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        p_court_id => '${activeCourtId}',
        p_booking_date => '2029-10-28',
        p_start_time => '08:00:00',
        p_end_time => '09:00:00',
        p_user_id => '${aliceUid}',
        p_amount => 200,
        p_hold_expires_at => (now() + interval '35 minutes')
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id, payment_id } = JSON.parse(holdRes.stdout);

    // 2. Anonymous caller is rejected
    const anonRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_test_anon', now() + interval '33 minutes'
      );`,
      { role: "anon" }
    );
    assert.notEqual(anonRes.status, 0, "Anonymous caller must be rejected");

    // 3. Bob trying to confirm Alice's hold is rejected with FORBIDDEN (42501)
    const bobRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_test_bob', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(bobRes.status, 0, "Bob confirming Alice's hold must be rejected");
    assert.ok(bobRes.stderr.includes("FORBIDDEN") || bobRes.stderr.includes("42501"));
  });

  const conflictAuditDate = "2029-10-31"; // Wednesday (open 07:00 - 22:00)

  await runTest("Stage 1: confirm_checkout_hold blocks on in_progress, checked_in, and completed conflicting statuses", () => {
    const testStatuses = ["in_progress", "checked_in", "completed"];

    for (let i = 0; i < testStatuses.length; i++) {
      const statusToTest = testStatuses[i];
      const startH = 10 + i;
      const endH = startH + 1;
      const timeStart = `${startH}:00:00`;
      const timeEnd = `${endH}:00:00`;

      // 1. Insert Alice's pending booking
      const aliceHold = runPsqlCommand(
        `SELECT public.hold_court_booking(
          '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${aliceUid}', 200, now() - interval '21 minutes'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.equal(aliceHold.status, 0, aliceHold.stderr);
      const { booking_id: aBookingId, payment_id: aPaymentId } = JSON.parse(aliceHold.stdout);

      // 2. A conflicting booking with the target status cannot coexist with Alice's pending row:
      //    the hosted no_overlapping_active_court_bookings constraint rejects it outright.
      const bobBooking = runPsqlCommand(
        `INSERT INTO public.bookings (
          user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, created_at
        ) VALUES (
          '${bobUid}', 'Bob Status Test', '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${statusToTest}', 200, now()
        ) RETURNING id;`
      );
      assert.notEqual(bobBooking.status, 0, `Overlapping '${statusToTest}' row must be rejected while a pending hold exists`);
      assert.ok(bobBooking.stderr.includes("no_overlapping_active_court_bookings"), bobBooking.stderr);

      // 3. Bob claims the slot the supported way; Alice's expired hold is released, so she cannot resurrect it
      const bobHold = runPsqlCommand(
        `SELECT public.hold_court_booking('${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${bobUid}', 200);`,
        { role: "authenticated", uid: bobUid }
      );
      assert.equal(bobHold.status, 0, bobHold.stderr);
      runPsqlCommand(`UPDATE public.bookings SET status = '${statusToTest}' WHERE id = '${JSON.parse(bobHold.stdout).booking_id}';`);

      const confirmAttempt = runPsqlCommand(
        `SELECT public.confirm_checkout_hold(
          '${aBookingId}', '${aPaymentId}', 'cs_test_status_${statusToTest}', now() + interval '33 minutes'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.notEqual(confirmAttempt.status, 0, `confirm_checkout_hold must reject conflict with status '${statusToTest}'`);
      assert.ok(
        confirmAttempt.stderr.includes("SLOT_UNAVAILABLE") || confirmAttempt.stderr.includes("INVALID_STATUS"),
        `Expected SLOT_UNAVAILABLE or INVALID_STATUS, got: ${confirmAttempt.stderr}`
      );
    }
  });

  await runTest("Stage 1: confirm_checkout_hold permits extension when overlapping booking is cancelled or no_show", () => {
    const nonBlockingStatuses = ["cancelled", "no_show"];

    for (let i = 0; i < nonBlockingStatuses.length; i++) {
      const statusToTest = nonBlockingStatuses[i];
      const startH = 14 + i;
      const endH = startH + 1;
      const timeStart = `${startH}:00:00`;
      const timeEnd = `${endH}:00:00`;

      // 1. Insert Bob's booking with non-blocking status
      const bobBooking = runPsqlCommand(
        `INSERT INTO public.bookings (
          user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, created_at
        ) VALUES (
          '${bobUid}', 'Bob Inactive Test', '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${statusToTest}', 200, now()
        ) RETURNING id;`
      );
      assert.equal(bobBooking.status, 0, bobBooking.stderr);

      // 2. Alice holds and confirms slot -> MUST SUCCEED
      const aliceHold = runPsqlCommand(
        `SELECT public.hold_court_booking(
          '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${aliceUid}', 200, now() + interval '35 minutes'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.equal(aliceHold.status, 0, aliceHold.stderr);
      const { booking_id: aBookingId, payment_id: aPaymentId } = JSON.parse(aliceHold.stdout);

      const confirmAttempt = runPsqlCommand(
        `SELECT public.confirm_checkout_hold(
          '${aBookingId}', '${aPaymentId}', 'cs_test_nonblocking_${statusToTest}', now() + interval '33 minutes'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.equal(confirmAttempt.status, 0, `confirm_checkout_hold must allow booking over '${statusToTest}': ${confirmAttempt.stderr}`);
    }
  });

  await runTest("Stage 1: Distinct RPC error classification distinguishes COURT_UNAVAILABLE, INVALID_STATUS, and NOT_FOUND from SLOT_UNAVAILABLE", () => {
    // 1. COURT_UNAVAILABLE: Booking created on court that is then set to maintenance
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${conflictAuditDate}', '17:00:00', '18:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id, payment_id } = JSON.parse(holdRes.stdout);

    // Set court to maintenance
    runPsqlCommand(`UPDATE public.courts SET status = 'maintenance' WHERE id = '${activeCourtId}';`);

    const courtUnavailRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_maint', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(courtUnavailRes.status, 0);
    assert.ok(courtUnavailRes.stderr.includes("COURT_UNAVAILABLE"), "Must raise COURT_UNAVAILABLE");
    assert.ok(!courtUnavailRes.stderr.includes("SLOT_UNAVAILABLE"), "COURT_UNAVAILABLE must not be confused with SLOT_UNAVAILABLE");

    // Restore court to active
    runPsqlCommand(`UPDATE public.courts SET status = 'active' WHERE id = '${activeCourtId}';`);

    // 2. INVALID_STATUS: Booking that was already cancelled cannot be confirmed
    runPsqlCommand(`UPDATE public.bookings SET status = 'cancelled' WHERE id = '${booking_id}';`);
    const invalidStatusRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_cancelled', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(invalidStatusRes.status, 0);
    assert.ok(invalidStatusRes.stderr.includes("INVALID_STATUS"), "Must raise INVALID_STATUS");
    assert.ok(!invalidStatusRes.stderr.includes("SLOT_UNAVAILABLE"), "INVALID_STATUS must not be confused with SLOT_UNAVAILABLE");

    // 3. NOT_FOUND: Nonexistent booking id
    const notFoundRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '00000000-0000-0000-0000-000000000000', '${payment_id}', 'cs_notfound', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(notFoundRes.status, 0);
    assert.ok(notFoundRes.stderr.includes("NOT_FOUND"), "Must raise NOT_FOUND");
    assert.ok(!notFoundRes.stderr.includes("SLOT_UNAVAILABLE"), "NOT_FOUND must not be confused with SLOT_UNAVAILABLE");

    // 4. NOT_FOUND: Nonexistent or mismatched payment id
    const newHold = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${conflictAuditDate}', '18:00:00', '19:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(newHold.status, 0, newHold.stderr);
    const { booking_id: bId4, payment_id: pId4 } = JSON.parse(newHold.stdout);

    const mismatchedPaymentRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${bId4}', '00000000-0000-0000-0000-000000000000', 'cs_mismatch', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(mismatchedPaymentRes.status, 0);
    assert.ok(mismatchedPaymentRes.stderr.includes("NOT_FOUND"), "Must raise NOT_FOUND for mismatched payment");
    assert.ok(mismatchedPaymentRes.stderr.includes("Payment"), "Must identify payment in error message");

    // 5. INVALID_STATUS: Payment that is not pending cannot be confirmed
    runPsqlCommand(`UPDATE public.payments SET status = 'paid' WHERE id = '${pId4}';`);
    const invalidPaymentStatusRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${bId4}', '${pId4}', 'cs_paid', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(invalidPaymentStatusRes.status, 0);
    assert.ok(invalidPaymentStatusRes.stderr.includes("INVALID_STATUS"), "Must raise INVALID_STATUS for non-pending payment");
    assert.ok(invalidPaymentStatusRes.stderr.includes("Payment is not pending"), "Must identify payment status in error message");
  });

  await runTest("Stage 1: confirm_checkout_hold defensive input validation rejects NULL/blank session IDs and NULL/past expiry timestamps", () => {
    // 1. Create a valid pending hold
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${conflictAuditDate}', '19:00:00', '20:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id, payment_id } = JSON.parse(holdRes.stdout);

    // 2. Reject NULL session ID
    const nullSessionRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', NULL, now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(nullSessionRes.status, 0);
    assert.ok(nullSessionRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for NULL session ID");
    assert.ok(nullSessionRes.stderr.includes("p_stripe_session_id cannot be empty"), "Must explain session ID cannot be empty");

    // 3. Reject empty string session ID
    const emptySessionRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', '', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(emptySessionRes.status, 0);
    assert.ok(emptySessionRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for empty session ID");

    // 4. Reject whitespace-only session ID
    const blankSessionRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', '   ', now() + interval '33 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(blankSessionRes.status, 0);
    assert.ok(blankSessionRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for blank session ID");

    // 5. Reject NULL expiry timestamp
    const nullExpiryRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_valid_session_id', NULL
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(nullExpiryRes.status, 0);
    assert.ok(nullExpiryRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for NULL expiry timestamp");
    assert.ok(nullExpiryRes.stderr.includes("p_hold_expires_at must be in the future"), "Must explain expiry must be in the future");

    // 6. Reject past expiry timestamp
    const pastExpiryRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_valid_session_id', now() - interval '1 minute'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(pastExpiryRes.status, 0);
    assert.ok(pastExpiryRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for past expiry timestamp");
    assert.ok(pastExpiryRes.stderr.includes("p_hold_expires_at must be in the future"), "Must explain expiry must be in the future");

    // 7. Reject clock_timestamp() past timestamp
    const clockPastExpiryRes = runPsqlCommand(
      `SELECT public.confirm_checkout_hold(
        '${booking_id}', '${payment_id}', 'cs_valid_session_id', clock_timestamp() - interval '5 seconds'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(clockPastExpiryRes.status, 0);
    assert.ok(clockPastExpiryRes.stderr.includes("INVALID_ARGUMENT"), "Must raise INVALID_ARGUMENT for clock_timestamp() past timestamp");

    // 8. Verify no database mutation occurred: payment stripe_session_id remains NULL
    const paymentCheck = runPsqlCommand(
      `SELECT stripe_session_id FROM public.payments WHERE id = '${payment_id}';`
    );
    assert.equal(paymentCheck.status, 0);
    assert.equal(paymentCheck.stdout, "", "Payment stripe_session_id must remain untouched after failed validation");
  });

  // --- Group 5: Phase 2 Payment Reconciliation & Refund Ledger Tests ---
  const phase2Date = "2029-11-06"; // Tuesday (open 07:00 - 22:00)

  await runTest("Phase 2: cancel_expired_booking respects unexpired hold and cancels expired hold atomically", () => {
    // 1. Unexpired hold: hold_expires_at is future -> cancel_expired_booking MUST NOT cancel
    const holdFuture = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '07:00:00', '08:00:00', '${aliceUid}', 200, now() + interval '30 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdFuture.status, 0, holdFuture.stderr);
    const { booking_id: bFuture, payment_id: pFuture } = JSON.parse(holdFuture.stdout);

    const cancelFutureRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bFuture}', '${pFuture}');`,
      { role: "service_role" }
    );
    assert.equal(cancelFutureRes.status, 0, cancelFutureRes.stderr);
    const cancelFutureObj = JSON.parse(cancelFutureRes.stdout);
    assert.equal(cancelFutureObj.cancelled, false, "Must not cancel unexpired hold");
    assert.equal(cancelFutureObj.reason, "HOLD_NOT_EXPIRED");

    // 2. Expired hold: hold_expires_at is past -> cancel_expired_booking MUST cancel atomically
    const holdPast = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '08:00:00', '09:00:00', '${aliceUid}', 200, now() - interval '2 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdPast.status, 0, holdPast.stderr);
    const { booking_id: bPast, payment_id: pPast } = JSON.parse(holdPast.stdout);

    const cancelPastRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bPast}', '${pPast}');`,
      { role: "service_role" }
    );
    assert.equal(cancelPastRes.status, 0, cancelPastRes.stderr);
    const cancelPastObj = JSON.parse(cancelPastRes.stdout);
    assert.equal(cancelPastObj.cancelled, true, "Must cancel expired hold");

    // Verify DB states: booking cancelled, payment failed
    const checkPastB = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bPast}';`);
    assert.equal(checkPastB.stdout.trim(), "cancelled");
    const checkPastP = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${pPast}';`);
    assert.equal(checkPastP.stdout.trim(), "failed");
  });

  await runTest("Phase 2: settle_counter_payment atomically confirms booking and settles payment with role check and past-slot validation", () => {
    // 1. Setup pending booking for 09:00 - 10:00
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '09:00:00', '10:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(holdRes.status, 0, holdRes.stderr);
    const { booking_id: bId, payment_id: pId } = JSON.parse(holdRes.stdout);

    // Non-admin caller rejected with 42501
    const nonAdminSettle = runPsqlCommand(
      `SELECT public.settle_counter_payment('${bId}', '${pId}', 'cash', 'REC-001');`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(nonAdminSettle.status, 0, "Non-admin caller must be rejected");
    assert.ok(nonAdminSettle.stderr.includes("FORBIDDEN") || nonAdminSettle.stderr.includes("42501"));

    // Admin settles with cash
    const adminSettle = runPsqlCommand(
      `SELECT public.settle_counter_payment('${bId}', '${pId}', 'cash', 'REC-001');`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(adminSettle.status, 0, adminSettle.stderr);
    const adminSettleObj = JSON.parse(adminSettle.stdout);
    assert.equal(adminSettleObj.success, true);

    // Verify atomic confirmation
    const checkB = runPsqlCommand(`SELECT status, hold_expires_at IS NULL FROM public.bookings WHERE id = '${bId}';`);
    assert.equal(checkB.stdout.trim(), "confirmed|t");
    const checkP = runPsqlCommand(`SELECT status, payment_method, payment_reference FROM public.payments WHERE id = '${pId}';`);
    assert.equal(checkP.stdout.trim(), "paid|cash|REC-001");
  });

  await runTest("Phase 2: reserve_payment_refund enforces full-refund-only, parameter tuples, and cap", () => {
    // Setup confirmed booking with payment of 200 PHP
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '10:00:00', '11:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId, payment_id: pId } = JSON.parse(holdRes.stdout);
    runPsqlCommand(`UPDATE public.payments SET status = 'paid', stripe_payment_id = 'pi_test_reserve_1' WHERE id = '${pId}';`);

    // 1. Partial refund rejected with FULL_REFUND_ONLY (22000)
    const partialRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 100, 'php', 'stripe', 'PARTIAL', 'key_part_1', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.notEqual(partialRes.status, 0);
    assert.ok(partialRes.stderr.includes("FULL_REFUND_ONLY") || partialRes.stderr.includes("22000"));

    // 2. Blank idempotency key rejected
    const blankKeyRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'REFUND', '   ', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.notEqual(blankKeyRes.status, 0);
    assert.ok(blankKeyRes.stderr.includes("INVALID_ARGUMENT"));

    // 3. Successful full refund reservation
    const validRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'REFUND', 'key_valid_1', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.equal(validRes.status, 0, validRes.stderr);
    const validObj = JSON.parse(validRes.stdout);
    assert.equal(validObj.success, true);
    assert.equal(validObj.idempotent, false);

    // 4. Exact replay with same key returns idempotent success
    const replayRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'REFUND', 'key_valid_1', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.equal(replayRes.status, 0, replayRes.stderr);
    const replayObj = JSON.parse(replayRes.stdout);
    assert.equal(replayObj.success, true);
    assert.equal(replayObj.idempotent, true);

    // 5. Conflicting replay with different reason rejected with IDEMPOTENCY_KEY_CONFLICT
    const conflictKeyRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'DIFFERENT_REASON', 'key_valid_1', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.notEqual(conflictKeyRes.status, 0);
    assert.ok(conflictKeyRes.stderr.includes("IDEMPOTENCY_KEY_CONFLICT"));

    // 6. Cumulative cap exceeded: second reservation on same payment rejected
    const capRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'ANOTHER_REFUND', 'key_valid_2', 'pi_test_reserve_1');`,
      { role: "service_role" }
    );
    assert.notEqual(capRes.status, 0);
    assert.ok(capRes.stderr.includes("REFUND_CAP_EXCEEDED"));
  });

  await runTest("Phase 2: reconcile_booking_payment normal confirmation, duplicate PaymentIntent isolation, and cash protection", () => {
    // 1. Normal confirmation on pending booking
    const holdRes1 = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '11:00:00', '12:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId1, payment_id: pId1 } = JSON.parse(holdRes1.stdout);

    const confirmRes = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bId1}', '${pId1}', 'cs_norm_1', 'pi_norm_1', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(confirmRes.status, 0, confirmRes.stderr);
    const confirmObj = JSON.parse(confirmRes.stdout);
    assert.equal(confirmObj.action, "CONFIRMED");

    // Exact redelivery returns ALREADY_CONFIRMED
    const redeliveryRes = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bId1}', '${pId1}', 'cs_norm_1', 'pi_norm_1', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(redeliveryRes.status, 0);
    assert.equal(JSON.parse(redeliveryRes.stdout).action, "NO_OP");

    // 2. Cash-confirmed booking receiving duplicate Stripe payment -> isolates duplicate payment, protects cash
    const holdRes2 = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '12:00:00', '13:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId2, payment_id: pId2 } = JSON.parse(holdRes2.stdout);
    // Settle via cash
    runPsqlCommand(`SELECT public.settle_counter_payment('${bId2}', '${pId2}', 'cash', 'REC-CASH-99');`, { role: "authenticated", uid: adminUid });

    // Customer completes an online Stripe checkout (cs_dup_stripe, pi_dup_stripe)
    const dupRes = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bId2}', '${pId2}', 'cs_dup_stripe', 'pi_dup_stripe', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(dupRes.status, 0, dupRes.stderr);
    const dupObj = JSON.parse(dupRes.stdout);
    assert.equal(dupObj.action, "REFUND_SCHEDULED");
    assert.equal(dupObj.reason, "DUPLICATE_PAYMENT");
    assert.notEqual(dupObj.payment_id, pId2, "Must create a distinct duplicate payment record");

    // Verify original cash payment remains untouched
    const checkCashP = runPsqlCommand(`SELECT status, payment_method, stripe_payment_id FROM public.payments WHERE id = '${pId2}';`);
    assert.equal(checkCashP.stdout.trim(), "paid|cash|");
  });

  await runTest("Phase 2: settle_stripe_refund verifies settlement, rejects mismatched PI, and enforces nonterminal processing state", () => {
    // Setup confirmed booking with reservation
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '13:00:00', '14:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId, payment_id: pId } = JSON.parse(holdRes.stdout);
    runPsqlCommand(`UPDATE public.payments SET status = 'paid', stripe_payment_id = 'pi_settle_test' WHERE id = '${pId}';`);

    const reserveRes = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId}', '${bId}', 200, 'php', 'stripe', 'TEST_SETTLE', 'key_settle_1', 'pi_settle_test');`,
      { role: "service_role" }
    );
    const { refund_request_id: reqId } = JSON.parse(reserveRes.stdout);

    // 1. Mismatched PaymentIntent rejected
    const mismatchPiRes = runPsqlCommand(
      `SELECT public.settle_stripe_refund('${reqId}', 're_test_1', 'succeeded', 'pi_wrong', 200, 'php');`,
      { role: "service_role" }
    );
    assert.notEqual(mismatchPiRes.status, 0);
    assert.ok(mismatchPiRes.stderr.includes("MISMATCHED_PAYMENT_INTENT"));

    // 2. Stripe status 'pending' / 'processing' -> NONTERMINAL: payment remains 'paid'
    const nonterminalRes = runPsqlCommand(
      `SELECT public.settle_stripe_refund('${reqId}', 're_test_1', 'pending', 'pi_settle_test', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(nonterminalRes.status, 0, nonterminalRes.stderr);
    const nonterminalObj = JSON.parse(nonterminalRes.stdout);
    assert.equal(nonterminalObj.status, "processing");
    assert.equal(nonterminalObj.payment_status, "paid");

    const checkP1 = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${pId}';`);
    assert.equal(checkP1.stdout.trim(), "paid", "Payment must remain paid while refund is nonterminal");

    // 3. Stripe status 'succeeded' with verified refund ID -> TERMINAL: payment becomes 'refunded'
    const succeededRes = runPsqlCommand(
      `SELECT public.settle_stripe_refund('${reqId}', 're_test_1', 'succeeded', 'pi_settle_test', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(succeededRes.status, 0, succeededRes.stderr);
    const succeededObj = JSON.parse(succeededRes.stdout);
    assert.equal(succeededObj.status, "succeeded");
    assert.equal(succeededObj.payment_status, "refunded");

    const checkP2 = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${pId}';`);
    assert.equal(checkP2.stdout.trim(), "refunded", "Payment must become refunded upon verified completion");

    // 4. Duplicate stripe_refund_id on another reservation rejected
    const holdRes2 = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '14:00:00', '15:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId2, payment_id: pId2 } = JSON.parse(holdRes2.stdout);
    runPsqlCommand(`UPDATE public.payments SET status = 'paid', stripe_payment_id = 'pi_settle_test_2' WHERE id = '${pId2}';`);
    const reserveRes2 = runPsqlCommand(
      `SELECT public.reserve_payment_refund('${pId2}', '${bId2}', 200, 'php', 'stripe', 'TEST_SETTLE_2', 'key_settle_2', 'pi_settle_test_2');`,
      { role: "service_role" }
    );
    const { refund_request_id: reqId2 } = JSON.parse(reserveRes2.stdout);

    const dupRefundIdRes = runPsqlCommand(
      `SELECT public.settle_stripe_refund('${reqId2}', 're_test_1', 'succeeded', 'pi_settle_test_2', 200, 'php');`,
      { role: "service_role" }
    );
    assert.notEqual(dupRefundIdRes.status, 0);
    assert.ok(dupRefundIdRes.stderr.includes("DUPLICATE_STRIPE_REFUND_ID"));
  });

  await runTest("Phase 2: True two-session competing cross-booking PaymentIntent contention", async () => {
    // Booking A with cash payment PA
    const bResA = runPsqlCommand(`
      INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount)
      VALUES ('${aliceUid}', '${activeCourtId}', '${phase2Date}', '15:00:00', '16:00:00', 'confirmed', 200) RETURNING id;
    `);
    const bIdA = bResA.stdout.trim();
    const pResA = runPsqlCommand(`
      INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, stripe_payment_id, paid_at)
      VALUES ('${bIdA}', 200, 'php', 'paid', 'cash', NULL, now()) RETURNING id;
    `);
    const pIdA = pResA.stdout.trim();

    // Booking B with cash payment PB
    const bResB = runPsqlCommand(`
      INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount)
      VALUES ('${bobUid}', '${activeCourtId}', '${phase2Date}', '16:00:00', '17:00:00', 'confirmed', 200) RETURNING id;
    `);
    const bIdB = bResB.stdout.trim();
    const pResB = runPsqlCommand(`
      INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, stripe_payment_id, paid_at)
      VALUES ('${bIdB}', 200, 'php', 'paid', 'cash', NULL, now()) RETURNING id;
    `);
    const pIdB = pResB.stdout.trim();

    const competingPI = "pi_competing_cross_booking";

    // Launch competing concurrent child processes attempting to claim competingPI on different bookings
    const callA = `SELECT public.reconcile_booking_payment('${bIdA}', '${pIdA}', 'cs_A', '${competingPI}', 200, 'php');`;
    const callB = `SELECT public.reconcile_booking_payment('${bIdB}', '${pIdB}', 'cs_B', '${competingPI}', 200, 'php');`;

    const spawnCall = (sql) => new Promise((resolve, reject) => {
      const child = spawn("docker", [
        "exec", "-i", CONTAINER_NAME, "psql", "-U", POSTGRES_USER, "-d", TEST_DB, "-t", "-A", "-c",
        `BEGIN; SET LOCAL request.jwt.claim.role = 'service_role'; ${sql} COMMIT;`
      ]);
      let stdout = "", stderr = "";
      child.stdout.on("data", (d) => { stdout += d.toString(); });
      child.stderr.on("data", (d) => { stderr += d.toString(); });
      child.on("close", (code) => resolve({ code, stdout: stdout.trim(), stderr: stderr.trim() }));
      child.on("error", reject);
    });

    const [resA, resB] = await Promise.all([spawnCall(callA), spawnCall(callB)]);

    const isASuccess = resA.code === 0 && resA.stdout.includes("REFUND_SCHEDULED");
    const isBSuccess = resB.code === 0 && resB.stdout.includes("REFUND_SCHEDULED");

    assert.ok(isASuccess !== isBSuccess, "Exactly one transaction must succeed; the other must abort");
    if (!isASuccess) {
      assert.ok(resA.stderr.includes("AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION"), `Session A failed with unexpected error: ${resA.stderr}`);
    }
    if (!isBSuccess) {
      assert.ok(resB.stderr.includes("AMBIGUOUS_PAYMENT_INTENT_ASSOCIATION"), `Session B failed with unexpected error: ${resB.stderr}`);
    }

    // Exactly one payment row in entire DB has competingPI
    const piCountQuery = runPsqlCommand(`SELECT count(*)::int FROM public.payments WHERE stripe_payment_id = '${competingPI}';`);
    assert.equal(parseInt(piCountQuery.stdout.trim(), 10), 1, "Only one payment row may link to the competing PaymentIntent");

    // Neither original cash payment was modified or overwritten
    const checkCashA = runPsqlCommand(`SELECT payment_method, stripe_payment_id FROM public.payments WHERE id = '${pIdA}';`);
    assert.equal(checkCashA.stdout.trim(), "cash|");
    const checkCashB = runPsqlCommand(`SELECT payment_method, stripe_payment_id FROM public.payments WHERE id = '${pIdB}';`);
    assert.equal(checkCashB.stdout.trim(), "cash|");
  });

  await runTest("Phase 2 corrective: reconcile_booking_payment reserves refund for late payment on cancelled/expired booking", () => {
    // 1. Create a hold
    const holdRes = runPsqlCommand(
      `SELECT public.hold_court_booking(
        '${activeCourtId}', '${phase2Date}', '17:00:00', '18:00:00', '${aliceUid}', 200, now() + interval '35 minutes'
      );`,
      { role: "authenticated", uid: aliceUid }
    );
    const { booking_id: bId, payment_id: pId } = JSON.parse(holdRes.stdout);

    // 2. Booking is cancelled before payment reconciliation (e.g. cleanup worker ran after expiry)
    runPsqlCommand(`UPDATE public.bookings SET status = 'cancelled' WHERE id = '${bId}';`);

    // 3. Late payment arrives via Stripe webhook / verify
    const reconcileRes = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bId}', '${pId}', 'cs_late_cleanup', 'pi_late_cleanup', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(reconcileRes.status, 0, reconcileRes.stderr);
    const reconcileObj = JSON.parse(reconcileRes.stdout);
    assert.equal(reconcileObj.action, "REFUND_SCHEDULED");
    assert.equal(reconcileObj.reason, "CANCELLED_BOOKING");
    assert.equal(reconcileObj.payment_id, pId);

    // 4. Payment must be recorded as captured ('paid', 'stripe') with stripe_payment_id
    const pCheck = runPsqlCommand(`SELECT status, payment_method, stripe_payment_id FROM public.payments WHERE id = '${pId}';`);
    assert.equal(pCheck.stdout.trim(), "paid|stripe|pi_late_cleanup");

    // 5. Booking must remain cancelled
    const bCheck = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bId}';`);
    assert.equal(bCheck.stdout.trim(), "cancelled");

    // 6. A pending refund request must exist with correct details
    const refReqQuery = runPsqlCommand(`
      SELECT status, amount, currency, stripe_payment_intent
      FROM public.refund_requests
      WHERE payment_id = '${pId}';
    `);
    assert.equal(refReqQuery.stdout.trim(), "pending|200|php|pi_late_cleanup");

    // 7. Exact redelivery is a safe NO_OP
    const redelivRes = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bId}', '${pId}', 'cs_late_cleanup', 'pi_late_cleanup', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(redelivRes.status, 0);
    assert.equal(JSON.parse(redelivRes.stdout).action, "NO_OP");
  });

  // --- Group: Row Level Security (RLS) Policies ---

  await runTest("RLS: anonymous caller is blocked from direct bookings, profiles, and payments access", () => {
    // 1. Anon direct SELECT on bookings returns 0 rows (RLS blocks direct table read)
    const anonBookings = runPsqlCommand(`SELECT count(*) FROM public.bookings;`, { role: "anon", asRole: true });
    assert.equal(anonBookings.status, 0);
    assert.equal(anonBookings.stdout.trim(), "0", "Anon must not see any rows via direct SELECT on bookings");

    // 2. Anon direct SELECT on profiles returns 0 rows (RLS blocks direct table read)
    const anonProfiles = runPsqlCommand(`SELECT count(*) FROM public.profiles;`, { role: "anon", asRole: true });
    assert.equal(anonProfiles.status, 0);
    assert.equal(anonProfiles.stdout.trim(), "0", "Anon must not see any rows via direct SELECT on profiles");

    // 3. Anon can query courts
    const anonCourts = runPsqlCommand(`SELECT count(*) FROM public.courts;`, { role: "anon", asRole: true });
    assert.equal(anonCourts.status, 0);
    assert(parseInt(anonCourts.stdout.trim(), 10) > 0, "Anon must be able to read courts");

    // 4. Anon cannot query payments (RLS filters out all rows)
    const anonPayments = runPsqlCommand(`SELECT count(*) FROM public.payments;`, { role: "anon", asRole: true });
    assert.equal(anonPayments.status, 0);
    assert.equal(anonPayments.stdout.trim(), "0", "Anon must not see any payment rows");

    // 5. Anon cannot insert directly into bookings (RLS CHECK blocks it)
    const anonInsert = runPsqlCommand(
      `INSERT INTO public.bookings (court_id, booking_date, start_time, end_time, status, total_amount)
       VALUES ('${activeCourtId}', '2029-10-23', '20:00:00', '21:00:00', 'confirmed', 200);`,
      { role: "anon", asRole: true }
    );
    assert.notEqual(anonInsert.status, 0, "Anon direct insert into bookings must be blocked by RLS");
    // Since 20261102 anon has no INSERT privilege at all, so Postgres refuses before RLS is evaluated
    assert(
      anonInsert.stderr.includes("permission denied") || anonInsert.stderr.includes("row-level security policy"),
      `Error must be a privilege or RLS denial, got: ${anonInsert.stderr}`
    );

    // 6. Anon cannot view refund requests
    const anonRefunds = runPsqlCommand(`SELECT count(*) FROM public.refund_requests;`, { role: "anon", asRole: true });
    assert.equal(anonRefunds.status, 0);
    assert.equal(anonRefunds.stdout.trim(), "0", "Anon must not see any refund requests");
  });

  await runTest("RLS: authenticated user can only view their own payments while service_role views all", () => {
    // 1. Alice queries payments - sees only Alice's payments
    const alicePayments = runPsqlCommand(`SELECT count(*) FROM public.payments;`, { role: "authenticated", uid: aliceUid, asRole: true });
    assert.equal(alicePayments.status, 0);
    const aliceCount = parseInt(alicePayments.stdout.trim(), 10);
    assert(aliceCount > 0, "Alice must see her own payments");

    // 2. Bob queries payments - sees only Bob's payments
    const bobPayments = runPsqlCommand(`SELECT count(*) FROM public.payments;`, { role: "authenticated", uid: bobUid, asRole: true });
    assert.equal(bobPayments.status, 0);
    const bobCount = parseInt(bobPayments.stdout.trim(), 10);

    // 3. Service role queries payments - sees all payments (Alice + Bob + Walk-ins)
    const allPayments = runPsqlCommand(`SELECT count(*) FROM public.payments;`, { role: "service_role", asRole: true });
    assert.equal(allPayments.status, 0);
    const totalCount = parseInt(allPayments.stdout.trim(), 10);
    assert(totalCount > aliceCount, "Total payments must exceed Alice's count alone");
  });

  // --- Group 6: 20261030 cancel_expired_booking Resilience Tests ---
  const cleanupAuditDate = "2029-11-13"; // Tuesday (open 07:00 - 22:00)

  await runTest("20261030 Resilience: Expired pending booking with no payment can be cancelled (default NULL payment_id)", () => {
    // 1. Create expired pending booking with no payments row
    const insertRes = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '07:00:00', '08:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    assert.equal(insertRes.status, 0, insertRes.stderr);
    const bookingId = insertRes.stdout.trim();

    // Verify 0 payments exist
    const pCount = runPsqlCommand(`SELECT count(*) FROM public.payments WHERE booking_id = '${bookingId}';`);
    assert.equal(pCount.stdout.trim(), "0");

    // Call cancel_expired_booking with 1 argument (omitting p_payment_id)
    const cancelRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bookingId}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes.status, 0, cancelRes.stderr);
    const cancelObj = JSON.parse(cancelRes.stdout);
    assert.equal(cancelObj.cancelled, true, "Must cancel expired hold with 0 payments");
    assert.equal(cancelObj.booking_id, bookingId);
    assert.equal(cancelObj.payment_id, null);

    // Verify booking status in database is 'cancelled'
    const bCheck = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bookingId}';`);
    assert.equal(bCheck.stdout.trim(), "cancelled");
  });

  await runTest("20261030 Resilience: Expired pending booking with a failed payment can be cancelled", () => {
    // 1. Create expired pending booking
    const insertRes = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '08:00:00', '09:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    assert.equal(insertRes.status, 0, insertRes.stderr);
    const bookingId = insertRes.stdout.trim();

    // 2. Insert a failed payment
    const pInsertRes = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bookingId}', 200, 'failed')
      RETURNING id;
    `);
    assert.equal(pInsertRes.status, 0, pInsertRes.stderr);
    const paymentId = pInsertRes.stdout.trim();

    // 3. Cancel with explicit payment_id (which is failed)
    const cancelRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bookingId}', '${paymentId}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes.status, 0, cancelRes.stderr);
    const cancelObj = JSON.parse(cancelRes.stdout);
    assert.equal(cancelObj.cancelled, true, "Must cancel booking even if payment was already failed");

    // Verify DB: booking is cancelled, payment remains failed
    const bCheck = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bookingId}';`);
    assert.equal(bCheck.stdout.trim(), "cancelled");
    const pCheck = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${paymentId}';`);
    assert.equal(pCheck.stdout.trim(), "failed");
  });

  await runTest("20261030 Resilience: Settled payment (paid, succeeded, refunded, or paid_at IS NOT NULL) prevents cancellation", () => {
    const statuses = [
      { status: "paid", paid_at: "now()" },
      { status: "succeeded", paid_at: "NULL" },
      { status: "refunded", paid_at: "now()" },
      { status: "pending", paid_at: "now()" }, // paid_at IS NOT NULL prevents cancellation even if status says pending
    ];

    for (let i = 0; i < statuses.length; i++) {
      const { status, paid_at } = statuses[i];
      const startHour = 9 + i;
      const endHour = startHour + 1;
      const startTime = `${startHour.toString().padStart(2, "0")}:00:00`;
      const endTime = `${endHour.toString().padStart(2, "0")}:00:00`;

      const insertRes = runPsqlCommand(`
        INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
        VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '${startTime}', '${endTime}', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
        RETURNING id;
      `);
      assert.equal(insertRes.status, 0, insertRes.stderr);
      const bookingId = insertRes.stdout.trim();

      const pInsertRes = runPsqlCommand(`
        INSERT INTO public.payments (id, booking_id, amount, status, paid_at)
        VALUES (gen_random_uuid(), '${bookingId}', 200, '${status}', ${paid_at})
        RETURNING id;
      `);
      assert.equal(pInsertRes.status, 0, pInsertRes.stderr);
      const paymentId = pInsertRes.stdout.trim();

      // Call cancel_expired_booking
      const cancelRes = runPsqlCommand(
        `SELECT public.cancel_expired_booking('${bookingId}', '${paymentId}');`,
        { role: "service_role" }
      );
      assert.equal(cancelRes.status, 0, cancelRes.stderr);
      const cancelObj = JSON.parse(cancelRes.stdout);
      assert.equal(cancelObj.cancelled, false, `Must reject cancellation for settled payment (status=${status}, paid_at=${paid_at})`);
      assert.equal(cancelObj.reason, "PAYMENT_ALREADY_SETTLED");

      // Verify booking is still pending
      const bCheck = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bookingId}';`);
      assert.equal(bCheck.stdout.trim(), "pending", "Booking must remain pending when payment is settled");
    }
  });

  await runTest("20261030 Resilience: Active refund requests prevent cancellation, whereas inactive/terminal refund requests do not", () => {
    // 4a. Active refund status: 'pending' prevents cancellation
    const insertRes1 = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '13:00:00', '14:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bId1 = insertRes1.stdout.trim();

    const pInsertRes1 = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bId1}', 200, 'pending')
      RETURNING id;
    `);
    const pId1 = pInsertRes1.stdout.trim();

    const refRes1 = runPsqlCommand(`
      INSERT INTO public.refund_requests (id, payment_id, booking_id, amount, currency, payment_method, reason, status, idempotency_key)
      VALUES (gen_random_uuid(), '${pId1}', '${bId1}', 200, 'php', 'stripe', 'EXPIRED_HOLD_RECONCILIATION', 'pending', 'idem_refund_pending_test')
      RETURNING id;
    `, { role: "service_role" });
    assert.equal(refRes1.status, 0, `Insert refund request 1 failed: ${refRes1.stderr}`);

    const cancelRes1 = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bId1}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes1.status, 0, cancelRes1.stderr);
    const cancelObj1 = JSON.parse(cancelRes1.stdout);
    assert.equal(cancelObj1.cancelled, false, "Must not cancel booking with active refund request");
    assert.equal(cancelObj1.reason, "REFUND_IN_PROGRESS");

    const bCheck1 = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bId1}';`);
    assert.equal(bCheck1.stdout.trim(), "pending");

    // 4b. Terminal refund status: 'failed' allows cancellation
    const insertRes2 = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '14:00:00', '15:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bId2 = insertRes2.stdout.trim();

    const pInsertRes2 = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bId2}', 200, 'failed')
      RETURNING id;
    `);
    const pId2 = pInsertRes2.stdout.trim();

    const refRes2 = runPsqlCommand(`
      INSERT INTO public.refund_requests (id, payment_id, booking_id, amount, currency, payment_method, reason, status, idempotency_key)
      VALUES (gen_random_uuid(), '${pId2}', '${bId2}', 200, 'php', 'stripe', 'EXPIRED_HOLD_RECONCILIATION', 'failed', 'idem_refund_failed_test')
      RETURNING id;
    `, { role: "service_role" });
    assert.equal(refRes2.status, 0, `Insert refund request 2 failed: ${refRes2.stderr}`);

    const cancelRes2 = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bId2}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes2.status, 0, cancelRes2.stderr);
    const cancelObj2 = JSON.parse(cancelRes2.stdout);
    assert.equal(cancelObj2.cancelled, true, "Terminal failed refund request must allow cancellation");

    const bCheck2 = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bId2}';`);
    assert.equal(bCheck2.stdout.trim(), "cancelled");
  });

  await runTest("20261030 Resilience: Unexpired bookings cannot be cancelled (explicit timestamp and 35-minute fallback)", () => {
    // 5a. Explicit future hold_expires_at
    const insertRes1 = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '15:00:00', '16:00:00', 'pending', 200, now() + interval '15 minutes', now())
      RETURNING id;
    `);
    const bId1 = insertRes1.stdout.trim();

    const cancelRes1 = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bId1}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes1.status, 0, cancelRes1.stderr);
    const cancelObj1 = JSON.parse(cancelRes1.stdout);
    assert.equal(cancelObj1.cancelled, false, "Must not cancel unexpired hold");
    assert.equal(cancelObj1.reason, "HOLD_NOT_EXPIRED");

    // 5b. Null hold_expires_at with created_at < 35 minutes ago -> unexpired via fallback
    const insertRes2 = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '16:00:00', '17:00:00', 'pending', 200, NULL, now() - interval '10 minutes')
      RETURNING id;
    `);
    const bId2 = insertRes2.stdout.trim();

    const cancelRes2 = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bId2}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes2.status, 0, cancelRes2.stderr);
    const cancelObj2 = JSON.parse(cancelRes2.stdout);
    assert.equal(cancelObj2.cancelled, false, "Must not cancel booking within 35m fallback window");
    assert.equal(cancelObj2.reason, "HOLD_NOT_EXPIRED");

    // 5c. Null hold_expires_at with created_at > 35 minutes ago -> expired via fallback, can cancel
    const insertRes3 = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '17:00:00', '18:00:00', 'pending', 200, NULL, now() - interval '40 minutes')
      RETURNING id;
    `);
    const bId3 = insertRes3.stdout.trim();

    const cancelRes3 = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bId3}');`,
      { role: "service_role" }
    );
    assert.equal(cancelRes3.status, 0, cancelRes3.stderr);
    const cancelObj3 = JSON.parse(cancelRes3.stdout);
    assert.equal(cancelObj3.cancelled, true, "Must cancel booking when 35m fallback has passed");

    const bCheck3 = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bId3}';`);
    assert.equal(bCheck3.stdout.trim(), "cancelled");
  });

  await runTest("20261030 Resilience: Already-cancelled or otherwise ineligible bookings are handled safely", () => {
    // 6a. Nonexistent booking UUID
    const cancelNonexistent = runPsqlCommand(
      `SELECT public.cancel_expired_booking('ffffffff-ffff-ffff-ffff-ffffffffffff');`,
      { role: "service_role" }
    );
    assert.equal(cancelNonexistent.status, 0, cancelNonexistent.stderr);
    const nonExistObj = JSON.parse(cancelNonexistent.stdout);
    assert.equal(nonExistObj.cancelled, false);
    assert.equal(nonExistObj.reason, "BOOKING_NOT_FOUND");

    // 6b. Already-cancelled booking
    const insertCancelled = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '18:00:00', '19:00:00', 'cancelled', 200, now() - interval '10 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bIdCancelled = insertCancelled.stdout.trim();

    const cancelAlreadyCancelled = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bIdCancelled}');`,
      { role: "service_role" }
    );
    assert.equal(cancelAlreadyCancelled.status, 0, cancelAlreadyCancelled.stderr);
    const alreadyCancelledObj = JSON.parse(cancelAlreadyCancelled.stdout);
    assert.equal(alreadyCancelledObj.cancelled, false);
    assert.equal(alreadyCancelledObj.reason, "BOOKING_NOT_PENDING");
    assert.equal(alreadyCancelledObj.status, "cancelled");

    // 6c. Confirmed booking
    const insertConfirmed = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '19:00:00', '20:00:00', 'confirmed', 200, now() - interval '10 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bIdConfirmed = insertConfirmed.stdout.trim();

    const cancelConfirmed = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bIdConfirmed}');`,
      { role: "service_role" }
    );
    assert.equal(cancelConfirmed.status, 0, cancelConfirmed.stderr);
    const confirmedObj = JSON.parse(cancelConfirmed.stdout);
    assert.equal(confirmedObj.cancelled, false);
    assert.equal(confirmedObj.reason, "BOOKING_NOT_PENDING");
    assert.equal(confirmedObj.status, "confirmed");
  });

  await runTest("20261030 Resilience: Unauthorized roles cannot execute cancel_expired_booking", () => {
    const dummyId = "00000000-0000-0000-0000-000000000001";

    // 7a. Anonymous role
    const anonRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${dummyId}');`,
      { role: "anon", asRole: true }
    );
    assert.notEqual(anonRes.status, 0, "Anon must be rejected");
    assert.ok(anonRes.stderr.includes("permission denied"), `Expected permission denied, got: ${anonRes.stderr}`);

    // 7b. Authenticated customer role
    const authRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${dummyId}');`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.notEqual(authRes.status, 0, "Authenticated customer must be rejected");
    assert.ok(authRes.stderr.includes("permission denied"), `Expected permission denied, got: ${authRes.stderr}`);

    // 7c. Authenticated claim when connected as postgres superuser (tested by internal guard)
    const authClaimRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${dummyId}');`,
      { role: "authenticated", uid: aliceUid, asRole: false }
    );
    assert.notEqual(authClaimRes.status, 0, "Authenticated claim must be rejected by internal guard");
    assert.ok(authClaimRes.stderr.includes("UNAUTHORIZED") || authClaimRes.stderr.includes("42501"));
  });

  await runTest("20261030 Resilience: Passing a payment ID belonging to a different booking cannot incorrectly update that payment", () => {
    // 1. Booking A: expired pending booking
    const insertA = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '20:00:00', '21:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bIdA = insertA.stdout.trim();

    // 2. Booking B: active pending booking with pending Payment B
    const insertB = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${cleanupAuditDate}', '21:00:00', '22:00:00', 'pending', 200, now() + interval '30 minutes', now())
      RETURNING id;
    `);
    const bIdB = insertB.stdout.trim();

    const insertPaymentB = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bIdB}', 200, 'pending')
      RETURNING id;
    `);
    const pIdB = insertPaymentB.stdout.trim();

    // 3. Attempt to cancel Booking A while passing Payment B's id
    const mismatchRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bIdA}', '${pIdB}');`,
      { role: "service_role" }
    );
    assert.equal(mismatchRes.status, 0, mismatchRes.stderr);
    const mismatchObj = JSON.parse(mismatchRes.stdout);
    assert.equal(mismatchObj.cancelled, false, "Must refuse cancellation when payment does not belong to booking");
    assert.equal(mismatchObj.reason, "PAYMENT_NOT_FOUND");

    // 4. Verify neither Booking A nor Payment B was modified
    const bCheckA = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bIdA}';`);
    assert.equal(bCheckA.stdout.trim(), "pending", "Booking A must remain pending");

    const pCheckB = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${pIdB}';`);
    assert.equal(pCheckB.stdout.trim(), "pending", "Payment B must remain pending and not marked failed");
  });

  // --- Group 7: 20261030 Rollback Verification Tests ---
  const rollbackAuditDate = "2029-11-20"; // Tuesday (open 07:00 - 22:00)

  await runTest("20261030 Rollback: Execute rollback and verify parameter defaults, signature, original behavior, and permissions", () => {
    // 1. Verify before rollback: pg_proc has 1 default argument (DEFAULT NULL)
    const beforeProc = runPsqlCommand(`
      SELECT pronargs, pronargdefaults, proargdefaults IS NOT NULL
      FROM pg_proc
      JOIN pg_namespace n ON n.oid = pg_proc.pronamespace
      WHERE n.nspname = 'public' AND proname = 'cancel_expired_booking';
    `);
    assert.equal(beforeProc.status, 0, beforeProc.stderr);
    assert.equal(beforeProc.stdout.trim(), "2|1|t", "Before rollback, function must have pronargs=2 and pronargdefaults=1");

    // 2. Execute corrected rollback migration in disposable test database
    const rollbackPath = path.join(PROJECT_ROOT, "supabase/rollback_20261030_cancel_expired_booking_resilience.sql");
    runPsqlFile(rollbackPath);

    // 3. Verify after rollback: pg_proc has 0 default arguments (proargdefaults IS NULL)
    const afterProc = runPsqlCommand(`
      SELECT pronargs, pronargdefaults, proargdefaults IS NULL
      FROM pg_proc
      JOIN pg_namespace n ON n.oid = pg_proc.pronamespace
      WHERE n.nspname = 'public' AND proname = 'cancel_expired_booking';
    `);
    assert.equal(afterProc.status, 0, afterProc.stderr);
    assert.equal(afterProc.stdout.trim(), "2|0|t", "After rollback, function must have pronargs=2 and pronargdefaults=0 with no defaults");

    // 4. Verify single-argument call is REJECTED with 42883 (does not exist)
    const singleArgRes = runPsqlCommand(
      `SELECT public.cancel_expired_booking('00000000-0000-0000-0000-000000000001');`,
      { role: "service_role" }
    );
    assert.notEqual(singleArgRes.status, 0, "Single-argument call must be rejected after rollback");
    assert.ok(
      singleArgRes.stderr.includes("42883") || singleArgRes.stderr.includes("does not exist"),
      `Expected function does not exist error (42883), got: ${singleArgRes.stderr}`
    );

    // 5. Verify two-argument call executes original function behavior
    // 5a. Unexpired hold -> HOLD_NOT_EXPIRED
    const unexpHold = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${rollbackAuditDate}', '07:00:00', '08:00:00', 'pending', 200, now() + interval '20 minutes', now())
      RETURNING id;
    `);
    const bUnexp = unexpHold.stdout.trim();
    const pUnexp = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bUnexp}', 200, 'pending')
      RETURNING id;
    `).stdout.trim();

    const cancelUnexp = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bUnexp}', '${pUnexp}');`,
      { role: "service_role" }
    );
    assert.equal(cancelUnexp.status, 0, cancelUnexp.stderr);
    assert.equal(JSON.parse(cancelUnexp.stdout).cancelled, false);
    assert.equal(JSON.parse(cancelUnexp.stdout).reason, "HOLD_NOT_EXPIRED");

    // 5b. Expired hold with pending payment -> cancels booking and marks payment failed
    const expHold = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${rollbackAuditDate}', '08:00:00', '09:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bExp = expHold.stdout.trim();
    const pExp = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bExp}', 200, 'pending')
      RETURNING id;
    `).stdout.trim();

    const cancelExp = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bExp}', '${pExp}');`,
      { role: "service_role" }
    );
    assert.equal(cancelExp.status, 0, cancelExp.stderr);
    assert.equal(JSON.parse(cancelExp.stdout).cancelled, true);

    const bExpCheck = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${bExp}';`);
    assert.equal(bExpCheck.stdout.trim(), "cancelled");
    const pExpCheck = runPsqlCommand(`SELECT status FROM public.payments WHERE id = '${pExp}';`);
    assert.equal(pExpCheck.stdout.trim(), "failed");

    // 5c. Expired hold with non-pending payment -> returns PAYMENT_NOT_PENDING (original behavior)
    const nonPendingHold = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${rollbackAuditDate}', '09:00:00', '10:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '40 minutes')
      RETURNING id;
    `);
    const bNonPending = nonPendingHold.stdout.trim();
    const pFailed = runPsqlCommand(`
      INSERT INTO public.payments (id, booking_id, amount, status)
      VALUES (gen_random_uuid(), '${bNonPending}', 200, 'failed')
      RETURNING id;
    `).stdout.trim();

    const cancelNonPending = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bNonPending}', '${pFailed}');`,
      { role: "service_role" }
    );
    assert.equal(cancelNonPending.status, 0, cancelNonPending.stderr);
    assert.equal(JSON.parse(cancelNonPending.stdout).cancelled, false);
    assert.equal(JSON.parse(cancelNonPending.stdout).reason, "PAYMENT_NOT_PENDING");

    // 6. Verify permissions after rollback: anon and authenticated rejected, service_role allowed
    const anonCheck = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bExp}', '${pExp}');`,
      { role: "anon", asRole: true }
    );
    assert.notEqual(anonCheck.status, 0, "Anon must be rejected after rollback");
    assert.ok(anonCheck.stderr.includes("permission denied"), `Expected permission denied, got: ${anonCheck.stderr}`);

    const authCheck = runPsqlCommand(
      `SELECT public.cancel_expired_booking('${bExp}', '${pExp}');`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.notEqual(authCheck.status, 0, "Authenticated must be rejected after rollback");
    assert.ok(authCheck.stderr.includes("permission denied"), `Expected permission denied, got: ${authCheck.stderr}`);
  });

  // --- Group 8: Phase 1 (20261101) Integration Tests: RLS Security, Profiles Isolation, Slot Masking, and Rollback ---

  await runTest("Phase 1: public.is_admin() metadata, SECURITY DEFINER execution, search_path, and execution privileges", () => {
    // 1. Verify function security metadata: prosecdef=true, owner=postgres, search_path=''
    const procMeta = runPsqlCommand(`
      SELECT 
        p.prosecdef,
        r.rolname,
        array_to_string(p.proconfig, ',')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname = 'public' AND p.proname = 'is_admin';
    `);
    assert.equal(procMeta.status, 0, procMeta.stderr);
    const [prosecdef, owner, proconfig] = procMeta.stdout.trim().split("|");
    assert.equal(prosecdef, "t", "is_admin() must be SECURITY DEFINER");
    assert.equal(owner, "postgres", "is_admin() must be owned by postgres");
    assert.ok(proconfig.includes("search_path="), `is_admin() must set search_path, got: ${proconfig}`);

    // 2. Direct execution by anon is rejected with 42501 (permission denied)
    const anonExec = runPsqlCommand(`SELECT public.is_admin();`, { role: "anon", asRole: true });
    assert.notEqual(anonExec.status, 0, "Anon execution of is_admin() must be rejected");
    assert.ok(anonExec.stderr.includes("permission denied"), `Expected permission denied, got: ${anonExec.stderr}`);

    // 3. Admin user returns true
    const adminExec = runPsqlCommand(`SELECT public.is_admin();`, { role: "authenticated", uid: adminUid, asRole: true });
    assert.equal(adminExec.status, 0, adminExec.stderr);
    assert.equal(adminExec.stdout.trim(), "t", "Admin must evaluate to true");

    // 4. Customer Alice returns false
    const aliceExec = runPsqlCommand(`SELECT public.is_admin();`, { role: "authenticated", uid: aliceUid, asRole: true });
    assert.equal(aliceExec.status, 0, aliceExec.stderr);
    assert.equal(aliceExec.stdout.trim(), "f", "Alice must evaluate to false");

    // 5. Customer Bob returns false
    const bobExec = runPsqlCommand(`SELECT public.is_admin();`, { role: "authenticated", uid: bobUid, asRole: true });
    assert.equal(bobExec.status, 0, bobExec.stderr);
    assert.equal(bobExec.stdout.trim(), "f", "Bob must evaluate to false");

    // 6. Service role execution succeeds
    const serviceExec = runPsqlCommand(`SELECT public.is_admin();`, { role: "service_role", asRole: true });
    assert.equal(serviceExec.status, 0, serviceExec.stderr);
  });

  await runTest("Phase 1: public.profiles RLS customer isolation, role escalation prevention, and admin view-all without recursion", () => {
    // 1. Customer Alice querying public.profiles sees only her own profile (1 row)
    const aliceProfiles = runPsqlCommand(`SELECT count(*), min(id::text) FROM public.profiles;`, {
      role: "authenticated",
      uid: aliceUid,
      asRole: true,
    });
    assert.equal(aliceProfiles.status, 0, aliceProfiles.stderr);
    assert.equal(aliceProfiles.stdout.trim(), `1|${aliceUid}`, "Alice must see only her own profile row");

    // 2. Customer Bob querying public.profiles sees only his own profile (1 row)
    const bobProfiles = runPsqlCommand(`SELECT count(*), min(id::text) FROM public.profiles;`, {
      role: "authenticated",
      uid: bobUid,
      asRole: true,
    });
    assert.equal(bobProfiles.status, 0, bobProfiles.stderr);
    assert.equal(bobProfiles.stdout.trim(), `1|${bobUid}`, "Bob must see only his own profile row");

    // 3. Customer Alice attempting to update Bob's profile modifies 0 rows
    const aliceHackBob = runPsqlCommand(`UPDATE public.profiles SET full_name = 'Hacked' WHERE id = '${bobUid}' RETURNING id;`, {
      role: "authenticated",
      uid: aliceUid,
      asRole: true,
    });
    assert.equal(aliceHackBob.status, 0, aliceHackBob.stderr);
    assert.equal(aliceHackBob.stdout.trim(), "", "Alice must not be able to update Bob's profile (0 rows returned)");

    const checkBobRow = runPsqlCommand(`SELECT full_name FROM public.profiles WHERE id = '${bobUid}';`);
    assert.notEqual(checkBobRow.stdout.trim(), "Hacked", "Bob profile must remain unhacked");

    // 4. Customer Alice updating own full_name and phone succeeds
    const aliceUpdateSelf = runPsqlCommand(
      `UPDATE public.profiles SET full_name = 'Alice Smith', phone = '09123456780' WHERE id = '${aliceUid}' RETURNING full_name, phone;`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.equal(aliceUpdateSelf.status, 0, aliceUpdateSelf.stderr);
    assert.equal(aliceUpdateSelf.stdout.trim(), "Alice Smith|09123456780", "Alice must be able to update her own full_name and phone");

    const checkAliceRow = runPsqlCommand(`SELECT full_name, phone, role FROM public.profiles WHERE id = '${aliceUid}';`);
    assert.equal(checkAliceRow.stdout.trim(), "Alice Smith|09123456780|customer");

    // 5. Customer Alice attempting privilege escalation to admin is blocked by RLS WITH CHECK
    const aliceEscalate = runPsqlCommand(
      `UPDATE public.profiles SET role = 'admin' WHERE id = '${aliceUid}';`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.notEqual(aliceEscalate.status, 0, "Alice role escalation to admin must be blocked by RLS");
    assert.ok(
      aliceEscalate.stderr.includes("row-level security policy") || aliceEscalate.stderr.includes("42501"),
      `Expected RLS policy error, got: ${aliceEscalate.stderr}`
    );

    // Verify Alice role is still customer
    const checkRoleStillCustomer = runPsqlCommand(`SELECT role FROM public.profiles WHERE id = '${aliceUid}';`);
    assert.equal(checkRoleStillCustomer.stdout.trim(), "customer");

    // 6. Admin can view all profiles without infinite recursion (Postgres 42P17 prevention)
    const adminProfiles = runPsqlCommand(`SELECT count(*) FROM public.profiles;`, {
      role: "authenticated",
      uid: adminUid,
      asRole: true,
    });
    assert.equal(adminProfiles.status, 0, adminProfiles.stderr);
    const adminSeenCount = parseInt(adminProfiles.stdout.trim(), 10);
    assert.ok(adminSeenCount >= 3, `Admin must see all profiles without recursion, saw: ${adminSeenCount}`);

    // 7. Service role can view all profiles without restriction
    const serviceProfiles = runPsqlCommand(`SELECT count(*) FROM public.profiles;`, {
      role: "service_role",
      asRole: true,
    });
    assert.equal(serviceProfiles.status, 0, serviceProfiles.stderr);
    assert.equal(parseInt(serviceProfiles.stdout.trim(), 10), adminSeenCount);
  });

  await runTest("Phase 1: public.bookings direct table RLS: customer isolation, admin access, and join recursion protection", () => {
    // 1. Alice direct SELECT sees only Alice's bookings; cannot see Bob's bookings
    const aliceBobBookings = runPsqlCommand(
      `SELECT count(*) FROM public.bookings WHERE user_id = '${bobUid}';`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.equal(aliceBobBookings.status, 0, aliceBobBookings.stderr);
    assert.equal(aliceBobBookings.stdout.trim(), "0", "Alice must not see Bob's bookings via direct SELECT");

    // 2. Admin direct SELECT sees all bookings
    const adminBookings = runPsqlCommand(`SELECT count(*) FROM public.bookings;`, {
      role: "authenticated",
      uid: adminUid,
      asRole: true,
    });
    assert.equal(adminBookings.status, 0, adminBookings.stderr);
    assert.ok(parseInt(adminBookings.stdout.trim(), 10) > 0, "Admin must see all bookings");

    // 3. Admin JOIN between bookings and profiles succeeds without recursion
    const adminJoin = runPsqlCommand(
      `SELECT count(*) FROM public.bookings b JOIN public.profiles p ON p.id = b.user_id;`,
      { role: "authenticated", uid: adminUid, asRole: true }
    );
    assert.equal(adminJoin.status, 0, adminJoin.stderr);
    assert.ok(parseInt(adminJoin.stdout.trim(), 10) > 0, "Admin must be able to join bookings and profiles without recursion");

    // 4. Service role direct SELECT sees all bookings
    const serviceBookings = runPsqlCommand(`SELECT count(*) FROM public.bookings;`, {
      role: "service_role",
      asRole: true,
    });
    assert.equal(serviceBookings.status, 0, serviceBookings.stderr);
    assert.equal(serviceBookings.stdout.trim(), adminBookings.stdout.trim());
  });

  await runTest("Phase 1: public.get_public_slot_availability RPC: slot masking, expired hold exclusion, and countdown timer support", () => {
    const slotDate = "2029-12-18"; // Tuesday

    // 1. Verify RPC security metadata
    const rpcMeta = runPsqlCommand(`
      SELECT 
        p.prosecdef,
        r.rolname,
        array_to_string(p.proconfig, ',')
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_roles r ON r.oid = p.proowner
      WHERE n.nspname = 'public' AND p.proname = 'get_public_slot_availability';
    `);
    assert.equal(rpcMeta.status, 0, rpcMeta.stderr);
    const [prosecdef, owner, proconfig] = rpcMeta.stdout.trim().split("|");
    assert.equal(prosecdef, "t", "get_public_slot_availability must be SECURITY DEFINER");
    assert.equal(owner, "postgres", "get_public_slot_availability must be owned by postgres");
    assert.ok(proconfig.includes("search_path="), `get_public_slot_availability must set search_path, got: ${proconfig}`);

    // 2. Verify created_at is NOT in the return signature
    const columnCheck = runPsqlCommand(`SELECT created_at FROM public.get_public_slot_availability('${slotDate}');`);
    assert.notEqual(columnCheck.status, 0, "created_at must NOT be exposed in RPC return columns");
    assert.ok(columnCheck.stderr.includes("does not exist") || columnCheck.stderr.includes("42703"));

    // 3. Setup test bookings on slotDate
    runPsqlCommand(`DELETE FROM public.bookings WHERE booking_date = '${slotDate}';`);

    // 3a. Bob confirmed booking (08:00 - 09:00)
    runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount)
      VALUES (gen_random_uuid(), '${bobUid}', '${activeCourtId}', '${slotDate}', '08:00:00', '09:00:00', 'confirmed', 200);
    `);

    // 3b. Alice active pending hold (09:00 - 10:00)
    const aliceHoldInsert = runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
      VALUES (gen_random_uuid(), '${aliceUid}', '${activeCourtId}', '${slotDate}', '09:00:00', '10:00:00', 'pending', 200, now() + interval '25 minutes')
      RETURNING id;
    `);
    const aliceHoldId = aliceHoldInsert.stdout.trim();

    // 3c. Bob active pending hold (10:00 - 11:00)
    runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
      VALUES (gen_random_uuid(), '${bobUid}', '${activeCourtId}', '${slotDate}', '10:00:00', '11:00:00', 'pending', 200, now() + interval '25 minutes');
    `);

    // 3d. Bob expired pending hold (11:00 - 12:00), past its 20-minute grace period - must be filtered out
    runPsqlCommand(`
      INSERT INTO public.bookings (id, user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
      VALUES (gen_random_uuid(), '${bobUid}', '${activeCourtId}', '${slotDate}', '11:00:00', '12:00:00', 'pending', 200, now() - interval '25 minutes');
    `);

    // 4. Anon queries availability:
    // - Must return exactly 3 active rows (08:00, 09:00, 10:00). Expired 11:00 is omitted.
    // - For all 3 rows: id, user_id, and hold_expires_at are masked as NULL.
    const anonSlots = runPsqlCommand(
      `SELECT 
        coalesce(id::text, 'NULL'),
        coalesce(user_id::text, 'NULL'),
        court_id,
        start_time,
        end_time,
        status,
        coalesce(hold_expires_at::text, 'NULL')
       FROM public.get_public_slot_availability('${slotDate}')
       ORDER BY start_time;`,
      { role: "anon", asRole: true }
    );
    assert.equal(anonSlots.status, 0, anonSlots.stderr);
    const anonLines = anonSlots.stdout.trim().split("\n");
    assert.equal(anonLines.length, 3, `Anon must see exactly 3 active slots, saw: ${anonLines.length}`);
    for (const line of anonLines) {
      const [id, userId, cId, start, end, status, holdExp] = line.split("|");
      assert.equal(id, "NULL", "id must be masked as NULL for anon");
      assert.equal(userId, "NULL", "user_id must be masked as NULL for anon");
      assert.equal(holdExp, "NULL", "hold_expires_at must be masked as NULL for anon");
      assert.equal(cId, activeCourtId);
      assert.ok(["confirmed", "pending"].includes(status));
    }

    // 5. Customer Alice queries availability:
    // - Alice's own pending hold (09:00) has unmasked id, user_id, and hold_expires_at (supports timer & resume modal)
    // - Other players' bookings (08:00 Bob confirmed, 10:00 Bob pending) have id, user_id, hold_expires_at masked as NULL
    const aliceSlots = runPsqlCommand(
      `SELECT 
        coalesce(id::text, 'NULL'),
        coalesce(user_id::text, 'NULL'),
        start_time,
        status,
        coalesce(hold_expires_at::text, 'NULL') != 'NULL'
       FROM public.get_public_slot_availability('${slotDate}')
       ORDER BY start_time;`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.equal(aliceSlots.status, 0, aliceSlots.stderr);
    const aliceLines = aliceSlots.stdout.trim().split("\n");
    assert.equal(aliceLines.length, 3);

    // Row 1: Bob confirmed
    const [b1Id, b1User, b1Start, b1Status, b1HasHold] = aliceLines[0].split("|");
    assert.equal(b1Start, "08:00:00");
    assert.equal(b1Status, "confirmed");
    assert.equal(b1Id, "NULL", "Bob confirmed id masked for Alice");
    assert.equal(b1User, "NULL", "Bob user_id masked for Alice");
    assert.equal(b1HasHold, "f");

    // Row 2: Alice pending hold
    const [a2Id, a2User, a2Start, a2Status, a2HasHold] = aliceLines[1].split("|");
    assert.equal(a2Start, "09:00:00");
    assert.equal(a2Status, "pending");
    assert.equal(a2Id, aliceHoldId, "Alice must see her own booking id for pending resume");
    assert.equal(a2User, aliceUid, "Alice must see her own user_id");
    assert.equal(a2HasHold, "t", "Alice must see hold_expires_at for countdown timer");

    // Row 3: Bob pending hold
    const [b3Id, b3User, b3Start, b3Status, b3HasHold] = aliceLines[2].split("|");
    assert.equal(b3Start, "10:00:00");
    assert.equal(b3Status, "pending");
    assert.equal(b3Id, "NULL", "Bob pending hold id masked for Alice");
    assert.equal(b3User, "NULL", "Bob user_id masked for Alice");
    assert.equal(b3HasHold, "f", "Bob hold_expires_at masked for Alice");

    // 6. Service role execution succeeds
    const serviceSlots = runPsqlCommand(
      `SELECT count(*) FROM public.get_public_slot_availability('${slotDate}');`,
      { role: "service_role", asRole: true }
    );
    assert.equal(serviceSlots.status, 0, serviceSlots.stderr);
    assert.equal(serviceSlots.stdout.trim(), "3");
  });

  await runTest("Phase 1: Rollback verification: execute rollback script, verify drop & policy restoration, and re-apply cleanly", () => {
    // 1. Execute Phase 1 rollback
    const rollbackPath = path.join(PROJECT_ROOT, "supabase/rollback_20261101_secure_profiles_and_public_slot_availability.sql");
    runPsqlFile(rollbackPath);

    // 2. Verify get_public_slot_availability and is_admin are dropped
    const procCheck = runPsqlCommand(`
      SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('is_admin', 'get_public_slot_availability');
    `);
    assert.equal(procCheck.status, 0, procCheck.stderr);
    assert.equal(procCheck.stdout.trim(), "0", "Functions must be dropped after rollback");

    // 3. Verify open read policies restored: anon can direct SELECT from bookings and profiles
    const anonBookingsRollback = runPsqlCommand(`SELECT count(*) FROM public.bookings;`, { role: "anon", asRole: true });
    assert.equal(anonBookingsRollback.status, 0, anonBookingsRollback.stderr);
    assert.ok(parseInt(anonBookingsRollback.stdout.trim(), 10) > 0, "Anon can read bookings directly after rollback");

    const anonProfilesRollback = runPsqlCommand(`SELECT count(*) FROM public.profiles;`, { role: "anon", asRole: true });
    assert.equal(anonProfilesRollback.status, 0, anonProfilesRollback.stderr);
    assert.ok(parseInt(anonProfilesRollback.stdout.trim(), 10) > 0, "Anon can read profiles directly after rollback");

    // 4. Re-apply Phase 1 migration cleanly, then the later migration that also redefines
    //    get_public_slot_availability, so the remaining tests see the full migration chain
    runPsqlFile(secureProfilesMigrationPath);
    runPsqlFile(graceMigrationPath);

    // 5. Verify functions are restored
    const procRestored = runPsqlCommand(`
      SELECT count(*) FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname IN ('is_admin', 'get_public_slot_availability');
    `);
    assert.equal(procRestored.status, 0, procRestored.stderr);
    assert.equal(procRestored.stdout.trim(), "2", "Both functions restored after re-applying migration");

    // 6. Verify anon direct SELECT on bookings is blocked again
    const anonBlockedAgain = runPsqlCommand(`SELECT count(*) FROM public.bookings;`, { role: "anon", asRole: true });
    assert.equal(anonBlockedAgain.status, 0, anonBlockedAgain.stderr);
    assert.equal(anonBlockedAgain.stdout.trim(), "0", "Anon direct SELECT on bookings blocked again");
  });

  // --- 20261102 launch hardening ---
  const hardeningDate = "2029-12-04"; // Tuesday (open 07:00 - 22:00), not used by other tests

  await runTest("20261102: customer cannot promote themselves to admin but can edit name and phone", () => {
    const escalate = runPsqlCommand(
      `UPDATE public.profiles SET role = 'admin' WHERE id = '${aliceUid}';`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.notEqual(escalate.status, 0, "Role escalation must be refused");
    assert.ok(escalate.stderr.includes("permission denied"), escalate.stderr);

    const edit = runPsqlCommand(
      `UPDATE public.profiles SET full_name = 'Alice Renamed', phone = '09170000000' WHERE id = '${aliceUid}' RETURNING full_name`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );
    assert.equal(edit.status, 0, edit.stderr);
    assert.equal(edit.stdout, "Alice Renamed");

    const role = runPsqlCommand(`SELECT role FROM public.profiles WHERE id = '${aliceUid}';`);
    assert.equal(role.stdout, "customer");
    runPsqlCommand(`UPDATE public.profiles SET full_name = 'Alice Player', phone = NULL WHERE id = '${aliceUid}';`);
  });

  await runTest("20261102: anon has no table write privileges and nobody can TRUNCATE", () => {
    const res = runPsqlCommand(`
      SELECT string_agg(t || ':' || r || ':' || p, ',')
      FROM unnest(ARRAY['profiles','customers','courts','operating_hours','bookings','payments','refund_requests']) t,
           unnest(ARRAY['anon','authenticated']) r,
           unnest(ARRAY['INSERT','UPDATE','DELETE','TRUNCATE']) p
      WHERE has_table_privilege(r, 'public.' || t, p)
        AND (r = 'anon' OR p = 'TRUNCATE');
    `);
    assert.equal(res.status, 0, res.stderr);
    assert.equal(res.stdout, "", `Unexpected write privileges: ${res.stdout}`);

    const roleColumn = runPsqlCommand(
      `SELECT has_column_privilege('authenticated', 'public.profiles', 'role', 'UPDATE')::text;`
    );
    assert.equal(roleColumn.stdout, "false");
  });

  await runTest("20261102: walk-in can take a slot whose online hold expired (no cron needed)", () => {
    const hold = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${hardeningDate}', '09:00:00', '10:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(hold.status, 0, hold.stderr);
    const { booking_id: expiredId } = JSON.parse(hold.stdout);
    runPsqlCommand(`UPDATE public.bookings SET hold_expires_at = now() - interval '21 minutes' WHERE id = '${expiredId}';`);

    const walkIn = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}', p_customer_name => 'Charlie Guest', p_booking_date => '${hardeningDate}',
        p_start_time => '09:00:00', p_end_time => '10:00:00', p_amount => 200,
        p_customer_id => '${guestCustId}', p_payment_method => 'cash'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(walkIn.status, 0, walkIn.stderr);

    const released = runPsqlCommand(
      `SELECT b.status || '|' || p.status FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${expiredId}';`
    );
    assert.equal(released.stdout, "cancelled|failed");
  });

  await runTest("20261102: an expired hold with a recorded payment is never released and reports SLOT_UNAVAILABLE", () => {
    const hold = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${hardeningDate}', '11:00:00', '12:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(hold.status, 0, hold.stderr);
    const { booking_id: paidId, payment_id: paidPaymentId } = JSON.parse(hold.stdout);
    runPsqlCommand(`UPDATE public.payments SET status = 'paid', paid_at = now() WHERE id = '${paidPaymentId}';`);
    runPsqlCommand(`UPDATE public.bookings SET hold_expires_at = now() - interval '21 minutes' WHERE id = '${paidId}';`);

    const bobAttempt = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${hardeningDate}', '11:00:00', '12:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(bobAttempt.status, 0);
    assert.ok(bobAttempt.stderr.includes("SLOT_UNAVAILABLE"), `Exclusion error must map to SLOT_UNAVAILABLE: ${bobAttempt.stderr}`);

    const untouched = runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${paidId}';`);
    assert.equal(untouched.stdout, "pending", "Paid hold must not be cancelled by release_expired_court_holds");
  });

  await runTest("20261102: one pending payment per booking; release helper is not callable by clients", () => {
    const hold = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${hardeningDate}', '15:00:00', '16:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(hold.status, 0, hold.stderr);
    const { booking_id: bookingId } = JSON.parse(hold.stdout);
    const secondPending = runPsqlCommand(
      `INSERT INTO public.payments (booking_id, amount, currency, status) VALUES ('${bookingId}', 200, 'php', 'pending');`
    );
    assert.notEqual(secondPending.status, 0);
    assert.ok(secondPending.stderr.includes("uq_payments_one_pending_per_booking"), secondPending.stderr);

    for (const role of ["anon", "authenticated"]) {
      const call = runPsqlCommand(
        `SELECT public.release_expired_court_holds('${activeCourtId}', '${hardeningDate}', '07:00', '22:00');`,
        { role, uid: aliceUid, asRole: true }
      );
      assert.notEqual(call.status, 0, `${role} must not execute release_expired_court_holds`);
      assert.ok(call.stderr.includes("permission denied"), call.stderr);
    }
  });

  await runTest("20261102: GCash refunds are manual handovers and never reach the Stripe worker", () => {
    const walkIn = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}', p_customer_name => 'Charlie Guest', p_booking_date => '${hardeningDate}',
        p_start_time => '17:00:00', p_end_time => '18:00:00', p_amount => 200,
        p_customer_id => '${guestCustId}', p_payment_method => 'gcash', p_payment_reference => 'GC-PAY-1'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(walkIn.status, 0, walkIn.stderr);
    const bookingId = JSON.parse(walkIn.stdout).booking_id;
    const paymentId = runPsqlCommand(`SELECT id FROM public.payments WHERE booking_id = '${bookingId}';`).stdout;
    runPsqlCommand(`UPDATE public.bookings SET status = 'cancelled' WHERE id = '${bookingId}';`);

    const customerAttempt = runPsqlCommand(
      `SELECT public.request_manual_cash_refund('${paymentId}', '${bookingId}', 200, 'php', 'Cancelled', 'ref_gcash_cust');`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.notEqual(customerAttempt.status, 0);
    assert.ok(customerAttempt.stderr.includes("FORBIDDEN"), customerAttempt.stderr);

    const request = runPsqlCommand(
      `SELECT public.request_manual_cash_refund('${paymentId}', '${bookingId}', 200, 'php', 'Cancelled', 'ref_gcash_1');`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(request.status, 0, request.stderr);
    const requestObj = JSON.parse(request.stdout);
    assert.equal(requestObj.status, "pending_cash_handover");

    runPsqlCommand(`SELECT public.claim_pending_refund_request('worker-test', 60);`, { role: "service_role" });
    const afterClaim = runPsqlCommand(`SELECT status FROM public.refund_requests WHERE id = '${requestObj.refund_request_id}';`);
    assert.equal(afterClaim.stdout, "pending_cash_handover", "Stripe worker must not claim GCash refunds");

    const confirm = runPsqlCommand(
      `SELECT public.confirm_manual_cash_refund('${requestObj.refund_request_id}', 'GC-REFUND-9', 'Sent back via GCash');`,
      { role: "authenticated", uid: adminUid }
    );
    assert.equal(confirm.status, 0, confirm.stderr);
    const final = runPsqlCommand(
      `SELECT r.status || '|' || p.status FROM public.refund_requests r JOIN public.payments p ON p.id = r.payment_id WHERE r.id = '${requestObj.refund_request_id}';`
    );
    assert.equal(final.stdout, "cash_refunded|refunded");
  });

  await runTest("20261102 Rollback: on a fresh database, rollback restores previous objects and the migration re-applies cleanly", () => {
    const rbDb = "crosshair_rollback_db";
    const created = runPsqlCommand(`CREATE DATABASE ${rbDb};`, { db: "postgres" });
    assert.equal(created.status, 0, created.stderr);

    for (const file of [
      fixturePath, migrationPath, stage2MigrationPath, stage1HoldExpiryPath, paymentReconciliationPath,
      paymentRefundFixPath, rlsMigrationPath, resilienceMigrationPath, tightenRlsMigrationPath,
      secureProfilesMigrationPath, launchHardeningMigrationPath,
    ]) {
      runPsqlFile(file, { db: rbDb });
    }

    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_20261102_launch_hardening.sql"), { db: rbDb });
    const afterRollback = runPsqlCommand(`
      SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'payments_booking_id_key')
        || '|' || (to_regprocedure('public.release_expired_court_holds(uuid,date,time,time)') IS NULL)
        || '|' || has_table_privilege('anon', 'public.bookings', 'INSERT')
        || '|' || (SELECT prosrc NOT LIKE '%TOO_MANY_HOLDS%' FROM pg_proc WHERE proname = 'hold_court_booking');
    `, { db: rbDb });
    assert.equal(afterRollback.status, 0, afterRollback.stderr);
    assert.equal(afterRollback.stdout, "1|true|true|true");

    runPsqlFile(launchHardeningMigrationPath, { db: rbDb });
    const reapplied = runPsqlCommand(`
      SELECT (SELECT count(*) FROM pg_constraint WHERE conname = 'payments_booking_id_key')
        || '|' || (to_regprocedure('public.release_expired_court_holds(uuid,date,time,time)') IS NOT NULL)
        || '|' || has_table_privilege('anon', 'public.bookings', 'INSERT');
    `, { db: rbDb });
    assert.equal(reapplied.stdout, "0|true|false");
  });

  // --- hold_release_grace_period: late Stripe webhooks ---
  const graceDate = "2029-12-18"; // Tuesday (open 07:00 - 22:00), not used by other tests

  await runTest("Grace period: a late webhook inside the grace period confirms the booking; nobody can take the slot meanwhile", () => {
    const hold = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${graceDate}', '09:00:00', '10:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(hold.status, 0, hold.stderr);
    const { booking_id: bookingId, payment_id: paymentId } = JSON.parse(hold.stdout);
    const confirm = runPsqlCommand(
      `SELECT public.confirm_checkout_hold('${bookingId}', '${paymentId}', 'cs_late_webhook', now() + interval '33 minutes');`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(confirm.status, 0, confirm.stderr);

    // Customer paid at the last moment; the hold has now expired but the webhook has not arrived yet
    runPsqlCommand(`UPDATE public.bookings SET hold_expires_at = now() - interval '5 minutes' WHERE id = '${bookingId}';`);

    const bobAttempt = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${graceDate}', '09:00:00', '10:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.notEqual(bobAttempt.status, 0, "Slot must stay blocked during the grace period");
    assert.ok(bobAttempt.stderr.includes("SLOT_UNAVAILABLE"), bobAttempt.stderr);

    const walkIn = runPsqlCommand(
      `SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}', p_customer_name => 'Charlie Guest', p_booking_date => '${graceDate}',
        p_start_time => '09:00:00', p_end_time => '10:00:00', p_amount => 200,
        p_customer_id => '${guestCustId}', p_payment_method => 'cash'
      );`,
      { role: "authenticated", uid: adminUid }
    );
    assert.notEqual(walkIn.status, 0, "Walk-ins must also respect the grace period");
    assert.ok(walkIn.stderr.includes("SLOT_UNAVAILABLE"), walkIn.stderr);

    const untouched = runPsqlCommand(
      `SELECT b.status || '|' || p.status FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${bookingId}';`
    );
    assert.equal(untouched.stdout, "pending|pending", "Grace-period hold must not be released or marked failed");

    const late = runPsqlCommand(
      `SELECT public.reconcile_booking_payment('${bookingId}', '${paymentId}', 'cs_late_webhook', 'pi_late_webhook', 200, 'php');`,
      { role: "service_role" }
    );
    assert.equal(late.status, 0, late.stderr);
    assert.equal(JSON.parse(late.stdout).action, "CONFIRMED", "Late payment must confirm the booking, not refund it");
    const final = runPsqlCommand(
      `SELECT b.status || '|' || p.status || '|' || (SELECT count(*) FROM public.refund_requests WHERE booking_id = b.id)
       FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${bookingId}';`
    );
    assert.equal(final.stdout, "confirmed|paid|0");
  });

  await runTest("Grace period: grid shows grace-period holds as taken (masked); Stripe-verified cron cancel is not delayed", () => {
    const hold = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${graceDate}', '11:00:00', '12:00:00', '${bobUid}', 200);`,
      { role: "authenticated", uid: bobUid }
    );
    assert.equal(hold.status, 0, hold.stderr);
    const { booking_id: bookingId, payment_id: paymentId } = JSON.parse(hold.stdout);
    runPsqlCommand(`UPDATE public.bookings SET hold_expires_at = now() - interval '5 minutes' WHERE id = '${bookingId}';`);

    const grid = runPsqlCommand(
      `SELECT count(*) || '|' || count(id) FROM public.get_public_slot_availability('${graceDate}') WHERE start_time = '11:00:00';`,
      { role: "anon", asRole: true }
    );
    assert.equal(grid.stdout, "1|0", "Grace-period hold must show as taken with its identity masked");

    // Cron calls this only after Stripe confirms the session is unpaid; it must not wait for the grace period
    const cancel = runPsqlCommand(`SELECT public.cancel_expired_booking('${bookingId}', '${paymentId}');`, { role: "service_role" });
    assert.equal(cancel.status, 0, cancel.stderr);
    assert.equal(JSON.parse(cancel.stdout).cancelled, true, cancel.stdout);
    const gridAfter = runPsqlCommand(
      `SELECT count(*) FROM public.get_public_slot_availability('${graceDate}') WHERE start_time = '11:00:00';`,
      { role: "anon", asRole: true }
    );
    assert.equal(gridAfter.stdout, "0", "Slot frees as soon as the Stripe-verified cleanup cancels the hold");

    for (const role of ["anon", "authenticated"]) {
      const call = runPsqlCommand(`SELECT public.hold_release_after(now(), now());`, { role, uid: aliceUid, asRole: true });
      assert.notEqual(call.status, 0, `${role} must not execute hold_release_after`);
      assert.ok(call.stderr.includes("permission denied"), call.stderr);
    }
  });

  await runTest("Grace period rollback: restores immediate release on a fresh database and re-applies cleanly", () => {
    const graceDb = "crosshair_grace_db";
    const created = runPsqlCommand(`CREATE DATABASE ${graceDb};`, { db: "postgres" });
    assert.equal(created.status, 0, created.stderr);
    for (const file of [
      fixturePath, migrationPath, stage2MigrationPath, stage1HoldExpiryPath, paymentReconciliationPath,
      paymentRefundFixPath, rlsMigrationPath, resilienceMigrationPath, tightenRlsMigrationPath,
      secureProfilesMigrationPath, launchHardeningMigrationPath, graceMigrationPath,
    ]) {
      runPsqlFile(file, { db: graceDb });
    }

    const releaseIn = (db, start, end) => runPsqlCommand(`
      INSERT INTO public.bookings (user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
      VALUES ('${aliceUid}', 'Alice', '${activeCourtId}', '${graceDate}', '${start}', '${end}', 'pending', 200, now() - interval '1 minute');
      SELECT public.release_expired_court_holds('${activeCourtId}', '${graceDate}', '${start}', '${end}');
    `, { db }).stdout.split("\n").pop();

    assert.equal(releaseIn(graceDb, "13:00:00", "14:00:00"), "0", "With the grace period, a 1-minute-old expired hold is not released");
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_hold_release_grace_period.sql"), { db: graceDb });
    assert.equal(
      runPsqlCommand(`SELECT (to_regprocedure('public.hold_release_after(timestamptz,timestamptz)') IS NULL)::text;`, { db: graceDb }).stdout,
      "true"
    );
    assert.equal(releaseIn(graceDb, "15:00:00", "16:00:00"), "1", "After rollback, expired holds release immediately again");

    runPsqlFile(graceMigrationPath, { db: graceDb });
    assert.equal(
      runPsqlCommand(`SELECT (to_regprocedure('public.hold_release_after(timestamptz,timestamptz)') IS NOT NULL)::text;`, { db: graceDb }).stdout,
      "true"
    );
  });

  await runTest("20261103 Supabase Cron: job calls the cleanup route with Vault secrets, is idempotent, and rolls back", () => {
    // postgres:15-alpine has no pg_cron / pg_net / Vault, so stub exactly what the job uses
    // (pg_net's http_get parameter names) and apply the real migration minus CREATE EXTENSION.
    const cronDb = "crosshair_cron_db";
    const created = runPsqlCommand(`CREATE DATABASE ${cronDb};`, { db: "postgres" });
    assert.equal(created.status, 0, created.stderr);

    const stubs = runPsqlCommand(`
      CREATE SCHEMA cron; CREATE SCHEMA net; CREATE SCHEMA vault;
      CREATE TABLE cron.job (jobname text PRIMARY KEY, schedule text, command text);
      CREATE FUNCTION cron.schedule(job_name text, schedule text, command text) RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO cron.job VALUES (job_name, schedule, command)
        ON CONFLICT (jobname) DO UPDATE SET schedule = EXCLUDED.schedule, command = EXCLUDED.command;
        SELECT 1::bigint;
      $$;
      CREATE FUNCTION cron.unschedule(job_name text) RETURNS boolean LANGUAGE sql AS $$
        DELETE FROM cron.job WHERE jobname = job_name RETURNING true;
      $$;
      CREATE TABLE net.calls (url text, headers jsonb, timeout_milliseconds int);
      CREATE FUNCTION net.http_get(url text, params jsonb DEFAULT '{}', headers jsonb DEFAULT '{}', timeout_milliseconds int DEFAULT 5000)
      RETURNS bigint LANGUAGE sql AS $$
        INSERT INTO net.calls VALUES (url, headers, timeout_milliseconds);
        SELECT 1::bigint;
      $$;
      CREATE TABLE vault.decrypted_secrets (name text, decrypted_secret text);
      INSERT INTO vault.decrypted_secrets VALUES ('crosshair_app_url', 'https://crosshair.example/'), ('crosshair_cron_secret', 'test-cron-secret');
    `, { db: cronDb });
    assert.equal(stubs.status, 0, stubs.stderr);

    const migrationSql = fs.readFileSync(path.join(PROJECT_ROOT, "supabase/migrations/20261028153353_20261103_supabase_cron_cleanup.sql"), "utf8");
    const withoutExtensions = migrationSql.replace(/^CREATE EXTENSION IF NOT EXISTS pg_(cron|net) .*$/gm, "");
    assert.equal(migrationSql.split("CREATE EXTENSION").length - 1, 2, "migration must enable pg_cron and pg_net");

    for (let i = 0; i < 2; i++) {
      const applied = runPsqlCommand(withoutExtensions, { db: cronDb });
      assert.equal(applied.status, 0, applied.stderr);
    }
    const job = runPsqlCommand(`SELECT count(*) || '|' || max(schedule) FROM cron.job WHERE jobname = 'cleanup-expired-bookings';`, { db: cronDb });
    assert.equal(job.stdout, "1|*/15 * * * *", "Re-applying must keep exactly one 15-minute job");

    // pg_cron executes the stored command text as a top-level statement; do the same
    const command = runPsqlCommand(`SELECT command FROM cron.job WHERE jobname = 'cleanup-expired-bookings';`, { db: cronDb }).stdout;
    const run = runPsqlCommand(command, { db: cronDb });
    assert.equal(run.status, 0, run.stderr);
    const call = runPsqlCommand(`SELECT url || '|' || (headers->>'Authorization') || '|' || timeout_milliseconds FROM net.calls;`, { db: cronDb });
    assert.equal(call.stdout, "https://crosshair.example/api/cron/cleanup-expired-bookings|Bearer test-cron-secret|15000");

    // Failure cases: a missing or blank secret fails the run visibly (cron.job_run_details) and sends nothing
    for (const [label, setup] of [
      ["missing secret", `DELETE FROM vault.decrypted_secrets WHERE name = 'crosshair_cron_secret';`],
      ["missing url", `DELETE FROM vault.decrypted_secrets WHERE name = 'crosshair_app_url';`],
      ["blank secret", `UPDATE vault.decrypted_secrets SET decrypted_secret = '' WHERE name = 'crosshair_cron_secret';`],
    ]) {
      runPsqlCommand(`TRUNCATE net.calls; TRUNCATE vault.decrypted_secrets;
        INSERT INTO vault.decrypted_secrets VALUES ('crosshair_app_url', 'https://crosshair.example'), ('crosshair_cron_secret', 'test-cron-secret');
        ${setup}`, { db: cronDb });
      const failed = runPsqlCommand(command, { db: cronDb });
      assert.notEqual(failed.status, 0, `${label}: run must fail`);
      assert.ok(failed.stderr.includes("Vault secret crosshair_app_url or crosshair_cron_secret is missing"), `${label}: ${failed.stderr}`);
      assert.ok(!failed.stderr.includes("test-cron-secret"), `${label}: error must not leak the secret`);
      assert.equal(runPsqlCommand(`SELECT count(*) FROM net.calls;`, { db: cronDb }).stdout, "0", `${label}: no request may be sent`);
    }

    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_20261103_supabase_cron_cleanup.sql"), { db: cronDb });
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_20261103_supabase_cron_cleanup.sql"), { db: cronDb });
    const afterRollback = runPsqlCommand(`SELECT count(*) FROM cron.job;`, { db: cronDb });
    assert.equal(afterRollback.stdout, "0", "Rollback must remove the job and be safe to re-run");
  });

  await runTest("customer_cancel_pending_only: customers can cancel their own pending hold directly, never a confirmed booking", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("customer_cancel_pending_only"));
    assert.ok(migration, "customer_cancel_pending_only migration file not found");
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/migrations", migration));

    const policyDate = "2029-12-19"; // not used by other tests
    const insert = (start, status) => runPsqlCommand(`
      INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
      VALUES ('${aliceUid}', '${activeCourtId}', '${policyDate}', '${start}', '${start.replace(/^(\d\d)/, (h) => String(+h + 1).padStart(2, "0"))}', '${status}', 200, now() + interval '30 minutes')
      RETURNING id;`).stdout.trim();
    const confirmedId = insert("08:00:00", "confirmed");
    const pendingId = insert("10:00:00", "pending");
    const cancelAsAlice = (id) => runPsqlCommand(
      `UPDATE public.bookings SET status = 'cancelled' WHERE id = '${id}' RETURNING id`,
      { role: "authenticated", uid: aliceUid, asRole: true }
    );

    const blocked = cancelAsAlice(confirmedId);
    assert.equal(blocked.status, 0, blocked.stderr);
    assert.equal(blocked.stdout.trim(), "", "A confirmed booking must not be cancellable by its customer directly");
    assert.equal(runPsqlCommand(`SELECT status FROM public.bookings WHERE id = '${confirmedId}';`).stdout.trim(), "confirmed");

    const allowed = cancelAsAlice(pendingId);
    assert.equal(allowed.stdout.trim(), pendingId, "A customer must still be able to release their own unpaid hold");

    // Service role (used by /api/bookings/cancel after its cutoff check) can still cancel confirmed bookings
    const viaRoute = runPsqlCommand(
      `UPDATE public.bookings SET status = 'cancelled' WHERE id = '${confirmedId}' AND user_id = '${aliceUid}' RETURNING id`,
      { role: "service_role", asRole: true }
    );
    assert.equal(viaRoute.stdout.trim(), confirmedId, viaRoute.stderr);

    // Rollback restores direct cancellation of confirmed bookings, and the migration re-applies cleanly
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_customer_cancel_pending_only.sql"));
    const reConfirmed = insert("12:00:00", "confirmed");
    assert.equal(cancelAsAlice(reConfirmed).stdout.trim(), reConfirmed, "Rollback must restore the previous policy");
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/migrations", migration));
  });

  await runTest("booking_cancel_reason: every cancellation path records why; expired holds cannot be settled; Pay Later walk-ins can", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("booking_cancel_reason"));
    assert.ok(migration, "booking_cancel_reason migration file not found");
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    const day = "2030-01-08"; // Tuesday (open 07:00 - 22:00), not used by other tests
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const pendingHold = (start, expiresSql) => {
      const end = `${String(Number(start.slice(0, 2)) + 1).padStart(2, "0")}:00:00`;
      const id = q(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, customer_name)
        VALUES ('${aliceUid}', '${activeCourtId}', '${day}', '${start}', '${end}', 'pending', 200, ${expiresSql}, 'Alice') RETURNING id;`);
      const paymentId = q(`INSERT INTO public.payments (booking_id, amount, currency, status) VALUES ('${id}', 200, 'php', 'pending') RETURNING id;`);
      return { id, paymentId };
    };
    const reasonOf = (id) => q(`SELECT status || '|' || coalesce(cancel_reason, '') FROM public.bookings WHERE id = '${id}';`);

    // Rows that exist before the migration: a timed-out hold and a cash booking that was refunded
    const old = pendingHold("07:00:00", "now() - interval '2 hours'");
    q(`UPDATE public.payments SET status = 'failed' WHERE id = '${old.paymentId}';
       UPDATE public.bookings SET status = 'cancelled', updated_at = now() WHERE id = '${old.id}';`);
    const refunded = pendingHold("08:00:00", "NULL");
    q(`UPDATE public.payments SET status = 'refunded', payment_method = 'cash', paid_at = now() WHERE id = '${refunded.paymentId}';
       UPDATE public.bookings SET status = 'cancelled', hold_expires_at = NULL WHERE id = '${refunded.id}';`);

    runPsqlFile(migrationPath);
    runPsqlFile(migrationPath); // idempotent
    assert.equal(reasonOf(old.id), "cancelled|expired", "Backfill marks the timed-out hold expired");
    assert.equal(reasonOf(refunded.id), "cancelled|", "Backfill leaves other cancellations unlabelled");
    assert.notEqual(runPsqlCommand(`UPDATE public.bookings SET cancel_reason = 'whatever' WHERE id = '${old.id}';`).status, 0, "Unknown reasons are rejected");

    // Cleanup job (cron / checkout.session.expired webhook) records expiry
    const cron = pendingHold("09:00:00", "now() - interval '30 minutes'");
    q(`SELECT public.cancel_expired_booking('${cron.id}', '${cron.paymentId}');`, { role: "service_role" });
    assert.equal(reasonOf(cron.id), "cancelled|expired");

    // A late Stripe payment for the expired hold is refunded automatically; the reason stays 'expired'
    const late = JSON.parse(q(`SELECT public.reconcile_booking_payment('${cron.id}', '${cron.paymentId}', 'cs_late_reason', 'pi_late_reason', 200, 'php');`, { role: "service_role" }));
    assert.equal(late.action, "REFUND_SCHEDULED");
    // The hold's payment was marked failed by cleanup, so the late charge is booked as a duplicate and refunded
    assert.equal(late.reason, "DUPLICATE_PAYMENT");
    assert.equal(reasonOf(cron.id), "cancelled|expired");
    assert.equal(q(`SELECT count(*) FROM public.refund_requests WHERE booking_id = '${cron.id}';`), "1");

    // Slot release: a new hold on the slot of a hold past its grace period cancels it as expired
    const stale = pendingHold("10:00:00", "now() - interval '25 minutes'");
    q(`SELECT public.hold_court_booking('${activeCourtId}', '${day}', '10:00:00', '11:00:00', '${bobUid}', 200, now() + interval '35 minutes');`,
      { role: "authenticated", uid: bobUid });
    assert.equal(reasonOf(stale.id), "cancelled|expired", "Released hold is labelled expired");

    // Late payment on a court taken out of service is refunded with its own reason
    const courtGone = pendingHold("12:00:00", "now() + interval '30 minutes'");
    q(`UPDATE public.courts SET status = 'maintenance' WHERE id = '${activeCourtId}';`);
    const gone = JSON.parse(q(`SELECT public.reconcile_booking_payment('${courtGone.id}', '${courtGone.paymentId}', 'cs_gone', 'pi_gone', 200, 'php');`, { role: "service_role" }));
    q(`UPDATE public.courts SET status = 'active' WHERE id = '${activeCourtId}';`);
    assert.equal(gone.reason, "COURT_UNAVAILABLE");
    assert.equal(reasonOf(courtGone.id), "cancelled|court_unavailable");

    // Counter payment: an expired online hold is refused; an active one still settles
    const expired = pendingHold("13:00:00", "now() - interval '1 minute'");
    const refused = runPsqlCommand(`SELECT public.settle_counter_payment('${expired.id}', '${expired.paymentId}', 'cash', 'REC-X');`, { role: "authenticated", uid: adminUid });
    assert.notEqual(refused.status, 0, "Expired hold must not be settled");
    assert.ok(refused.stderr.includes("HOLD_EXPIRED"), refused.stderr);
    assert.equal(q(`SELECT status FROM public.payments WHERE id = '${expired.paymentId}';`), "pending");
    const active = pendingHold("14:00:00", "now() + interval '20 minutes'");
    q(`SELECT public.settle_counter_payment('${active.id}', '${active.paymentId}', 'cash', 'REC-Y');`, { role: "authenticated", uid: adminUid });
    assert.equal(reasonOf(active.id), "confirmed|");

    // "Pay Later" walk-in (confirmed, payment pending) can now be collected at the counter
    const walkIn = JSON.parse(q(`SELECT public.create_walk_in_booking(
        p_court_id => '${activeCourtId}', p_customer_name => 'Pay Later Guest', p_booking_date => '${day}',
        p_start_time => '15:00:00', p_end_time => '16:00:00', p_amount => 200, p_customer_id => '${guestCustId}');`,
      { role: "authenticated", uid: adminUid }));
    const walkInPayment = q(`SELECT id FROM public.payments WHERE booking_id = '${walkIn.booking_id}';`);
    assert.equal(q(`SELECT b.status || '|' || p.status FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${walkIn.booking_id}';`), "confirmed|pending");
    q(`SELECT public.settle_counter_payment('${walkIn.booking_id}', '${walkInPayment}', 'gcash', 'GC-123');`, { role: "authenticated", uid: adminUid });
    assert.equal(q(`SELECT status || '|' || payment_method FROM public.payments WHERE id = '${walkInPayment}';`), "paid|gcash");

    // Customers may release their own pending hold directly only as a customer cancellation
    const own = pendingHold("17:00:00", "now() + interval '20 minutes'");
    const asAlice = (set) => runPsqlCommand(`UPDATE public.bookings SET ${set} WHERE id = '${own.id}' RETURNING id`, { role: "authenticated", uid: aliceUid, asRole: true });
    for (const spoof of ["status = 'cancelled', cancel_reason = 'admin'", "status = 'cancelled'"]) {
      const r = asAlice(spoof);
      assert.notEqual(r.status, 0, `Customer update must be refused: ${spoof}`);
      assert.ok(r.stderr.includes("row-level security"), r.stderr);
    }
    assert.equal(asAlice("status = 'cancelled', cancel_reason = 'customer'").stdout.trim(), own.id);

    // Rollback removes the column and restores the old behaviour; the migration re-applies cleanly
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_booking_cancel_reason.sql"));
    assert.equal(q(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'cancel_reason';`), "0");
    runPsqlFile(migrationPath);
  });

  await runTest("configurable_pricing: settings drive the charged price and booking length; only admins can change them", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("configurable_pricing"));
    assert.ok(migration, "configurable_pricing migration file not found");
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    runPsqlFile(migrationPath);
    runPsqlFile(migrationPath); // idempotent

    // Seeded with today's rules, so nothing changes until an admin edits pricing
    assert.equal(q(`SELECT base_hourly_rate || '|' || min_hours || '|' || max_hours FROM public.booking_settings;`), "200.00|1|3");
    assert.equal(Number(q(`SELECT public.quote_court_price('2030-01-08', '08:00', '11:00');`)), 600);

    // Same cases as tests/quote-court-price.test.mjs: database and app must agree
    const peaks = [
      { label: "Weeknight", days: ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"], start_time: "17:00", end_time: "22:00", hourly_rate: 300 },
      { label: "Weekend", days: ["Saturday", "Sunday"], start_time: "08:00", end_time: "23:00", hourly_rate: 280 },
      { label: "Friday prime", days: ["Friday"], start_time: "19:00", end_time: "21:00", hourly_rate: 350 },
    ];
    const save = (base, min, max, list, opts = { role: "authenticated", uid: adminUid }) => runPsqlCommand(
      `SELECT public.save_pricing_settings(${base}, ${min}, ${max}, '${JSON.stringify(list)}'::jsonb);`, opts);
    assert.equal(save(200, 1, 4, peaks).status, 0);
    for (const [date, start, end, total] of [
      ["2026-11-02", "15:00", "17:00", "400"], ["2026-11-02", "16:00", "18:00", "500"], ["2026-11-02", "21:00", "23:00", "500"],
      ["2026-11-06", "18:00", "20:00", "650"], ["2026-11-07", "07:00", "09:00", "480"],
    ]) {
      assert.equal(Number(q(`SELECT public.quote_court_price('${date}', '${start}', '${end}');`)), Number(total), `${date} ${start}-${end}`);
    }

    // Only admins (or the service role) can change pricing; a bad save changes nothing
    const nonAdmin = save(999, 1, 3, [], { role: "authenticated", uid: aliceUid });
    assert.ok(nonAdmin.stderr.includes("FORBIDDEN"), nonAdmin.stderr);
    const direct = runPsqlCommand(`UPDATE public.booking_settings SET base_hourly_rate = 1 RETURNING id;`, { role: "authenticated", uid: aliceUid, asRole: true });
    assert.equal(direct.stdout.trim(), "", "Customers cannot edit settings directly");
    assert.notEqual(runPsqlCommand(`INSERT INTO public.peak_rates (days, start_time, end_time, hourly_rate) VALUES ('{Monday}', '08:00', '09:00', 1);`, { role: "authenticated", uid: aliceUid, asRole: true }).status, 0);
    assert.equal(runPsqlCommand(`SELECT count(*) FROM public.peak_rates;`, { role: "anon", asRole: true }).stdout.trim(), "3", "Everyone can read peak rates");
    assert.notEqual(save(200, 4, 2, []).status, 0, "min above max is rejected");
    assert.notEqual(save(200, 1, 3, [{ days: ["Monday"], start_time: "10:30", end_time: "12:00", hourly_rate: 300 }]).status, 0, "Windows must be on the hour");
    assert.equal(q(`SELECT max_hours || '|' || (SELECT count(*) FROM public.peak_rates) FROM public.booking_settings;`), "4|3", "A rejected save leaves pricing unchanged");

    // Holds charge the quoted price and follow the configured length; walk-ins too
    const day = "2030-01-11"; // Friday (fixture: open 07:00 - 22:00)
    const hold = JSON.parse(q(`SELECT public.hold_court_booking('${activeCourtId}', '${day}', '18:00:00', '20:00:00', '${aliceUid}', NULL, now() + interval '35 minutes');`,
      { role: "authenticated", uid: aliceUid }));
    assert.equal(Number(hold.amount), 650);
    assert.equal(q(`SELECT b.total_amount || '|' || p.amount FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${hold.booking_id}';`), "650.00|650.00");
    const underpaid = runPsqlCommand(`SELECT public.hold_court_booking('${activeCourtId}', '${day}', '20:00:00', '21:00:00', '${aliceUid}', 200, now() + interval '35 minutes');`,
      { role: "authenticated", uid: aliceUid });
    assert.ok(underpaid.stderr.includes("INVALID_AMOUNT"), "A client-sent amount below the quote is rejected");

    assert.equal(save(250, 2, 4, []).status, 0);
    const tooShort = runPsqlCommand(`SELECT public.hold_court_booking('${activeCourtId}', '${day}', '08:00:00', '09:00:00', '${aliceUid}', NULL, now() + interval '35 minutes');`,
      { role: "authenticated", uid: aliceUid });
    assert.ok(tooShort.stderr.includes("between 2 and 4 consecutive hours"), tooShort.stderr);
    const walkIn = JSON.parse(q(`SELECT public.create_walk_in_booking(p_court_id => '${activeCourtId}', p_customer_name => 'Priced Walk-in', p_booking_date => '${day}',
        p_start_time => '10:00:00', p_end_time => '14:00:00', p_amount => 1000, p_customer_id => '${guestCustId}', p_payment_method => 'cash');`,
      { role: "authenticated", uid: adminUid }));
    assert.equal(Number(walkIn.amount), 1000);
    assert.equal(q(`SELECT total_amount FROM public.bookings WHERE id = '${hold.booking_id}';`), "650.00", "Existing bookings keep their price");

    // Rollback restores the fixed PHP 200 / 1-3 hour functions; the migration re-applies cleanly
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_configurable_pricing.sql"));
    assert.equal(q(`SELECT to_regclass('public.booking_settings') IS NULL;`), "t");
    runPsqlFile(migrationPath);
  });

  await runTest("auth_rate_limits: counts per key, blocks over the limit, restarts the window, and holds under concurrency", async () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("auth_rate_limits"));
    assert.ok(migration, "auth_rate_limits migration file not found");
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    runPsqlFile(migrationPath);
    runPsqlFile(migrationPath); // idempotent
    const check = (key, limit, increment = true) => {
      const r = runPsqlCommand(`SELECT public.check_rate_limit('${key}', ${limit}, 900, ${increment});`, { role: "service_role" });
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout);
    };

    // Attempts: allowed while count <= limit
    assert.deepEqual([1, 2, 3, 4].map(() => check("login:ip:198.51.100.1", 3).allowed), [true, true, true, false]);
    const blocked = check("login:ip:198.51.100.1", 3);
    assert.ok(blocked.retry_after_seconds > 0 && blocked.retry_after_seconds <= 900, JSON.stringify(blocked));

    // Failures: a read never counts; allowed while recorded failures < limit
    assert.equal(check("login:fail:a@example.com", 2, false).allowed, true);
    check("login:fail:a@example.com", 2);
    check("login:fail:a@example.com", 2);
    assert.equal(check("login:fail:a@example.com", 2, false).allowed, false);
    assert.equal(check("login:fail:b@example.com", 2, false).allowed, true, "Keys are independent");

    // A window older than its length restarts at 1
    runPsqlCommand(`UPDATE public.auth_rate_limits SET window_start = now() - interval '16 minutes' WHERE key = 'login:ip:198.51.100.1';`);
    const restarted = check("login:ip:198.51.100.1", 3);
    assert.equal(restarted.allowed, true);
    assert.equal(restarted.count, 1);

    // Ten simultaneous requests for one key are all counted (no lost updates)
    await Promise.all(Array.from({ length: 10 }, () => new Promise((resolve, reject) => {
      const child = spawn("docker", ["exec", "-i", CONTAINER_NAME, "psql", "-U", POSTGRES_USER, "-d", TEST_DB, "-v", "ON_ERROR_STOP=1", "-At"]);
      child.stdin.end(`BEGIN; SET LOCAL request.jwt.claim.role = 'service_role'; SELECT public.check_rate_limit('signup:ip:203.0.113.9', 100, 3600); COMMIT;`);
      child.on("close", (code) => (code === 0 ? resolve() : reject(new Error(`psql exited ${code}`))));
    })));
    assert.equal(runPsqlCommand(`SELECT count FROM public.auth_rate_limits WHERE key = 'signup:ip:203.0.113.9';`).stdout.trim(), "10");

    // Only the service role may use it
    for (const role of ["anon", "authenticated"]) {
      assert.notEqual(runPsqlCommand(`SELECT public.check_rate_limit('x', 1, 60);`, { role, uid: aliceUid, asRole: true }).status, 0, `${role} cannot call the limiter`);
      assert.notEqual(runPsqlCommand(`SELECT count(*) FROM public.auth_rate_limits;`, { role, uid: aliceUid, asRole: true }).status, 0, `${role} cannot read counters`);
    }

    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_auth_rate_limits.sql"));
    assert.equal(runPsqlCommand(`SELECT to_regclass('public.auth_rate_limits') IS NULL;`).stdout.trim(), "t");
    runPsqlFile(migrationPath);
  });

  await runTest("multi_court_basket: sibling payments share a Stripe session and intent", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("multi_court_basket"));
    assert.ok(migration, "multi_court_basket migration file not found");
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    runPsqlFile(migrationPath);
    const day = "2030-01-15"; // not used by other tests
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const basket = q(`SELECT gen_random_uuid();`);
    const sibling = (start, end) => {
      const b = q(`INSERT INTO public.bookings (user_id, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, customer_name, basket_id)
        VALUES ('${aliceUid}', '${activeCourtId}', '${day}', '${start}', '${end}', 'pending', 300, now() + interval '20 minutes', 'Alice', '${basket}') RETURNING id;`);
      const p = q(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, stripe_session_id)
        VALUES ('${b}', 300, 'php', 'pending', 'stripe', 'cs_shared') RETURNING id;`);
      return { b, p };
    };
    const A = sibling("09:00:00", "10:00:00");
    const B = sibling("10:00:00", "11:00:00");
    const reconcile = (s) => JSON.parse(q(`SELECT public.reconcile_booking_payment('${s.b}', '${s.p}', 'cs_shared', 'pi_shared', 300, 'php');`, { role: "service_role" }));
    reconcile(A);
    reconcile(B);
    assert.equal(q(`SELECT string_agg(b.status || '|' || p.status || '|' || p.stripe_payment_id, ',' ORDER BY b.start_time) FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.basket_id = '${basket}';`),
      "confirmed|paid|pi_shared,confirmed|paid|pi_shared");
    // Stripe redelivery: every basket row reconciled again is a no-op and adds no payments rows
    const basketPayments = () => q(`SELECT count(*) FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.basket_id = '${basket}';`);
    assert.equal(reconcile(A).action, "NO_OP");
    assert.equal(reconcile(B).action, "NO_OP");
    assert.equal(basketPayments(), "2");

    // A second payment for booking A only (Subcase 1.3): refund key is per booking, sibling B untouched
    const dupA = JSON.parse(q(`SELECT public.reconcile_booking_payment('${A.b}', '${A.p}', 'cs_dup', 'pi_dup', 300, 'php');`, { role: "service_role" }));
    assert.equal(dupA.action, "REFUND_SCHEDULED");
    assert.equal(dupA.reason, "DUPLICATE_PAYMENT");
    assert.equal(dupA.idempotency_key, `ref_duplicate_pi_pi_dup_${A.b}`);
    assert.equal(q(`SELECT b.status || '|' || p.status || '|' || p.stripe_payment_id FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${B.b}';`), "confirmed|paid|pi_shared");
    assert.equal(reconcile(B).action, "NO_OP");
    assert.equal(q(`SELECT count(*) FROM public.refund_requests WHERE booking_id = '${B.b}';`), "0");
    // The same duplicate payment for sibling B too: its own refund key, so both shares are refunded
    const dupB = JSON.parse(q(`SELECT public.reconcile_booking_payment('${B.b}', '${B.p}', 'cs_dup', 'pi_dup', 300, 'php');`, { role: "service_role" }));
    assert.equal(dupB.action, "REFUND_SCHEDULED");
    assert.equal(dupB.reason, "DUPLICATE_PAYMENT");
    assert.equal(dupB.idempotency_key, `ref_duplicate_pi_pi_dup_${B.b}`);
    assert.equal(q(`SELECT count(DISTINCT idempotency_key) FROM public.refund_requests WHERE booking_id IN ('${A.b}', '${B.b}');`), "2");

    // The same intent can still not be recorded twice for the SAME booking
    const dup = runPsqlCommand(`INSERT INTO public.payments (booking_id, amount, currency, status, payment_method, stripe_payment_id) VALUES ('${A.b}', 300, 'php', 'paid', 'stripe', 'pi_shared');`);
    assert.notEqual(dup.status, 0);
    assert.ok(dup.stderr.includes("uq_payments_intent_per_booking"), dup.stderr);

    // Rollback restores the global uniques; the migration re-applies cleanly
    q(`DELETE FROM public.refund_requests WHERE booking_id IN (SELECT id FROM public.bookings WHERE basket_id = '${basket}'); DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE basket_id = '${basket}'); DELETE FROM public.bookings WHERE basket_id = '${basket}';`);
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_multi_court_basket.sql"));
    assert.equal(q(`SELECT count(*) FROM information_schema.columns WHERE table_name = 'bookings' AND column_name = 'basket_id';`), "0");
    assert.equal(q(`SELECT count(*) FROM pg_indexes WHERE indexname IN ('idx_payments_stripe_payment_id', 'uq_payments_intent_per_booking');`), "1");
    assert.equal(q(`SELECT count(*) FROM pg_constraint WHERE conname = 'payments_stripe_session_id_key';`), "1");
    runPsqlFile(migrationPath);
  });

  await runTest("multi_court_basket: basket hold is all-or-nothing and a customer has one open basket", async () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("multi_court_basket"));
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    runPsqlFile(migrationPath);
    runPsqlFile(migrationPath); // idempotent
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const C1 = activeCourtId;
    const C2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const C3 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    q(`INSERT INTO public.courts (id, name, status) VALUES ('${C2}', 'Court 3 - Active', 'active'), ('${C3}', 'Court 4 - Active', 'active') ON CONFLICT (id) DO NOTHING;`);
    const day = "2030-01-22"; // Tuesday, not used by other tests
    const basket = (uid, lines, date = day) => runPsqlCommand(
      `SELECT public.hold_court_basket('${date}', '${JSON.stringify(lines)}'::jsonb);`, { role: "authenticated", uid });
    const line = (court_id, start_time, end_time) => ({ court_id, start_time, end_time });

    // (a) Two courts in one basket share basket_id; total is the sum of the quoted prices
    const a = basket(aliceUid, [line(C2, "09:00", "11:00"), line(C1, "09:00", "11:00")]);
    assert.equal(a.status, 0, a.stderr);
    const held = JSON.parse(a.stdout);
    assert.equal(held.items.length, 2);
    assert.deepEqual(held.items.map((i) => i.court_name), ["Court 1 - Active", "Court 3 - Active"]);
    assert.equal(q(`SELECT count(*) || '|' || count(DISTINCT basket_id) || '|' || bool_and(basket_id = '${held.basket_id}') FROM public.bookings WHERE id IN ('${held.items[0].booking_id}', '${held.items[1].booking_id}');`), "2|1|true");
    assert.equal(Number(held.total), Number(q(`SELECT 2 * public.quote_court_price('${day}', '09:00', '11:00');`)));
    assert.ok(held.hold_expires_at, "basket returns its hold expiry");

    // A client-supplied basket id cannot join another user's basket, another date, or a court already in it
    for (const [uid, date, court] of [[bobUid, day, C3], [aliceUid, "2030-02-05", C3], [aliceUid, day, C1]]) {
      const r = runPsqlCommand(`SELECT public.hold_court_booking(p_court_id => '${court}', p_booking_date => '${date}', p_start_time => '12:00', p_end_time => '14:00',
        p_user_id => '${uid}', p_amount => NULL, p_basket_id => '${held.basket_id}');`, { role: "authenticated", uid });
      assert.ok(r.stderr.includes("INVALID_ARGUMENT: p_basket_id"), `${uid} ${date} ${court}: ${r.stderr}`);
    }
    assert.equal(q(`SELECT count(*) FROM public.bookings WHERE basket_id = '${held.basket_id}';`), "2");

    // (b) One unavailable line fails the whole basket and names the court; nothing from it is left behind
    q(`INSERT INTO public.bookings (user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount)
       VALUES ('${danaUid}', 'Dana', '${C3}', '${day}', '13:00', '15:00', 'confirmed', 400);`);
    const b = basket(bobUid, [line(C3, "14:00", "16:00"), line(C1, "13:00", "15:00")]);
    assert.notEqual(b.status, 0, "basket with a taken line must fail");
    assert.ok(b.stderr.includes("SLOT_UNAVAILABLE: Court 4 - Active 02:00 PM–04:00 PM"), b.stderr);
    assert.equal(q(`SELECT count(*) FROM public.bookings WHERE user_id = '${bobUid}' AND booking_date = '${day}';`), "0");

    // (c) Bad lines are rejected at the boundary
    for (const [lines, msg] of [
      [[line(C1, "16:00", "18:00"), line(C1, "18:00", "20:00")], "Each court can appear once per booking"],
      [[], "INVALID_ARGUMENT"],
      [[{ court_id: C1, start_time: "16:00" }], "INVALID_ARGUMENT"],
      [Array.from({ length: 5 }, (_, i) => line(C1, `${10 + i}:00`, `${11 + i}:00`)), "INVALID_ARGUMENT"],
    ]) {
      const r = basket(bobUid, lines);
      assert.notEqual(r.status, 0, JSON.stringify(lines));
      assert.ok(r.stderr.includes(msg), r.stderr);
    }
    const notArray = runPsqlCommand(`SELECT public.hold_court_basket('${day}', '{}'::jsonb);`, { role: "authenticated", uid: bobUid });
    assert.ok(notArray.stderr.includes("INVALID_ARGUMENT"), notArray.stderr);

    // (d) A second basket (or single hold) while the first is open is refused; once it expires a new one succeeds
    const second = basket(aliceUid, [line(C3, "16:00", "18:00")]);
    assert.ok(second.stderr.includes("OPEN_BASKET_EXISTS"), second.stderr);
    const legacySecond = runPsqlCommand(`SELECT public.hold_court_booking(p_court_id => '${C3}', p_booking_date => '${day}', p_start_time => '18:00', p_end_time => '20:00',
      p_user_id => '${aliceUid}', p_amount => NULL, p_hold_expires_at => now() + interval '35 minutes');`, { role: "authenticated", uid: aliceUid });
    assert.ok(legacySecond.stderr.includes("OPEN_BASKET_EXISTS"), legacySecond.stderr);
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE basket_id = '${held.basket_id}';`);
    const afterExpiry = basket(aliceUid, [line(C3, "16:00", "18:00")]);
    assert.equal(afterExpiry.status, 0, afterExpiry.stderr);

    // (e) A legacy pending hold without basket_id blocks a new basket
    const legacyHold = q(`INSERT INTO public.bookings (user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at)
       VALUES ('${bobUid}', 'Bob', '${C1}', '${day}', '19:00', '20:00', 'pending', 200, now() + interval '20 minutes') RETURNING id;`);
    const blocked = basket(bobUid, [line(C2, "16:00", "18:00")]);
    assert.ok(blocked.stderr.includes("OPEN_BASKET_EXISTS"), blocked.stderr);

    // The old app's single-court call still works and becomes a basket of one; it is the customer's one open basket
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE id = '${legacyHold}';`);
    const single = JSON.parse(q(`SELECT public.hold_court_booking(p_court_id => '${C2}', p_booking_date => '${day}', p_start_time => '16:00', p_end_time => '18:00',
      p_user_id => '${bobUid}', p_amount => NULL, p_hold_expires_at => now() + interval '35 minutes');`, { role: "authenticated", uid: bobUid }));
    assert.equal(q(`SELECT basket_id FROM public.bookings WHERE id = '${single.booking_id}';`), single.basket_id);
    const singleAgain = runPsqlCommand(`SELECT public.hold_court_booking('${C2}', '${day}', '18:00', '20:00', '${bobUid}', NULL);`, { role: "authenticated", uid: bobUid });
    assert.ok(singleAgain.stderr.includes("OPEN_BASKET_EXISTS"), singleAgain.stderr);

    // (f) Baskets sharing two courts listed in opposite orders, at the same moment: exactly one wins, the loser keeps
    // nothing, no deadlock. A slow insert on raceDay keeps each session's first court lock held while the other starts,
    // so locking in list order (instead of court order) would deadlock.
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE status = 'pending' AND user_id IN ('${aliceUid}', '${bobUid}');`);
    const raceDay = "2030-01-29"; // Tuesday, not used by other tests
    q(`CREATE FUNCTION public.test_slow_insert() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(2); RETURN NEW; END; $$;
       CREATE TRIGGER test_slow_insert BEFORE INSERT ON public.bookings FOR EACH ROW WHEN (NEW.booking_date = '${raceDay}') EXECUTE FUNCTION public.test_slow_insert();`);
    const race = (uid, lines) => new Promise((resolve) => {
      const child = spawn("docker", ["exec", "-i", CONTAINER_NAME, "psql", "-U", POSTGRES_USER, "-d", TEST_DB, "-v", "ON_ERROR_STOP=1", "-q"]);
      let stderr = "";
      child.stderr.on("data", (d) => (stderr += d));
      child.on("close", (code) => resolve({ code, stderr }));
      child.stdin.end(`BEGIN; SET LOCAL request.jwt.claim.role = 'authenticated'; SET LOCAL request.jwt.claim.sub = '${uid}';
        SELECT public.hold_court_basket('${raceDay}', '${JSON.stringify(lines)}'::jsonb); COMMIT;`);
    });
    const [ra, rb] = await Promise.all([
      race(aliceUid, [line(C1, "10:00", "12:00"), line(C2, "10:00", "12:00")]),
      race(bobUid, [line(C2, "10:00", "12:00"), line(C1, "10:00", "12:00")]),
    ]);
    q(`DROP TRIGGER test_slow_insert ON public.bookings; DROP FUNCTION public.test_slow_insert();`);
    assert.ok(!ra.stderr.includes("deadlock") && !rb.stderr.includes("deadlock"), ra.stderr + rb.stderr);
    assert.equal([ra, rb].filter((r) => r.code === 0).length, 1, ra.stderr + rb.stderr);
    const loser = ra.code === 0 ? bobUid : aliceUid;
    assert.ok((ra.code === 0 ? rb : ra).stderr.includes("SLOT_UNAVAILABLE"), ra.stderr + rb.stderr);
    assert.equal(q(`SELECT count(*) FROM public.bookings WHERE user_id = '${loser}' AND booking_date = '${raceDay}';`), "0");
    assert.equal(q(`SELECT count(*) FROM public.bookings WHERE booking_date = '${raceDay}';`), "2");

    // Rollback restores the 7-argument hold with its 3-hold cap; the migration re-applies cleanly
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_multi_court_basket.sql"));
    assert.equal(q(`SELECT (to_regproc('public.hold_court_basket') IS NULL)
      || '|' || (to_regprocedure('public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz)') IS NOT NULL)
      || '|' || (SELECT count(*) FROM pg_proc WHERE proname = 'hold_court_booking')
      || '|' || (SELECT prosrc LIKE '%TOO_MANY_HOLDS%' FROM pg_proc WHERE proname = 'hold_court_booking')
      || '|' || has_function_privilege('authenticated', 'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz)', 'EXECUTE')
      || '|' || has_function_privilege('anon', 'public.hold_court_booking(uuid,date,time,time,uuid,numeric,timestamptz)', 'EXECUTE');`), "true|true|1|true|true|false");
    runPsqlFile(migrationPath);
    assert.equal(q(`SELECT has_function_privilege('anon', 'public.hold_court_basket(date,jsonb,timestamptz)', 'EXECUTE')
      || '|' || has_function_privilege('authenticated', 'public.hold_court_basket(date,jsonb,timestamptz)', 'EXECUTE');`), "false|true");
  });

  await runTest("multi_court_basket: customers cannot add a court to a basket or move a booking into one", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("multi_court_basket"));
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    runPsqlFile(migrationPath);
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const C1 = activeCourtId;
    const C2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const C3 = "dddddddd-dddd-dddd-dddd-dddddddddddd";
    q(`INSERT INTO public.courts (id, name, status) VALUES ('${C2}', 'Court 3 - Active', 'active'), ('${C3}', 'Court 4 - Active', 'active') ON CONFLICT (id) DO NOTHING;`);
    const day = "2030-02-12"; // Tuesday, not used by other tests
    const hold = (uid, lines) => JSON.parse(q(`SELECT public.hold_court_basket('${day}', '${JSON.stringify(lines)}'::jsonb);`, { role: "authenticated", uid }));
    const extend = (basketId, court, s, e) => runPsqlCommand(`SELECT public.hold_court_booking(p_court_id => '${court}', p_booking_date => '${day}', p_start_time => '${s}', p_end_time => '${e}',
      p_user_id => '${aliceUid}', p_amount => NULL, p_basket_id => '${basketId}');`, { role: "authenticated", uid: aliceUid });
    const count = (basketId) => q(`SELECT count(*) FROM public.bookings WHERE basket_id = '${basketId}';`);

    // Open basket: a direct call with its id is refused (a new court would ride on the basket's Stripe session)
    const open = hold(aliceUid, [{ court_id: C1, start_time: "09:00", end_time: "10:00" }, { court_id: C2, start_time: "09:00", end_time: "10:00" }]);
    const addOpen = extend(open.basket_id, C3, "09:00", "10:00");
    assert.ok(addOpen.stderr.includes("INVALID_ARGUMENT: p_basket_id"), addOpen.stderr);
    assert.equal(count(open.basket_id), "2");

    // Paid basket (C1): the same call is refused, so no free court can be confirmed on the paid session
    for (const item of open.items) {
      q(`SELECT public.reconcile_booking_payment('${item.booking_id}', '${item.payment_id}', 'cs_paid_x', 'pi_paid_x', ${item.amount}, 'php');`, { role: "service_role" });
    }
    const addPaid = extend(open.basket_id, C3, "11:00", "12:00");
    assert.ok(addPaid.stderr.includes("INVALID_ARGUMENT: p_basket_id"), addPaid.stderr);
    assert.equal(count(open.basket_id), "2");

    // C2: a customer cancelling their own hold cannot re-point it at the paid basket; a plain cancel still works
    const other = hold(aliceUid, [{ court_id: C3, start_time: "13:00", end_time: "14:00" }]);
    const otherId = other.items[0].booking_id;
    const asAlice = (set) => runPsqlCommand(`UPDATE public.bookings SET ${set} WHERE id = '${otherId}' RETURNING id`, { role: "authenticated", uid: aliceUid, asRole: true });
    const repoint = asAlice(`status = 'cancelled', cancel_reason = 'customer', basket_id = '${open.basket_id}'`);
    assert.notEqual(repoint.status, 0, "re-pointing basket_id must be refused");
    assert.ok(repoint.stderr.includes("basket_id"), repoint.stderr);
    assert.equal(q(`SELECT basket_id || '|' || status FROM public.bookings WHERE id = '${otherId}';`), `${other.basket_id}|pending`);
    assert.equal(asAlice("status = 'cancelled', cancel_reason = 'customer'").stdout.trim(), otherId);
    // Staff (admin JWT) cannot change it either; the service role can
    const asAdmin = runPsqlCommand(`UPDATE public.bookings SET basket_id = gen_random_uuid() WHERE id = '${otherId}'`, { role: "authenticated", uid: adminUid, asRole: true });
    assert.ok(asAdmin.stderr.includes("basket_id"), `admin JWT must not change basket_id: ${asAdmin.stderr}`);
    q(`UPDATE public.bookings SET basket_id = '${other.basket_id}' WHERE id = '${otherId}'`, { role: "service_role" });

    // Rollback removes the trigger with the column; the migration re-applies cleanly
    q(`DELETE FROM public.refund_requests WHERE booking_id IN (SELECT id FROM public.bookings WHERE booking_date = '${day}');
       DELETE FROM public.payments WHERE booking_id IN (SELECT id FROM public.bookings WHERE booking_date = '${day}');
       DELETE FROM public.bookings WHERE booking_date = '${day}';`);
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_multi_court_basket.sql"));
    assert.equal(q(`SELECT count(*) FROM pg_trigger WHERE tgname = 'bookings_basket_id_immutable';`), "0");
    assert.equal(q(`SELECT to_regproc('public.bookings_basket_id_immutable') IS NULL;`), "t");
    runPsqlFile(migrationPath);
  });

  await runTest("multi_court_basket: staff settle a whole unpaid basket all-or-nothing", () => {
    const migration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("multi_court_basket"));
    const migrationPath = path.join(PROJECT_ROOT, "supabase/migrations", migration);
    runPsqlFile(migrationPath);
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const C1 = activeCourtId;
    const C2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    q(`INSERT INTO public.courts (id, name, status) VALUES ('${C2}', 'Court 3 - Active', 'active') ON CONFLICT (id) DO NOTHING;`);
    const day = "2030-01-15"; // Tuesday, not used by other tests
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE user_id = '${danaUid}' AND status = 'pending';`); // earlier tests left dana an open hold
    const hold = (s, e) => JSON.parse(q(`SELECT public.hold_court_basket('${day}', '${JSON.stringify([
      { court_id: C1, start_time: s, end_time: e }, { court_id: C2, start_time: s, end_time: e }])}'::jsonb);`,
      { role: "authenticated", uid: danaUid })); // an expired hold still blocks its slot during the grace period, so each basket gets its own hours
    const settle = (basketId, uid, expected = 0, method = "cash") => runPsqlCommand(
      `SELECT public.settle_counter_basket(p_basket_id => '${basketId}', p_expected_amount => ${expected}, p_payment_method => '${method}');`, { role: "authenticated", uid });
    const state = (basketId) => q(`SELECT string_agg(b.status || '/' || p.status || '/' || coalesce(p.payment_method, '-'), ',' ORDER BY b.court_id)
      FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.basket_id = '${basketId}';`);

    // Non-admin is refused and nothing changes
    const b1 = hold("09:00", "11:00");
    const forbidden = settle(b1.basket_id, bobUid);
    assert.ok(forbidden.stderr.includes("FORBIDDEN"), forbidden.stderr);
    assert.equal(state(b1.basket_id), "pending/pending/-,pending/pending/-");

    // Expired hold: HOLD_EXPIRED and nothing changes
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE basket_id = '${b1.basket_id}';`);
    const expired = settle(b1.basket_id, adminUid);
    assert.ok(expired.stderr.includes("HOLD_EXPIRED"), expired.stderr);
    assert.equal(state(b1.basket_id), "pending/pending/-,pending/pending/-");

    // Success: every court confirmed and paid in cash; amount is the sum
    // A court cancelled after staff saw the total: AMOUNT_CHANGED and nothing is settled
    const b3 = hold("16:00", "18:00");
    q(`UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'customer' WHERE id = '${b3.items[0].booking_id}';`);
    const changed = settle(b3.basket_id, adminUid, b3.total);
    assert.ok(changed.stderr.includes("AMOUNT_CHANGED"), changed.stderr);
    assert.equal(q(`SELECT b.status || '/' || p.status FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.id = '${b3.items[1].booking_id}';`), "pending/pending");
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE basket_id = '${b3.basket_id}';`); // dana's one open basket

    const b2 = hold("13:00", "15:00");
    const ok = settle(b2.basket_id, adminUid, b2.total);
    assert.equal(ok.status, 0, ok.stderr);
    const res = JSON.parse(ok.stdout);
    assert.equal(res.settled, 2);
    assert.equal(res.basket_id, b2.basket_id);
    assert.equal(Number(res.amount), Number(b2.total));
    assert.equal(state(b2.basket_id), "confirmed/paid/cash,confirmed/paid/cash");

    // Centavo prices: staff's JS float sum (250.10 + 250.20 = 500.29999999999995) still settles
    const baseRate = q(`SELECT base_hourly_rate FROM public.booking_settings;`);
    q(`UPDATE public.booking_settings SET base_hourly_rate = 250.10;
       INSERT INTO public.peak_rates (label, days, start_time, end_time, hourly_rate) VALUES ('test-centavo', '{Tuesday}', '12:00', '13:00', 250.20);`);
    try {
      const cents = JSON.parse(q(`SELECT public.hold_court_basket('${day}', '${JSON.stringify([
        { court_id: C1, start_time: "11:00", end_time: "12:00" }, { court_id: C2, start_time: "12:00", end_time: "13:00" }])}'::jsonb);`,
        { role: "authenticated", uid: danaUid }));
      assert.equal(cents.total, 500.3);
      const centsOk = settle(cents.basket_id, adminUid, 250.1 + 250.2);
      assert.equal(centsOk.status, 0, centsOk.stderr);
      assert.equal(state(cents.basket_id), "confirmed/paid/cash,confirmed/paid/cash");
    } finally {
      q(`UPDATE public.booking_settings SET base_hourly_rate = ${baseRate}; DELETE FROM public.peak_rates WHERE label = 'test-centavo';`);
    }

    // Unknown basket, and an already-settled one, have nothing pending
    for (const id of ["99999999-9999-9999-9999-999999999999", b2.basket_id]) {
      const r = settle(id, adminUid);
      assert.ok(r.stderr.includes("NOT_FOUND"), r.stderr);
    }
    assert.ok(settle(b2.basket_id, bobUid).stderr.includes("FORBIDDEN"), "non-admin gets FORBIDDEN before NOT_FOUND");

    // Rollback drops it; the migration re-applies cleanly
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_multi_court_basket.sql"));
    assert.equal(q(`SELECT to_regproc('public.settle_counter_basket') IS NULL;`), "t");
    runPsqlFile(migrationPath);
    assert.equal(q(`SELECT has_function_privilege('anon', 'public.settle_counter_basket(uuid,numeric,text,text)', 'EXECUTE')
      || '|' || has_function_privilege('authenticated', 'public.settle_counter_basket(uuid,numeric,text,text)', 'EXECUTE');`), "false|true");
  });

  await runTest("gcash: hold, proof submission, and the slot stays held", () => {
    const dir = path.join(PROJECT_ROOT, "supabase/migrations");
    runPsqlFile(path.join(dir, fs.readdirSync(dir).find((f) => f.includes("multi_court_basket"))));
    const migrationPath = path.join(dir, fs.readdirSync(dir).find((f) => f.includes("gcash_manual_payment")));
    runPsqlFile(migrationPath);
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const as = (uid, asRole = false) => ({ role: "authenticated", uid, asRole });
    const C1 = activeCourtId;
    const C2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    q(`INSERT INTO public.courts (id, name, status) VALUES ('${C2}', 'Court 3 - Active', 'active') ON CONFLICT (id) DO NOTHING;`);
    const day = "2030-02-12"; // Tuesday, not used by other tests
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE user_id = '${danaUid}' AND status = 'pending';`);
    const lines = (...courts) => JSON.stringify(courts.map((c) => ({ court_id: c, start_time: "09:00", end_time: "10:00" })));
    const holdSql = `SELECT public.hold_gcash_basket('${day}', '${lines(C1, C2)}'::jsonb);`;
    const submit = (basket, ref, p, uid = danaUid) => runPsqlCommand(
      `SELECT public.submit_gcash_proof('${basket}', '${ref}', '${p}');`, as(uid));
    const state = (basket) => q(`SELECT string_agg(b.status || '/' || b.hold_expires_at || '/' || coalesce(p.payment_reference, '-') || '/' || (p.gcash_proof_path IS NOT NULL), ',' ORDER BY b.court_id)
      FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.basket_id = '${basket}';`);

    q(`UPDATE public.booking_settings SET gcash_account_name = NULL, gcash_number = NULL;`);
    const unconf = runPsqlCommand(holdSql, as(danaUid));
    assert.ok(unconf.stderr.includes("GCASH_NOT_CONFIGURED"), unconf.stderr);
    q(`UPDATE public.booking_settings SET gcash_account_name = 'Test Club', gcash_number = '09171234567';`);

    for (const set of ["gcash_account_name = 'Only Name'", "gcash_number = '09179999999'"]) {
      const p = runPsqlCommand(`UPDATE public.booking_settings SET gcash_account_name = NULL, gcash_number = NULL; UPDATE public.booking_settings SET ${set};`);
      assert.ok(p.stderr.includes("booking_settings_gcash_check"), p.stderr);
    }
    q(`UPDATE public.booking_settings SET gcash_account_name = 'Test Club', gcash_number = '09171234567';`);

    const h = JSON.parse(q(holdSql, as(danaUid)));
    assert.equal(h.items.length, 2);
    assert.equal(q(`SELECT string_agg(p.payment_method || '/' || p.status, ',') FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.basket_id = '${h.basket_id}';`), "gcash/pending,gcash/pending");
    const before = state(h.basket_id);

    const okPath = `${danaUid}/${h.basket_id}.png`;
    for (const [ref, p] of [["abc", okPath], ["1234567890", `${bobUid}/x.png`], ["1234567890", `${danaUid}/../x.png`]]) {
      const r = submit(h.basket_id, ref, p);
      assert.ok(r.stderr.includes("INVALID_ARGUMENT"), r.stderr);
      assert.equal(state(h.basket_id), before);
    }
    assert.ok(submit(h.basket_id, "1234567890", `${bobUid}/x.png`, bobUid).stderr.includes("NOT_FOUND"));

    // a customer's unsubmitted pending booking can only be cancelled as 'customer'
    assert.ok(runPsqlCommand(`UPDATE public.bookings SET status = 'cancelled', cancel_reason = 'admin' WHERE basket_id = '${h.basket_id}'`, as(danaUid, true)).stderr.includes("row-level security")); // WITH CHECK rejects it

    const ok = submit(h.basket_id, "1234 5678 90123", okPath);
    assert.equal(ok.status, 0, ok.stderr);
    assert.equal(JSON.parse(ok.stdout).submitted, 2);
    assert.equal(state(h.basket_id), "pending/infinity/1234567890123/true,pending/infinity/1234567890123/true");
    assert.equal(q(`SELECT count(*) FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.basket_id = '${h.basket_id}' AND p.gcash_submitted_at IS NULL;`), "0");
    assert.ok(submit(h.basket_id, "1234567890", okPath).stderr.includes("ALREADY_SUBMITTED"));
    assert.equal(q(`WITH u AS (UPDATE public.payments SET payment_reference = 'X' WHERE booking_id = '${h.items[0].booking_id}' RETURNING 1) SELECT count(*) FROM u;`, as(danaUid, true)), "0");
    // The owner cannot turn a submitted GCash hold back into a 40-minute Stripe hold
    const cch = runPsqlCommand(`SELECT public.confirm_checkout_hold('${h.items[0].booking_id}', '${h.items[0].payment_id}', 'cs_gcash', now() + interval '30 minutes');`, as(danaUid));
    assert.ok(cch.stderr.includes("INVALID_STATUS"), cch.stderr);
    assert.equal(state(h.basket_id), "pending/infinity/1234567890123/true,pending/infinity/1234567890123/true");

    // Still held: others cannot take the slot, expiry sweeps skip it
    const bobHold = runPsqlCommand(`SELECT public.hold_court_basket('${day}', '${lines(C1)}'::jsonb);`, as(bobUid));
    assert.ok(bobHold.stderr.includes("SLOT_UNAVAILABLE"), bobHold.stderr);
    q(`SELECT public.release_expired_court_holds('${C1}', '${day}', '09:00', '10:00');`, { role: "service_role" });
    assert.equal(state(h.basket_id), "pending/infinity/1234567890123/true,pending/infinity/1234567890123/true");
    const skip = JSON.parse(q(`SELECT public.cancel_expired_booking('${h.items[0].booking_id}');`, { role: "service_role" }));
    assert.equal(skip.reason, "HOLD_NOT_EXPIRED");

    // One open basket, and no direct customer cancel of a submitted booking
    const other = runPsqlCommand(`SELECT public.hold_court_basket('${day}', '${JSON.stringify([{ court_id: C1, start_time: "12:00", end_time: "13:00" }])}'::jsonb);`, as(danaUid));
    assert.ok(other.stderr.includes("OPEN_BASKET_EXISTS"), other.stderr);
    assert.equal(q(`WITH u AS (UPDATE public.bookings SET status = 'cancelled' WHERE basket_id = '${h.basket_id}' RETURNING 1) SELECT count(*) FROM u;`, as(danaUid, true)), "0");

    // Hold ran out before the proof arrived
    const a = JSON.parse(q(`SELECT public.hold_gcash_basket('${day}', '${JSON.stringify([{ court_id: C1, start_time: "14:00", end_time: "15:00" }])}'::jsonb);`, as(aliceUid)));
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE basket_id = '${a.basket_id}';`);
    assert.ok(submit(a.basket_id, "1234567890", `${aliceUid}/a.png`, aliceUid).stderr.includes("HOLD_EXPIRED"));

    runPsqlFile(path.join(PROJECT_ROOT, "supabase/rollback_gcash_manual_payment.sql"));
    for (const f of ["hold_gcash_basket", "submit_gcash_proof", "approve_gcash_basket", "reject_gcash_basket"]) assert.equal(q(`SELECT to_regproc('public.${f}') IS NULL;`), "t");
    assert.equal(q(`SELECT prosrc LIKE '%gcash%' FROM pg_proc WHERE proname = 'confirm_checkout_hold';`), "f");
    runPsqlFile(migrationPath);
    assert.equal(q(`SELECT has_function_privilege('anon', 'public.confirm_checkout_hold(uuid,uuid,text,timestamptz)', 'EXECUTE')::text
      || has_function_privilege('authenticated', 'public.confirm_checkout_hold(uuid,uuid,text,timestamptz)', 'EXECUTE')::text;`), "falsetrue");
    assert.equal(q(`SELECT has_function_privilege('anon', 'public.hold_gcash_basket(date,jsonb,timestamptz)', 'EXECUTE')::text
      || has_function_privilege('authenticated', 'public.hold_gcash_basket(date,jsonb,timestamptz)', 'EXECUTE')::text
      || has_function_privilege('anon', 'public.submit_gcash_proof(uuid,text,text)', 'EXECUTE')::text
      || has_function_privilege('authenticated', 'public.submit_gcash_proof(uuid,text,text)', 'EXECUTE')::text
      || has_function_privilege('anon', 'public.approve_gcash_basket(uuid)', 'EXECUTE')::text
      || has_function_privilege('authenticated', 'public.approve_gcash_basket(uuid)', 'EXECUTE')::text
      || has_function_privilege('anon', 'public.reject_gcash_basket(uuid)', 'EXECUTE')::text
      || has_function_privilege('authenticated', 'public.reject_gcash_basket(uuid)', 'EXECUTE')::text;`), "falsetruefalsetruefalsetruefalsetrue");
  });

  await runTest("gcash: admin approves or rejects a whole basket", () => {
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const as = (uid) => ({ role: "authenticated", uid });
    const C1 = activeCourtId;
    const C2 = "cccccccc-cccc-cccc-cccc-cccccccccccc";
    const day = "2030-02-19";
    q(`UPDATE public.booking_settings SET gcash_account_name = 'Test Club', gcash_number = '09171234567';`); // the previous test's rollback dropped the columns
    q(`UPDATE public.bookings SET status = 'cancelled' WHERE user_id = '${danaUid}' AND status = 'pending' AND hold_expires_at = 'infinity';`); // earlier test left a submitted basket open
    q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 second' WHERE user_id = '${danaUid}' AND status = 'pending' AND hold_expires_at <> 'infinity';`);
    const lines = (hour, ...courts) => JSON.stringify(courts.map((c) => ({ court_id: c, start_time: `${hour}:00`, end_time: `${Number(hour) + 1}:00` })));
    const hold = (hour, uid, ...courts) => JSON.parse(q(`SELECT public.hold_gcash_basket('${day}', '${lines(hour, ...courts)}'::jsonb);`, as(uid)));
    const submitted = (hour, ...courts) => {
      const h = hold(hour, danaUid, ...courts);
      q(`SELECT public.submit_gcash_proof('${h.basket_id}', 'REF123456', '${danaUid}/${h.basket_id}.png');`, as(danaUid));
      return h;
    };
    const approve = (b, uid = adminUid) => runPsqlCommand(`SELECT public.approve_gcash_basket('${b}');`, as(uid));
    const reject = (b, uid = adminUid) => runPsqlCommand(`SELECT public.reject_gcash_basket('${b}');`, as(uid));
    const state = (b) => q(`SELECT string_agg(b.status || '/' || p.status || '/' || coalesce(b.cancel_reason, '-') || '/' || coalesce(b.hold_expires_at::text, 'null') || '/' || (p.paid_at IS NOT NULL), ',' ORDER BY b.court_id)
      FROM public.bookings b JOIN public.payments p ON p.booking_id = b.id WHERE b.basket_id = '${b}';`);

    // Never submitted: NOT_FOUND for admin, FORBIDDEN for bob (checked first)
    const unsub = hold("11", aliceUid, C1);
    assert.ok(approve(unsub.basket_id).stderr.includes("NOT_FOUND"));
    assert.ok(reject(unsub.basket_id).stderr.includes("NOT_FOUND"));

    // Approve works even after the start time has passed
    const a = submitted("09", C1, C2);
    assert.ok(approve(a.basket_id, bobUid).stderr.includes("FORBIDDEN"));
    assert.ok(reject(a.basket_id, bobUid).stderr.includes("FORBIDDEN"));
    q(`UPDATE public.bookings SET booking_date = current_date - 1 WHERE basket_id = '${a.basket_id}';`);
    const ra = approve(a.basket_id);
    assert.equal(ra.status, 0, ra.stderr);
    assert.equal(JSON.parse(ra.stdout).approved, 2);
    assert.equal(state(a.basket_id), "confirmed/paid/-/null/true,confirmed/paid/-/null/true");
    assert.equal(q(`SELECT string_agg(DISTINCT payment_method, ',') FROM public.payments p JOIN public.bookings b ON b.id = p.booking_id WHERE b.basket_id = '${a.basket_id}';`), "gcash");

    // Partial basket: the cancelled court is left alone
    const b = submitted("10", C1, C2);
    q(`UPDATE public.bookings SET status = 'cancelled' WHERE basket_id = '${b.basket_id}' AND court_id = '${C2}';`);
    const rb = approve(b.basket_id);
    assert.equal(rb.status, 0, rb.stderr);
    const out = JSON.parse(rb.stdout);
    assert.equal(out.approved, 1);
    assert.equal(Number(out.amount), Number(q(`SELECT total_amount FROM public.bookings WHERE basket_id = '${b.basket_id}' AND court_id = '${C1}';`)));
    assert.equal(q(`SELECT status FROM public.bookings WHERE basket_id = '${b.basket_id}' AND court_id = '${C2}';`), "cancelled");
    assert.equal(q(`SELECT p.status FROM public.payments p JOIN public.bookings bk ON bk.id = p.booking_id WHERE bk.basket_id = '${b.basket_id}' AND bk.court_id = '${C2}';`), "pending");

    // Reject frees the slot and clears the awaiting-verification marker
    const rejectMigration = fs.readdirSync(path.join(PROJECT_ROOT, "supabase/migrations")).find((f) => f.includes("gcash_reject_clears_hold"));
    runPsqlFile(path.join(PROJECT_ROOT, "supabase/migrations", rejectMigration));
    const c = submitted("12", C1, C2);
    const rc = reject(c.basket_id);
    assert.equal(rc.status, 0, rc.stderr);
    assert.equal(JSON.parse(rc.stdout).rejected, 2);
    assert.equal(state(c.basket_id), "cancelled/failed/gcash_rejected/null/false,cancelled/failed/gcash_rejected/null/false");
    const bobHold = runPsqlCommand(`SELECT public.hold_court_basket('${day}', '${lines("12", C1)}'::jsonb);`, as(bobUid));
    assert.equal(bobHold.status, 0, bobHold.stderr);

    // Already decided
    for (const id of [a.basket_id, b.basket_id, c.basket_id]) {
      assert.ok(approve(id).stderr.includes("NOT_FOUND"));
      assert.ok(reject(id).stderr.includes("NOT_FOUND"));
    }
  });

  // --- Open play ---
  {
    const dir = path.join(PROJECT_ROOT, "supabase/migrations");
    const opFile = fs.readdirSync(dir).find((f) => f.includes("open_play_schema"));
    if (opFile) runPsqlFile(path.join(dir, opFile));
    const opSchedFile = fs.readdirSync(dir).find((f) => f.includes("open_play_schedule"));
    if (opSchedFile) runPsqlFile(path.join(dir, opSchedFile));
    const q = (sql, opts) => {
      const r = runPsqlCommand(sql, opts);
      assert.equal(r.status, 0, r.stderr);
      return r.stdout.trim();
    };
    const opDay = "2030-03-05"; // Tuesday, not used by other tests
    const schedId = "0b000000-0000-0000-0000-000000000001";
    const sessId = "0b000000-0000-0000-0000-000000000002";
    // 10:00-12:00 session, so every fixture row below uses the session's date and times
    const spot = (extra) => runPsqlCommand(
      `INSERT INTO public.bookings (court_id, open_play_session_id, booking_date, start_time, end_time, customer_name, status, total_amount, ${extra.cols})
       VALUES (${extra.court ?? "NULL"}, '${sessId}', '${opDay}', '10:00', '12:00', 'Op', '${extra.status ?? "confirmed"}', 0, ${extra.vals});`);
    const spotRow = (spots, status, hold = "NULL") => q(
      `INSERT INTO public.bookings (open_play_session_id, open_play_spots, user_id, booking_date, start_time, end_time, customer_name, status, total_amount, hold_expires_at)
       VALUES ('${sessId}', ${spots}, '${aliceUid}', '${opDay}', '10:00', '12:00', 'Op', '${status}', 0, ${hold}) RETURNING id;`).split("\n")[0];

    q(`INSERT INTO public.open_play_schedules (id, day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)
       VALUES ('${schedId}', 'Tuesday', '10:00', '12:00', ARRAY['${activeCourtId}']::uuid[], 6, 150);
       INSERT INTO public.open_play_sessions (id, schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
       VALUES ('${sessId}', '${schedId}', '${opDay}', '10:00', '12:00', ARRAY['${activeCourtId}']::uuid[], 6, 150, 'open');`);

    await runTest("Open play: a spot row needs a session and 1-4 spots, and has no court", () => {
      const withCourt = spot({ court: `'${activeCourtId}'`, cols: "open_play_spots, user_id", vals: `2, '${aliceUid}'` });
      assert.ok(withCourt.stderr.includes("bookings_court_or_open_play"), withCourt.stderr);
      const five = spot({ cols: "open_play_spots, user_id", vals: `5, '${aliceUid}'` });
      assert.ok(five.stderr.includes("bookings_court_or_open_play"), five.stderr);
      const ok = spot({ cols: "open_play_spots, user_id", vals: `2, '${aliceUid}'` });
      assert.equal(ok.status, 0, ok.stderr);
    });

    await runTest("Open play: a block row may have no owner but a spot row may not", () => {
      const block = spot({ court: `'${activeCourtId}'`, cols: "user_id, customer_id", vals: "NULL, NULL" });
      assert.equal(block.status, 0, block.stderr);
      const ownerless = spot({ cols: "open_play_spots", vals: "2" });
      assert.ok(ownerless.stderr.includes("bookings_customer_identity_check"), ownerless.stderr);
    });

    await runTest("Open play: spots taken counts active and fresh pending rows only", () => {
      q(`DELETE FROM public.bookings WHERE open_play_session_id = '${sessId}' AND court_id IS NULL;`);
      const confirmed = spotRow(2, "confirmed");
      spotRow(1, "pending", "now() + interval '10 minutes'");
      spotRow(3, "pending", "now() - interval '1 hour'");
      spotRow(4, "cancelled");
      spotRow(1, "pending", "'infinity'");
      assert.equal(q(`SELECT public.open_play_spots_taken('${sessId}');`), "4");
      assert.equal(q(`SELECT public.open_play_spots_taken('${sessId}', '${confirmed}');`), "2");
      assert.equal(q(`SELECT public.open_play_player_spots('${sessId}', '${aliceUid}', NULL);`), "4");
      assert.equal(q(`SELECT public.open_play_player_spots('${sessId}', '${bobUid}', NULL);`), "0");
    });

    await runTest("Open play: a block row blocks a court hold on the same court and time", () => {
      const r = runPsqlCommand(
        `SELECT public.hold_court_booking('${activeCourtId}', '${opDay}', '10:00:00', '11:00:00', '${aliceUid}', 200);`,
        { role: "authenticated", uid: aliceUid });
      assert.notEqual(r.status, 0);
      assert.ok(r.stderr.includes("SLOT_UNAVAILABLE"), r.stderr);
    });

    // Generator tests use their own two courts and one weekday each, so they do not touch other rows
    const gA = "0b0000a0-0000-0000-0000-00000000000a";
    const gB = "0b0000a0-0000-0000-0000-00000000000b";
    q(`INSERT INTO public.courts (id, name, status) VALUES ('${gA}', 'OP Court A', 'active'), ('${gB}', 'OP Court B', 'active');`);
    const gen = () => JSON.parse(q(`SELECT public.generate_open_play_sessions(28);`, { role: "service_role" }));
    const save = (id, dow, start, end, price) => q(
      `SELECT public.save_open_play_schedule(${id ? `'${id}'` : "NULL"}, '${dow}', '${start}', '${end}', ARRAY['${gA}','${gB}']::uuid[], 8, ${price});`,
      { role: "authenticated", uid: adminUid });
    const nextDate = (dow) => q(`SELECT (d)::date FROM generate_series((now() AT TIME ZONE 'Asia/Manila')::date, (now() AT TIME ZONE 'Asia/Manila')::date + 6, interval '1 day') d WHERE date_part('dow', d) = ${dow};`);
    const sessionOf = (sched, date) => q(`SELECT status || '|' || coalesce(flag_reason, '') || '|' || price_per_spot || '|' || id FROM public.open_play_sessions WHERE schedule_id = '${sched}' AND session_date = '${date}';`).split("|");
    const blocks = (sessId2) => q(`SELECT count(*) || '/' || count(*) FILTER (WHERE status = 'confirmed' AND total_amount = 0) FROM public.bookings WHERE open_play_session_id = '${sessId2}' AND court_id IS NOT NULL;`);

    await runTest("Open play: generator creates sessions and one block row per court", () => {
      const sid = save(null, "Tuesday", "18:00", "21:00", 150);
      const r = gen();
      assert.ok(r.created >= 1, JSON.stringify(r));
      const [status, , , id] = sessionOf(sid, nextDate(2));
      assert.equal(status, "open");
      assert.equal(blocks(id), "2/2");
    });

    await runTest("Open play: generator flags a date whose court is already booked and creates it once cleared", () => {
      const sid = save(null, "Wednesday", "18:00", "21:00", 150);
      const date = nextDate(3);
      const bk = q(`INSERT INTO public.bookings (court_id, user_id, booking_date, start_time, end_time, status, total_amount, customer_name)
        VALUES ('${gA}', '${aliceUid}', '${date}', '19:00', '20:00', 'confirmed', 200, 'Alice') RETURNING id;`).split("\n")[0];
      gen();
      const [status, reason, , id] = sessionOf(sid, date);
      assert.equal(status, "flagged");
      assert.ok(reason.includes("already booked"), reason);
      assert.equal(blocks(id), "0/0");
      q(`UPDATE public.bookings SET status = 'cancelled' WHERE id = '${bk}';`);
      gen();
      const [status2, reason2] = sessionOf(sid, date);
      assert.equal(status2, "open");
      assert.equal(reason2, "");
      assert.equal(blocks(id), "2/2");
    });

    await runTest("Open play: generator flags closed days and is idempotent", () => {
      const saved = q(`SELECT is_open || '|' || coalesce(open_time::text, '') || '|' || coalesce(close_time::text, '') FROM public.operating_hours WHERE day_of_week = 'Friday';`).split("|");
      q(`UPDATE public.operating_hours SET is_open = false WHERE day_of_week = 'Friday';`);
      try {
        const sid = save(null, "Friday", "18:00", "21:00", 150);
        gen();
        const [status, reason] = sessionOf(sid, nextDate(5));
        assert.equal(status, "flagged");
        assert.ok(reason.includes("Venue closed"), reason);
        const count = () => q(`SELECT (SELECT count(*) FROM public.open_play_sessions) || '/' || (SELECT count(*) FROM public.bookings WHERE open_play_session_id IS NOT NULL);`);
        const before = count();
        gen();
        assert.equal(count(), before);
      } finally {
        q(`UPDATE public.operating_hours SET is_open = ${saved[0] === "t"} WHERE day_of_week = 'Friday';`);
      }
    });

    await runTest("Open play: editing a schedule regenerates only unbooked sessions", () => {
      const sid = save(null, "Thursday", "10:00", "12:00", 150);
      gen();
      const dates = q(`SELECT session_date FROM public.open_play_sessions WHERE schedule_id = '${sid}' ORDER BY session_date LIMIT 2;`).split("\n");
      assert.equal(dates.length, 2);
      const [, , , bookedId] = sessionOf(sid, dates[0]);
      q(`INSERT INTO public.bookings (open_play_session_id, open_play_spots, user_id, booking_date, start_time, end_time, customer_name, status, total_amount)
        VALUES ('${bookedId}', 2, '${aliceUid}', '${dates[0]}', '10:00', '12:00', 'Op', 'confirmed', 300);`);
      assert.equal(save(sid, "Thursday", "10:00", "12:00", 200), sid);
      gen();
      const booked = sessionOf(sid, dates[0]);
      assert.equal(booked[2], "150.00");
      assert.equal(booked[3], bookedId);
      assert.equal(blocks(bookedId), "2/2");
      const fresh = sessionOf(sid, dates[1]);
      assert.equal(fresh[2], "200.00");
      assert.equal(blocks(fresh[3]), "2/2");
    });

    await runTest("Open play: a schedule with a deleted court is flagged and does not stop other schedules", () => {
      const sid = q(`INSERT INTO public.open_play_schedules (day_of_week, start_time, end_time, court_ids, capacity, price_per_spot)
        VALUES ('Saturday', '10:00', '12:00', ARRAY['${gA}','0b0000a0-0000-0000-0000-0000000000ff']::uuid[], 8, 150) RETURNING id;`).split("\n")[0];
      const good = save(null, "Sunday", "10:00", "12:00", 150);
      gen();
      const [status, reason] = sessionOf(sid, nextDate(6));
      assert.equal(status, "flagged");
      assert.ok(reason.includes("no longer exists"), reason);
      assert.equal(sessionOf(good, nextDate(0))[0], "open");
    });

    await runTest("Open play: schedule functions reject non-admins", () => {
      const as = { role: "authenticated", uid: aliceUid };
      for (const sql of [
        `SELECT public.save_open_play_schedule(NULL, 'Tuesday', '18:00', '21:00', ARRAY['${gA}']::uuid[], 8, 150);`,
        `SELECT public.set_open_play_schedule_active('${schedId}', false);`,
        `SELECT public.generate_open_play_sessions(28);`,
      ]) {
        const r = runPsqlCommand(sql, as);
        assert.notEqual(r.status, 0);
        assert.ok(r.stderr.includes("FORBIDDEN"), r.stderr);
      }
    });

    // Booking tests make their own future session per test (one schedule, one date each)
    const opBookFile = fs.readdirSync(dir).find((f) => f.includes("open_play_booking"));
    if (opBookFile) runPsqlFile(path.join(dir, opBookFile));
    let dayN = 0;
    const mkSession = (capacity, status = "open", price = 150) => {
      const id = q(`SELECT gen_random_uuid();`);
      const date = `2030-05-${String(++dayN).padStart(2, "0")}`;
      q(`INSERT INTO public.open_play_sessions (id, schedule_id, session_date, start_time, end_time, court_ids, capacity, price_per_spot, status)
         VALUES ('${id}', '${schedId}', '${date}', '10:00', '12:00', ARRAY['${activeCourtId}']::uuid[], ${capacity}, ${price}, '${status}');`);
      return id;
    };
    const holdSql = (sid, spots, method = "stripe") => `SELECT public.hold_open_play_spots('${sid}', ${spots}, '${method}');`;
    const hold = (sid, uid, spots, method) => runPsqlCommand(holdSql(sid, spots, method), { role: "authenticated", uid });
    const holdOk = (sid, uid, spots) => {
      const r = hold(sid, uid, spots);
      assert.equal(r.status, 0, r.stderr);
      return JSON.parse(r.stdout.trim().split("\n")[0]);
    };
    const bookingOf = (id) => q(`SELECT status || '|' || coalesce(cancel_reason, '') FROM public.bookings WHERE id = '${id}';`);
    const reconcile = (h, pi) => JSON.parse(q(
      `SELECT public.reconcile_booking_payment('${h.booking_id}', '${h.payment_id}', 'cs_${pi}', 'pi_${pi}', ${h.amount}, 'php');`,
      { role: "service_role" }));

    await runTest("Open play: hold prices spots and creates a pending payment", () => {
      const sid = mkSession(6);
      const h = holdOk(sid, aliceUid, 2);
      assert.equal(Number(h.amount), 300);
      assert.equal(q(`SELECT status || '|' || (court_id IS NULL) || '|' || open_play_spots || '|' || customer_name || '|' || booking_date || '|' || start_time FROM public.bookings WHERE id = '${h.booking_id}';`),
        `pending|true|2|${q(`SELECT coalesce(nullif(trim(full_name), ''), 'Online Player') FROM public.profiles WHERE id = '${aliceUid}';`)}|${q(`SELECT session_date FROM public.open_play_sessions WHERE id = '${sid}';`)}|10:00:00`);
      assert.equal(q(`SELECT status || '|' || payment_method || '|' || amount FROM public.payments WHERE id = '${h.payment_id}';`), "pending|stripe|300.00");
    });

    await runTest("Open play: hold refuses over capacity, over the player limit, bad spot counts and cancelled sessions", () => {
      const sid = mkSession(6);
      q(`INSERT INTO public.bookings (open_play_session_id, open_play_spots, user_id, booking_date, start_time, end_time, customer_name, status, total_amount)
         SELECT '${sid}', n, '${bobUid}', session_date, '10:00', '12:00', 'Bob', 'confirmed', 150 * n FROM public.open_play_sessions, unnest(ARRAY[4, 1]) n WHERE id = '${sid}';`);
      assert.ok(hold(sid, aliceUid, 2).stderr.includes("SESSION_FULL"));
      const sid2 = mkSession(20);
      holdOk(sid2, aliceUid, 3);
      assert.ok(hold(sid2, aliceUid, 2).stderr.includes("PLAYER_LIMIT"));
      for (const n of [0, 5]) assert.ok(hold(sid2, aliceUid, n).stderr.includes("INVALID_ARGUMENT"), `spots ${n}`);
      assert.ok(hold(sid2, aliceUid, 1, "cash").stderr.includes("INVALID_ARGUMENT"));
      const sid3 = mkSession(6, "cancelled");
      assert.ok(hold(sid3, aliceUid, 1).stderr.includes("SESSION_UNAVAILABLE"));
      assert.ok(hold("0b000000-0000-0000-0000-0000000000ee", aliceUid, 1).stderr.includes("NOT_FOUND"));
    });

    await runTest("Open play: concurrent holds for the last spot serialize, and exactly one succeeds", async () => {
      const sid = mkSession(1);
      const worker = (uid, pre) => new Promise((resolve) => {
        const child = spawn("docker", ["exec", "-i", CONTAINER_NAME, "psql", "-U", POSTGRES_USER, "-d", TEST_DB, "-v", "ON_ERROR_STOP=1", "-q"]);
        let stdout = "", stderr = "";
        child.stdout.on("data", (d) => (stdout += d));
        child.stderr.on("data", (d) => (stderr += d));
        child.on("close", (code) => resolve({ code, stdout, stderr }));
        child.stdin.end(`BEGIN;\n${pre}SET LOCAL request.jwt.claim.role = 'authenticated';\nSET LOCAL request.jwt.claim.sub = '${uid}';\n${holdSql(sid, 1)}\nCOMMIT;\n`);
      });
      // Worker 1 takes the session lock and sits on it, so worker 2 must wait and then see the spot gone
      const p1 = worker(aliceUid, `SELECT 1 FROM public.open_play_sessions WHERE id = '${sid}' FOR UPDATE;\nSELECT pg_sleep(1.2);\n`);
      await new Promise((r) => setTimeout(r, 300));
      const p2 = worker(bobUid, "");
      const [r1, r2] = await Promise.all([p1, p2]);
      assert.equal(r1.code, 0, r1.stderr);
      assert.notEqual(r2.code, 0);
      assert.ok(r2.stderr.includes("SESSION_FULL"), r2.stderr);
      assert.equal(q(`SELECT count(*) FROM public.bookings WHERE open_play_session_id = '${sid}' AND court_id IS NULL;`), "1");
    });

    await runTest("Open play: an expired hold is released and its spot sold again", () => {
      const sid = mkSession(2);
      const a = holdOk(sid, aliceUid, 2);
      assert.ok(hold(sid, bobUid, 1).stderr.includes("SESSION_FULL"));
      q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 hour' WHERE id = '${a.booking_id}';`);
      holdOk(sid, bobUid, 2);
      assert.equal(bookingOf(a.booking_id), "cancelled|expired");
      assert.equal(q(`SELECT status FROM public.payments WHERE id = '${a.payment_id}';`), "failed");
    });

    await runTest("Open play: confirm_checkout_hold rechecks capacity for spot rows", () => {
      const sid = mkSession(2);
      const a = holdOk(sid, aliceUid, 2);
      q(`UPDATE public.bookings SET hold_expires_at = now() - interval '1 hour' WHERE id = '${a.booking_id}';`);
      holdOk(sid, bobUid, 2); // releases Alice's row and fills the session
      q(`UPDATE public.bookings SET status = 'pending', cancel_reason = NULL, hold_expires_at = now() + interval '30 minutes' WHERE id = '${a.booking_id}';`);
      const r = runPsqlCommand(`SELECT public.confirm_checkout_hold('${a.booking_id}', '${a.payment_id}', 'cs_full', now() + interval '30 minutes');`, { role: "authenticated", uid: aliceUid });
      assert.notEqual(r.status, 0);
      assert.ok(r.stderr.includes("SESSION_FULL"), r.stderr);
      const sid2 = mkSession(4);
      const b = holdOk(sid2, aliceUid, 2);
      const ok = runPsqlCommand(`SELECT public.confirm_checkout_hold('${b.booking_id}', '${b.payment_id}', 'cs_ok', now() + interval '30 minutes');`, { role: "authenticated", uid: aliceUid });
      assert.equal(ok.status, 0, ok.stderr);
      q(`UPDATE public.open_play_sessions SET status = 'cancelled' WHERE id = '${sid2}';`);
      const gone = runPsqlCommand(`SELECT public.confirm_checkout_hold('${b.booking_id}', '${b.payment_id}', 'cs_ok2', now() + interval '30 minutes');`, { role: "authenticated", uid: aliceUid });
      assert.ok(gone.stderr.includes("SESSION_UNAVAILABLE"), gone.stderr);
    });

    await runTest("Open play: reconcile confirms a spot hold, and refunds when the session filled meanwhile or was cancelled", () => {
      const sid = mkSession(4);
      const h = holdOk(sid, aliceUid, 2);
      assert.equal(reconcile(h, "op1").action, "CONFIRMED");
      assert.equal(q(`SELECT status FROM public.payments WHERE id = '${h.payment_id}';`), "paid");
      assert.equal(bookingOf(h.booking_id), "confirmed|");

      const sid2 = mkSession(2);
      const full = holdOk(sid2, aliceUid, 2);
      // Others fill the session while Alice's hold is still pending (e.g. a walk-in sold the spots)
      q(`INSERT INTO public.bookings (open_play_session_id, open_play_spots, user_id, booking_date, start_time, end_time, customer_name, status, total_amount)
         SELECT '${sid2}', 2, '${bobUid}', session_date, '10:00', '12:00', 'Bob', 'confirmed', 300 FROM public.open_play_sessions WHERE id = '${sid2}';`);
      const conflict = reconcile(full, "op2");
      assert.equal(conflict.action, "REFUND_SCHEDULED");
      assert.equal(conflict.reason, "SLOT_CONFLICT");
      assert.equal(bookingOf(full.booking_id), "cancelled|slot_conflict");

      const sid3 = mkSession(4);
      const c = holdOk(sid3, aliceUid, 1);
      q(`UPDATE public.open_play_sessions SET status = 'cancelled' WHERE id = '${sid3}';`);
      const gone = reconcile(c, "op3");
      assert.equal(gone.action, "REFUND_SCHEDULED");
      assert.equal(gone.reason, "COURT_UNAVAILABLE");
      assert.equal(bookingOf(c.booking_id), "cancelled|court_unavailable");
    });
  }

  console.log("\n================================================================================");
  console.log(`ALL INTEGRATION TESTS PASSED: ${passedTests} checks passed against real PostgreSQL.`);
  console.log("================================================================================");
}

main()
  .catch((err) => {
    console.error("\nFATAL ERROR in integration runner:", err);
    process.exit(1);
  })
  .finally(() => {
    cleanup();
  });
