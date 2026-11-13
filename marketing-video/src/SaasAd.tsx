import type { CSSProperties, ReactNode } from "react";
import {
  AbsoluteFill, Easing, Img, Sequence, interpolate, spring, staticFile, useCurrentFrame, useVideoConfig, Interactive,
} from "remotion";
import { loadFont as loadDisplay } from "@remotion/google-fonts/BigShoulders";
import { loadFont as loadBody } from "@remotion/google-fonts/Manrope";

const display = loadDisplay("normal", { weights: ["800"], subsets: ["latin"] }).fontFamily;
const body = loadBody("normal", { weights: ["500", "700", "800"], subsets: ["latin"] }).fontFamily;

// Same palette as marketing-assets/facebook/source/*.html
const INK = "#060d1a", LIME = "#bff538", MUTED = "#b6c2d6";

// [start, length] in frames @30fps — 20s total
const S = { hook: [0, 90], book: [90, 120], pay: [210, 120], admin: [330, 150], cta: [480, 120] } as const;
export const DURATION = 600;

const clamp = { extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

/** Fades a scene in over its first 10 frames and out over its last 10. */
const Scene = ({ len, children }: { len: number; children: ReactNode }) => {
  const f = useCurrentFrame();
  const opacity = interpolate(f, [0, 10, len - 10, len], [0, 1, 1, 0], clamp);
  return <AbsoluteFill style={{ opacity, padding: "0 72px", fontFamily: body, color: "#fff" }}>{children}</AbsoluteFill>;
};

const useIn = (delay = 0) => {
  const { fps } = useVideoConfig();
  return spring({ frame: useCurrentFrame() - delay, fps, config: { damping: 200 } });
};

const Rise = ({ delay = 0, children, style }: { delay?: number; children: ReactNode; style?: CSSProperties }) => {
  const p = useIn(delay);
  return <div style={{ opacity: p, transform: `translateY(${(1 - p) * 40}px)`, ...style }}>{children}</div>;
};

const Headline = ({ children, size = 104 }: { children: ReactNode; size?: number }) => (
  <h1 style={{ margin: 0, font: `800 ${size}px/.92 ${display}`, textTransform: "uppercase", letterSpacing: 0.5 }}>{children}</h1>
);
const Em = ({ children }: { children: ReactNode }) => <span style={{ color: LIME }}>{children}</span>;
const Label = ({ children }: { children: ReactNode }) => (
  <div style={{ font: `800 22px/1 ${body}`, letterSpacing: 3, textTransform: "uppercase", color: LIME, marginBottom: 22 }}>{children}</div>
);
const Sub = ({ children }: { children: ReactNode }) => (
  <p style={{ margin: "24px 0 0", font: `500 34px/1.38 ${body}`, color: MUTED }}>{children}</p>
);

// A screenshot shown from frame `at`; a click at frame `f` on (x, y) as fractions of the screenshot.
type Screen = { src: string; at: number };
type Click = { f: number; x: number; y: number };
const MOVE = 14; // frames the cursor travels before each click

/**
 * Screenshots that swap after clicks, plus a cursor that travels to each click and presses.
 * Screenshots are bottom-anchored when taller than the viewport, so click y maps through that offset.
 */
const Demo = ({ screens, clicks, width, viewH, aspect, kind }: {
  screens: Screen[]; clicks: Click[]; width: number; viewH: number; aspect: number; kind: "tap" | "mouse";
}) => {
  const f = useCurrentFrame();
  const imgH = width * aspect, off = imgH - viewH;
  // Hold at each click, ease toward the next one over MOVE frames; enter from just below the first target.
  const first = clicks[0];
  const keys = [first.f - MOVE - 6, ...clicks.flatMap((c, i) => (i === 0 ? [c.f] : [Math.max(c.f - MOVE, clicks[i - 1].f + 1), c.f]))];
  const pts = [{ x: first.x + 0.12, y: first.y + 0.12 }, ...clicks.flatMap((c, i) => (i === 0 ? [c] : [clicks[i - 1], c]))];
  const ease = { ...clamp, easing: Easing.inOut(Easing.cubic) };
  const cx = interpolate(f, keys, pts.map((p) => p.x * width), ease);
  const cy = interpolate(f, keys, pts.map((p) => p.y * imgH - off), ease);
  const appear = interpolate(f, [keys[0], keys[0] + 6], [0, 1], clamp);
  const press = Math.min(...clicks.map((c) => Math.abs(f - c.f)));
  const scale = press < 4 ? 0.82 + press * 0.045 : 1;
  // Desktop UI is tiny in a phone-sized video, so the camera zooms in and follows the mouse.
  const zoom = kind === "mouse" ? interpolate(f, [keys[0], keys[0] + 20], [1, 1.7], ease) : 1;

  return (
    <div style={{ position: "relative", width, height: viewH, overflow: "hidden" }}>
     <div style={{ position: "absolute", inset: 0, transform: `scale(${zoom})`, transformOrigin: `${cx}px ${cy}px` }}>
      {screens.map((s, i) => (
        <Img key={s.src} src={staticFile(s.src)} style={{
          position: "absolute", width, left: 0, top: -off,
          opacity: i === 0 ? 1 : interpolate(f, [s.at, s.at + 6], [0, 1], clamp),
        }} />
      ))}
      {clicks.map((c) => {
        const t = f - c.f;
        if (t < 0 || t > 16) return null;
        const r = interpolate(t, [0, 16], [10, kind === "tap" ? 70 : 46]);
        return <div key={c.f} style={{
          position: "absolute", left: c.x * width - r, top: c.y * imgH - off - r, width: r * 2, height: r * 2, borderRadius: "50%",
          border: `3px solid ${LIME}`, opacity: interpolate(t, [0, 16], [0.9, 0]),
        }} />;
      })}
      <div style={{ position: "absolute", left: cx, top: cy, opacity: appear, transform: `scale(${scale})`, transformOrigin: "0 0" }}>
        {kind === "tap" ? (
          <div style={{ width: 64, height: 64, margin: "-32px 0 0 -32px", borderRadius: "50%", background: "rgba(255,255,255,.35)", border: "3px solid rgba(255,255,255,.9)", boxShadow: "0 6px 20px rgba(0,0,0,.4)" }} />
        ) : (
          <svg width="40" height="40" viewBox="0 0 24 24" style={{ filter: "drop-shadow(0 4px 8px rgba(0,0,0,.5))" }} aria-hidden>
            <path d="M4 2l15 11.5-6.6.9 3.9 7.4-3 1.5-3.8-7.5L4 20z" fill="#fff" stroke={INK} strokeWidth="1.4" strokeLinejoin="round" />
          </svg>
        )}
      </div>
     </div>
    </div>
  );
};

const Phone = ({ width, viewH, ...demo }: { width: number; viewH: number; screens: Screen[]; clicks: Click[] }) => (
  <div style={{ padding: 16, background: "#1a2333", borderRadius: 64, boxShadow: "0 50px 90px rgba(0,0,0,.6), 0 0 0 2px #2b3649 inset" }}>
    <div style={{ borderRadius: 50, overflow: "hidden" }}>
      <Demo {...demo} width={width} viewH={viewH} aspect={2532 / 1170} kind="tap" />
    </div>
  </div>
);

const Browser = ({ width, ...demo }: { width: number; screens: Screen[]; clicks: Click[] }) => (
  <div style={{ width, background: "#0f1828", border: "1px solid #26344d", borderRadius: 18, overflow: "hidden", boxShadow: "0 50px 100px rgba(0,0,0,.6)" }}>
    <div style={{ height: 36, display: "flex", alignItems: "center", gap: 8, padding: "0 16px", background: "#131e30", borderBottom: "1px solid #22304a" }}>
      {[0, 1, 2].map((i) => <i key={i} style={{ width: 12, height: 12, borderRadius: 6, background: "#2c3a52" }} />)}
    </div>
    <Demo {...demo} width={width - 2} viewH={((width - 2) * 1800) / 2880} aspect={1800 / 2880} kind="mouse" />
  </div>
);

const Check = ({ children, delay }: { children: ReactNode; delay: number }) => (
  <Rise delay={delay} style={{ display: "flex", alignItems: "center", gap: 16, font: `700 32px/1.2 ${body}` }}>
    <svg width="38" height="38" viewBox="0 0 24 24" aria-hidden><circle cx="12" cy="12" r="12" fill={LIME} /><path d="M7 12.5l3.2 3.2L17 9" fill="none" stroke={INK} strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
    {children}
  </Rise>
);

const Logo = ({ size = 58 }: { size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
    <rect width="32" height="32" rx="7" fill="#0c1626" />
    <g fill="none" stroke={LIME} strokeWidth="2.5" strokeLinecap="round"><circle cx="16" cy="16" r="9" /><path d="M16 3.5v5M16 23.5v5M3.5 16h5M23.5 16h5" /></g>
    <circle cx="16" cy="16" r="2.5" fill={LIME} />
  </svg>
);

export const SaasAd = () => {
  const { height } = useVideoConfig();
  const tall = height > 1600; // 9:16 vs 4:5 — the feed cut gets smaller devices
  const top = tall ? 260 : 150;
  const frame = useCurrentFrame(); // absolute: these scenes read it outside their Sequence

  return (
    <>
      <AbsoluteFill style={{ background: INK }}>
        <AbsoluteFill style={{ background: `radial-gradient(900px 600px at 92% -6%, rgba(191,245,56,.17), transparent 60%), radial-gradient(700px 500px at -10% 105%, rgba(56,120,245,.14), transparent 60%)` }} />
      
        {/* Persistent brand bar, hidden on the CTA which carries its own logo */}
        <Sequence durationInFrames={S.cta[0]}>
          <div style={{ position: "absolute", left: 72, right: 72, top: tall ? 110 : 56, zIndex: 1, display: "flex", alignItems: "center", gap: 16 }}>
            <Logo />
            <span style={{ font: `800 40px/1 ${display}`, textTransform: "uppercase", color: "#fff" }}>Crosshair <span style={{ color: LIME }}>Dinkers</span></span>
            <span style={{ marginLeft: "auto", font: `700 18px/1 ${body}`, letterSpacing: 3, textTransform: "uppercase", color: "#9fb0c8", border: "1.5px solid #24324a", borderRadius: 999, padding: "12px 20px" }}>Court Booking System</span>
          </div>
        </Sequence>
      
        <Sequence from={S.hook[0]} durationInFrames={S.hook[1]}>
          <Scene len={S.hook[1]}>
            <AbsoluteFill style={{ overflow: "hidden" }}>
              <Img src={staticFile("court-venue.jpg")} style={{ position: "absolute", height: "100%", left: "50%", transform: `translateX(-50%) scale(${interpolate(frame, [0, 90], [1.05, 1.15])})`, opacity: 0.45 }} />
              <AbsoluteFill style={{ background: `linear-gradient(${INK} 5%, rgba(6,13,26,.4) 45%, ${INK} 95%)` }} />
            </AbsoluteFill>
            <div style={{ marginTop: tall ? 620 : 380 }}>
              <Rise><Headline size={tall ? 132 : 116}>Run your<br />pickleball court<br />business</Headline></Rise>
              <Rise delay={14}><Headline size={tall ? 132 : 116}><Em>smarter.</Em></Headline></Rise>
              <Rise delay={26}><Sub>Bookings, payments and daily operations — in one platform.</Sub></Rise>
            </div>
          </Scene>
        </Sequence>
      
        <Sequence from={S.book[0]} durationInFrames={S.book[1]}>
          <Scene len={S.book[1]}>
            <div style={{ marginTop: top + 60 }}>
              <Rise><Label>Online court reservations</Label><Headline size={tall ? 96 : 80}>Players book <Em>24/7.</Em></Headline></Rise>
              <Rise delay={8}><Sub>No more chat threads or double-booked courts.</Sub></Rise>
            </div>
            <Rise delay={12} style={{ display: "flex", justifyContent: "center", marginTop: 56 }}>
              <Phone width={tall ? 470 : 330} viewH={tall ? 900 : 560}
                screens={[{ src: "home.png", at: 0 }, { src: "basket.png", at: 44 }]}
                clicks={[{ f: 38, x: 0.16, y: 0.725 }, { f: 68, x: 0.53, y: 0.5 }, { f: 98, x: 0.71, y: 0.935 }]} />
            </Rise>
          </Scene>
        </Sequence>
      
        <Sequence from={S.pay[0]} durationInFrames={S.pay[1]}>
          <Scene len={S.pay[1]}>
            <div style={{ marginTop: top + 60 }}>
              <Rise><Label>Flexible payments</Label><Headline size={tall ? 96 : 80}>Pay online <Em>or cash.</Em></Headline></Rise>
              <Rise delay={8}><Sub>Customers choose at checkout. Staff settle cash at the counter.</Sub></Rise>
            </div>
            <Rise delay={12} style={{ display: "flex", justifyContent: "center", alignItems: "flex-start", gap: 36, marginTop: 56 }}>
              <Phone width={tall ? 470 : 330} viewH={tall ? 900 : 560}
                screens={[{ src: "checkout.png", at: 0 }]}
                clicks={[{ f: 40, x: 0.71, y: 0.625 }, { f: 78, x: 0.5, y: 0.8 }]} />
            </Rise>
          </Scene>
        </Sequence>
      
        <Sequence from={S.admin[0]} durationInFrames={S.admin[1]}>
          <Scene len={S.admin[1]}>
            <div style={{ marginTop: top + 60 }}>
              <Rise><Label>Admin operations</Label><Headline size={tall ? 96 : 80}>Run the day from <Em>one dashboard.</Em></Headline></Rise>
            </div>
            <Rise delay={8} style={{ marginTop: 56, marginLeft: -24, marginRight: -24 }}>
              <Browser width={984}
                screens={[{ src: "admin-dashboard.png", at: 0 }, { src: "admin-bookings-today.png", at: 34 }, { src: "admin-walkin.png", at: 64 }, { src: "admin-settle.png", at: 110 }]}
                clicks={[{ f: 28, x: 0.05, y: 0.195 }, { f: 58, x: 0.92, y: 0.126 }, { f: 84, x: 0.394, y: 0.815 }, { f: 104, x: 0.6, y: 0.9 }, { f: 132, x: 0.57, y: 0.672 }]} />
            </Rise>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22, marginTop: tall ? 64 : 40 }}>
              <Check delay={20}>Today&apos;s schedule</Check>
              <Check delay={50}>Walk-in bookings</Check>
              <Check delay={80}>Payment settlement</Check>
              <Check delay={110}>Customer records</Check>
            </div>
          </Scene>
        </Sequence>
      
        <Sequence from={S.cta[0]} durationInFrames={S.cta[1]}>
          <AbsoluteFill style={{ background: LIME, color: INK, padding: "0 72px", justifyContent: "center", fontFamily: body, opacity: interpolate(frame - S.cta[0], [0, 10], [0, 1], clamp) }}>
            <Rise><Logo size={tall ? 120 : 96} /></Rise>
            <Rise delay={6} style={{ marginTop: 40 }}><Headline size={tall ? 120 : 100}>Get your own<br />booking system.</Headline></Rise>
            <Rise delay={16}><p style={{ margin: "32px 0 0", font: `800 40px/1.2 ${body}` }}>Send us a message to learn more!</p></Rise>
            <Rise delay={26}><p style={{ margin: "48px 0 0", font: `700 22px/1 ${body}`, letterSpacing: 2.5, opacity: 0.7 }}>DINK WITH PRECISION. BOOK YOUR COURT. PLAY YOUR GAME.</p></Rise>
          </AbsoluteFill>
        </Sequence>
      </AbsoluteFill>
    </>
  );
};
