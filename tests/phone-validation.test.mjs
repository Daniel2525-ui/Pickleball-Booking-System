import test from "node:test";
import assert from "node:assert/strict";

function sanitizePhone(raw) {
  let val = raw.replace(/\D/g, "");
  if (val.startsWith("639") && val.length === 12) {
    val = "0" + val.slice(2);
  }
  return val.slice(0, 11);
}

function isValidPhone(phone) {
  const sanitized = phone.replace(/\D/g, "");
  return sanitized.length === 11;
}

test("phone sanitization strips misplaced spaces and non-digits", () => {
  assert.equal(sanitizePhone("0917 123 4567"), "09171234567");
  assert.equal(sanitizePhone(" 0917  123 4567 "), "09171234567");
  assert.equal(sanitizePhone("0917-123-4567"), "09171234567");
  assert.equal(sanitizePhone("0917abc1234"), "09171234");
});

test("phone sanitization converts +63 PH prefix to 09 format", () => {
  assert.equal(sanitizePhone("+63 917 123 4567"), "09171234567");
  assert.equal(sanitizePhone("639171234567"), "09171234567");
});

test("phone validation enforces exactly 11 numbers", () => {
  assert.equal(isValidPhone("09171234567"), true);
  assert.equal(isValidPhone("0917123456"), false);
  assert.equal(isValidPhone("091712345678"), false);
  assert.equal(isValidPhone(""), false);
  assert.equal(isValidPhone("0917 123 4567"), true); // stripped
});
