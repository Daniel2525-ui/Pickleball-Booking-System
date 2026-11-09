import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { brandName, splitBrandName } from "../src/lib/brand.ts";

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
