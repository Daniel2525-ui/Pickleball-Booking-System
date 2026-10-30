/** Top-down pickleball court with a looping crosscourt rally (keyframes in globals.css). */
export function CourtRally({ className = "" }: { className?: string }) {
  return (
    <svg viewBox="0 0 440 242" className={className} aria-hidden="true">
      <rect x="6" y="6" width="428" height="230" rx="6" className="fill-card stroke-foreground" strokeWidth="3" />
      <rect x="146" y="6" width="148" height="230" className="fill-secondary" />
      <line x1="146" y1="6" x2="146" y2="236" className="stroke-foreground" strokeWidth="3" />
      <line x1="294" y1="6" x2="294" y2="236" className="stroke-foreground" strokeWidth="3" />
      <line x1="6" y1="121" x2="146" y2="121" className="stroke-foreground" strokeWidth="3" />
      <line x1="294" y1="121" x2="434" y2="121" className="stroke-foreground" strokeWidth="3" />
      <line x1="220" y1="0" x2="220" y2="242" className="stroke-primary" strokeWidth="4" />
      <text x="160" y="228" className="fill-muted-foreground" fontSize="11" fontWeight="700">
        KITCHEN · 7 FT
      </text>
      <g className="cd-ball">
        <ellipse cx="100" cy="161" rx="8" ry="3" fill="rgba(0,0,0,0.35)" />
        <circle className="cd-hop fill-primary" cx="100" cy="150" r="9" />
      </g>
    </svg>
  );
}
