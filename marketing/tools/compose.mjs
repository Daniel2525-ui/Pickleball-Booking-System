// Frames phone screenshots into branded social images. Usage: node compose.mjs <shotsDir> <outDir>
import { chromium } from "@playwright/test";
import { readFileSync, mkdirSync } from "node:fs";

const [shots, out] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const img = (name) => `data:image/png;base64,${readFileSync(`${shots}/${name}.png`).toString("base64")}`;

const NAVY = "#060d1a", LIME = "#bff538";
const mark = (size) => `<svg width="${size}" height="${size}" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#0c1626"/>
  <g fill="none" stroke="${LIME}" stroke-width="2.5" stroke-linecap="round"><circle cx="16" cy="16" r="9"/>
  <path d="M16 3.5v5M16 23.5v5M3.5 16h5M23.5 16h5"/></g><circle cx="16" cy="16" r="2.5" fill="${LIME}"/></svg>`;
const brand = (size) => `<div class="brand">${mark(size)}<span>Crosshair <b>Dinkers</b></span></div>`;
// A phone frame around a 390x844 screenshot; `w` is the frame width in px
const phone = (shot, w, from = 0) => `<div class="phone" style="position:relative;width:${w}px"><div class="screen"><img src="${img(shot)}" style="margin-top:${-from * (w - 28) / 390}px"></div></div>`;

const css = `
* { margin: 0; box-sizing: border-box; }
body { width: var(--w); height: var(--h); overflow: hidden; background: ${NAVY};
  background-image: radial-gradient(circle at 85% 8%, rgba(191,245,56,.16), transparent 42%),
    radial-gradient(circle at 10% 95%, rgba(191,245,56,.08), transparent 40%);
  color: #e8edf5; font-family: Manrope, Arial, sans-serif; position: relative; }
.brand { display: flex; align-items: center; gap: 18px; font: 800 40px/1 "Big Shoulders", Arial; letter-spacing: 1px; text-transform: uppercase; }
.brand b { color: ${LIME}; font-weight: 800; }
h1 { font: 800 var(--hs)/0.92 "Big Shoulders", Arial; text-transform: uppercase; letter-spacing: .5px; }
h1 em { color: ${LIME}; font-style: normal; }
p.sub { font: 600 var(--ps)/1.35 Manrope, Arial; color: #b8c2d3; }
.pill { display: inline-block; background: ${LIME}; color: ${NAVY}; font: 800 30px/1 Manrope, Arial; padding: 18px 30px; border-radius: 999px; }
.phone { position: absolute; padding: 14px; background: #1b2433; border-radius: 64px;
  box-shadow: 0 40px 80px rgba(0,0,0,.55), 0 0 0 2px #2a3547 inset; }
.screen { border-radius: 52px; overflow: hidden; }
.phone img { display: block; width: 100%; }
`;

const page = (w, h, hs, ps, body) => `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Big+Shoulders:wght@800&family=Manrope:wght@600;800&display=swap" rel="stylesheet">
<style>${css} :root{--w:${w}px;--h:${h}px;--hs:${hs}px;--ps:${ps}px}</style></head><body>${body}</body></html>`;

// Portrait feed post: copy on top, phone right under it running off the bottom edge (follows the copy's height)
const portrait = (shot, title, sub, from = 0) => page(1080, 1350, 120, 38, `
  <div style="padding:72px 80px 0">${brand(64)}
    <h1 style="margin-top:56px">${title}</h1><p class="sub" style="margin-top:26px;max-width:860px">${sub}</p>
    <div style="display:flex;justify-content:center;margin-top:60px">${phone(shot, 600, from)}</div></div>`);

const posts = [
  ["post-1-board", portrait("board", "Open courts, <em>live.</em>", "See every free slot across all 4 courts and book in seconds.")],
  ["post-2-pay-your-way", portrait("checkout", "Pay <em>your way.</em>", "Card or GCash, right from your phone. ₱120 an hour per court.", 236)],
  ["post-3-gcash", portrait("gcash", "GCash? <em>Easy.</em>", "Send the amount, add your receipt, and we confirm your court.")],
  ["post-4-my-bookings", portrait("my-bookings", "All your games, <em>one place.</em>", "Upcoming matches and past sessions, always in your pocket.")],
  ["square-home", page(1080, 1080, 112, 34, `
    <div style="position:absolute;left:72px;top:72px;width:470px">${brand(56)}
      <h1 style="margin-top:70px">Book your court in <em>seconds.</em></h1>
      <p class="sub" style="margin-top:28px">Live availability for all 4 courts. Paddles and balls included.</p>
      <div class="pill" style="margin-top:44px">Book online</div></div>
    <div style="position:absolute;left:600px;top:110px">${phone("home", 430)}</div>`)],
  ["story-home", page(1080, 1920, 150, 44, `
    <div style="position:absolute;left:90px;top:120px;right:90px">${brand(72)}
      <h1 style="margin-top:80px">Your next game<br>starts <em>here.</em></h1>
      <p class="sub" style="margin-top:32px">See open courts live and book in seconds.</p>
      <span class="pill" style="margin-top:44px;font-size:38px;padding:24px 42px">Book online · Butuan City</span></div>
    <div style="position:absolute;left:50%;top:1010px;transform:translateX(-50%)">${phone("home", 640)}</div>`)],
  ["link-preview", page(1200, 630, 96, 30, `
    <div style="position:absolute;left:70px;top:64px;width:640px">${brand(56)}
      <h1 style="margin-top:46px">Book a court in <em>Butuan City.</em></h1>
      <p class="sub" style="margin-top:22px">Live availability. Pay by card or GCash.</p></div>
    <div style="position:absolute;left:800px;top:70px">${phone("home", 330)}</div>`)],
];

const browser = await chromium.launch();
for (const [name, html] of posts) {
  const [w, h] = name === "link-preview" ? [1200, 630] : name.startsWith("story") ? [1080, 1920] : name.startsWith("square") ? [1080, 1080] : [1080, 1350];
  const p = await browser.newPage({ viewport: { width: w, height: h } });
  await p.setContent(html, { waitUntil: "networkidle" });
  await p.evaluate(() => document.fonts.ready);
  await p.screenshot({ path: `${out}/${name}-${w}x${h}.png` });
  await p.close();
}
await browser.close();
console.log("wrote", posts.length, "images to", out);
