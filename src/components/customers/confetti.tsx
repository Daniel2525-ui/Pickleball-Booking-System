"use client";

import { useState } from "react";

const COLORS = ["var(--primary)", "color-mix(in oklch, var(--primary) 45%, #ffffff)", "#F59E0B", "#111816"];

/**
 * A short burst of brand-coloured confetti, once per `onceKey` in this tab (not again on refresh).
 * Pure CSS; the global reduced-motion rule ends it at once. Decorative.
 */
export function Confetti({ onceKey }: { onceKey: string }) {
  const [show] = useState(() => {
    try {
      const key = `confetti:${onceKey}`;
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, "1");
    } catch {
      // Storage blocked: celebrate anyway
    }
    return true;
  });
  if (!show) return null;
  return (
    <div aria-hidden className="pointer-events-none absolute inset-x-0 top-0 h-80 overflow-hidden">
      {Array.from({ length: 28 }, (_, i) => (
        <span
          key={i}
          className="confetti-bit"
          style={{
            left: `${((i * 37) % 94) + 3}%`,
            background: COLORS[i % COLORS.length],
            animationDelay: `${((i * 0.06) % 0.6).toFixed(2)}s`,
            rotate: `${i * 29}deg`,
          }}
        />
      ))}
    </div>
  );
}
