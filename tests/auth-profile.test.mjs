import test from "node:test";
import assert from "node:assert/strict";

function resolveProfileData(user, email) {
  const meta = user.user_metadata || {};
  return {
    id: user.id,
    email: user.email || email,
    full_name: meta.full_name || meta.name || email.split("@")[0] || "Player",
    phone: meta.phone || "",
    role: "customer",
  };
}

test("resolves profile data from user metadata", () => {
  const user = {
    id: "11111111-1111-1111-1111-111111111111",
    email: "love.sudario@deped.gov.ph",
    user_metadata: { full_name: "Love Sudario", phone: "09123456789" },
  };

  const profile = resolveProfileData(user, "love.sudario@deped.gov.ph");
  assert.equal(profile.id, "11111111-1111-1111-1111-111111111111");
  assert.equal(profile.email, "love.sudario@deped.gov.ph");
  assert.equal(profile.full_name, "Love Sudario");
  assert.equal(profile.phone, "09123456789");
  assert.equal(profile.role, "customer");
});

test("falls back gracefully when metadata is missing", () => {
  const user = {
    id: "22222222-2222-2222-2222-222222222222",
    email: "user@example.com",
    user_metadata: {},
  };

  const profile = resolveProfileData(user, "user@example.com");
  assert.equal(profile.full_name, "user");
  assert.equal(profile.phone, "");
  assert.equal(profile.role, "customer");
});
