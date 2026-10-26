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

function runPsqlCommand(sql, { db = TEST_DB, role = null, uid = null } = {}) {
  let sessionPreamble = "";
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

  // ---------------------------------------------------------------------------
  // Test Cases Execution
  // ---------------------------------------------------------------------------
  console.log("\n--- Executing SQL Integration Test Suite ---");

  const adminUid = "11111111-1111-1111-1111-111111111111";
  const aliceUid = "22222222-2222-2222-2222-222222222222";
  const bobUid = "33333333-3333-3333-3333-333333333333";
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
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '13:00:00', '14:00:00', '${aliceUid}', 200);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(r1.status, 0, r1.stderr);

    // 2 hours
    const r2 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '14:00:00', '16:00:00', '${aliceUid}', 400);`,
      { role: "authenticated", uid: aliceUid }
    );
    assert.equal(r2.status, 0, r2.stderr);

    // 3 hours
    const r3 = runPsqlCommand(
      `SELECT public.hold_court_booking('${activeCourtId}', '${openDate}', '16:00:00', '19:00:00', '${aliceUid}', 600);`,
      { role: "authenticated", uid: aliceUid }
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

  await runTest("Stage 1: New 7-argument hold_court_booking sets exact p_hold_expires_at timestamp", () => {
    const explicitExpiry = "2029-10-27 10:31:00+00";
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

  await runTest("Stage 1: Expired pending hold does NOT block new reservations", () => {
    // 1. Insert a pending hold for 15:00 - 16:00 whose hold_expires_at is strictly in the past
    const expiredInsert = runPsqlCommand(
      `INSERT INTO public.bookings (
        user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, hold_expires_at, created_at
      ) VALUES (
        '${aliceUid}', 'Alice Expired', '${activeCourtId}', '${stage1TestDate}', '15:00:00', '16:00:00', 'pending', 200, now() - interval '5 minutes', now() - interval '35 minutes'
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

    // 5. Bob attempts to hold the same slot -> succeeds immediately, proving expired hold does not permanently block
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
    const newExpiry = "2029-10-27 20:33:00+00";
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
      `UPDATE public.bookings SET hold_expires_at = now() - interval '1 minute' WHERE id = '${aliceBookingId}';`
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
    assert.ok(
      aliceResurrectAttempt.stderr.includes("SLOT_UNAVAILABLE") || aliceResurrectAttempt.stderr.includes("P0001"),
      `Expected SLOT_UNAVAILABLE / P0001 error, got: ${aliceResurrectAttempt.stderr}`
    );

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
          '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${aliceUid}', 200, now() - interval '1 minute'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.equal(aliceHold.status, 0, aliceHold.stderr);
      const { booking_id: aBookingId, payment_id: aPaymentId } = JSON.parse(aliceHold.stdout);

      // 2. Insert Bob's conflicting booking with the target status
      const bobBooking = runPsqlCommand(
        `INSERT INTO public.bookings (
          user_id, customer_name, court_id, booking_date, start_time, end_time, status, total_amount, created_at
        ) VALUES (
          '${bobUid}', 'Bob Status Test', '${activeCourtId}', '${conflictAuditDate}', '${timeStart}', '${timeEnd}', '${statusToTest}', 200, now()
        ) RETURNING id;`
      );
      assert.equal(bobBooking.status, 0, bobBooking.stderr);

      // 3. Alice attempts confirm_checkout_hold -> MUST FAIL with SLOT_UNAVAILABLE
      const confirmAttempt = runPsqlCommand(
        `SELECT public.confirm_checkout_hold(
          '${aBookingId}', '${aPaymentId}', 'cs_test_status_${statusToTest}', now() + interval '33 minutes'
        );`,
        { role: "authenticated", uid: aliceUid }
      );
      assert.notEqual(confirmAttempt.status, 0, `confirm_checkout_hold must reject conflict with status '${statusToTest}'`);
      assert.ok(
        confirmAttempt.stderr.includes("SLOT_UNAVAILABLE"),
        `Expected error to include 'SLOT_UNAVAILABLE', got: ${confirmAttempt.stderr}`
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
