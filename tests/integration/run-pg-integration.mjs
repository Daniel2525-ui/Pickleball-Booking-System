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
    const probe = spawnSync("docker", ["exec", CONTAINER_NAME, "pg_isready", "-U", POSTGRES_USER]);
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
