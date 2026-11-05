"use client";

import { useRef, type PointerEvent, type ReactNode } from "react";

const clear = (el: HTMLElement | null) => {
  el?.style.removeProperty("--spot-x");
  el?.style.removeProperty("--spot-y");
};

/** Lights up whichever `.spotlight-card` inside it is under the pointer (a soft glow that follows the mouse). */
export function SpotlightGroup({ className, children }: { className?: string; children: ReactNode }) {
  const lit = useRef<HTMLElement | null>(null);
  const move = (e: PointerEvent<HTMLDivElement>) => {
    const card = (e.target as HTMLElement).closest<HTMLElement>(".spotlight-card");
    if (card !== lit.current) clear(lit.current);
    lit.current = card;
    if (!card) return;
    const r = card.getBoundingClientRect();
    card.style.setProperty("--spot-x", `${e.clientX - r.left}px`);
    card.style.setProperty("--spot-y", `${e.clientY - r.top}px`);
  };
  const leave = () => {
    clear(lit.current);
    lit.current = null;
  };
  return (
    <div className={className} onPointerMove={move} onPointerLeave={leave}>
      {children}
    </div>
  );
}
