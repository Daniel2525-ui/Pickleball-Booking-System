import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brandName, splitBrandName, brandInitials, brandColor, onBrandColor, httpsUrl } from "../src/lib/brand.ts";

test("httpsUrl: only https links reach the footer", () => {
  assert.equal(httpsUrl(" https://facebook.com/venue "), "https://facebook.com/venue");
  assert.equal(httpsUrl("javascript:alert(1)"), undefined);
  assert.equal(httpsUrl("facebook.com/venue"), undefined);
  assert.equal(httpsUrl(""), undefined);
  assert.equal(httpsUrl(undefined), undefined);
});

test("brand colour: only a #RRGGBB value is used, and text on it stays readable", () => {
  assert.equal(brandColor("#1d4ed8"), "#1d4ed8");
  assert.equal(brandColor(" #0E7C66 "), "#0E7C66");
  assert.equal(brandColor("blue"), "#0E7C66");
  assert.equal(brandColor(undefined), "#0E7C66");
  assert.equal(onBrandColor("#0E7C66"), "#FFFFFF");
  assert.equal(onBrandColor("#1D4ED8"), "#FFFFFF");
  assert.equal(onBrandColor("#C6F432"), "#111816"); // lime is too light for white text
  assert.equal(onBrandColor("#FACC15"), "#111816");
  assert.equal(brandInitials("Riverside Pickle Club"), "RP");
  assert.equal(brandInitials("smashville"), "S");
});

test("brandName: trims, falls back when blank, keeps & and apostrophes as typed", () => {
  assert.equal(brandName(undefined, "X"), "X");
  assert.equal(brandName("   ", "X"), "X");
  assert.equal(brandName("  Dink & Drive ", "X"), "Dink & Drive");
  assert.equal(brandName("Joe's Courts", "X"), "Joe's Courts");
});

test("splitBrandName: last word is the accent, one word has no lead", () => {
  assert.deepEqual(splitBrandName("Crosshair Dinkers"), { lead: "Crosshair", accent: "Dinkers" });
  assert.deepEqual(splitBrandName("Smashville"), { lead: "", accent: "Smashville" });
  assert.deepEqual(splitBrandName("The Kitchen Club"), { lead: "The Kitchen", accent: "Club" });
});

// Each client deployment sets its own name, so the literal must live only in src/lib/brand.ts
test("no hard-coded venue name outside src/lib/brand.ts", () => {
  const walk = (dir) => readdirSync(dir).flatMap((f) => (statSync(join(dir, f)).isDirectory() ? walk(join(dir, f)) : [join(dir, f)]));
  const offenders = walk("src").filter((f) => !f.replaceAll("\\", "/").endsWith("src/lib/brand.ts") && readFileSync(f, "utf8").includes("Crosshair Dinkers"));
  assert.deepEqual(offenders, [], `Use VENUE_NAME from src/lib/brand.ts in: ${offenders.join(", ")}`);
});
