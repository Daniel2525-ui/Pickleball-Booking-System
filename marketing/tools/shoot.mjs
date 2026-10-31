// Phone screenshots of the real flow against the LOCAL app on :3200 (seed.sql data). Usage: node shoot.mjs <outDir>
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const base = "http://localhost:3200";
const out = process.argv[2];
if (!/^http:\/\/localhost:3200$/.test(base)) throw new Error("local only");
mkdirSync(out, { recursive: true });

const browser = await chromium.launch();
const page = await (await browser.newContext({
  viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true,
})).newPage();
// Hide the Next.js dev badge so it doesn't appear in shots
const clean = () => page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
const shot = async (name) => { await clean(); await page.waitForTimeout(600); await page.screenshot({ path: `${out}/${name}.png` }); };

await page.goto(`${base}/login`);
await page.getByLabel("Email Address").fill(process.env.E2E_CUSTOMER_EMAIL);
await page.getByLabel("Password", { exact: true }).fill(process.env.E2E_CUSTOMER_PASSWORD);
await page.getByRole("button", { name: "Sign In to Account" }).click();
await page.waitForURL((u) => !u.pathname.startsWith("/login"));

await page.goto(`${base}/#booking`);
await page.locator("#booking").scrollIntoViewIfNeeded();
await shot("home");

await page.getByRole("button", { name: "See the full board" }).click();
await page.getByRole("button", { name: /Tmrw/ }).click();
await page.locator("#booking").getByRole("button", { name: /Select COURT 1 at/ }).first().waitFor();
// Start the shot at the timetable, just under the sticky header
await page.getByText("Available Times", { exact: false }).first().evaluate((el) => window.scrollTo(0, el.getBoundingClientRect().top + window.scrollY - 100));
await shot("board");

const slot = (court, time) => page.locator("#booking").getByRole("button", { name: `Select ${court} at ${time}` });
await slot("COURT 2", "8:00 PM - 9:00 PM").click();
await slot("COURT 2", "9:00 PM - 10:00 PM").click();
await shot("basket");

await page.getByRole("region", { name: "Your basket" }).getByRole("button", { name: "Continue to Checkout" }).click();
const dialog = page.getByRole("dialog");
await dialog.getByRole("radio", { name: "GCash" }).click();
await shot("checkout");

await dialog.getByRole("button", { name: "Continue to Checkout" }).click();
await page.waitForURL(/\/book\/gcash\?basket=/);
await page.getByRole("button", { name: "Submit payment" }).waitFor();
// The seeded number could belong to a real person: never publish it
await page.evaluate(() => {
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n; (n = walk.nextNode());) n.nodeValue = n.nodeValue.replace("09171234567", "0917 ••• ••••");
});
await shot("gcash");

await page.goto(`${base}/my-bookings`);
await page.getByText("COURT 2").first().waitFor();
await shot("my-bookings");

await browser.close();
console.log("shots saved to", out);
