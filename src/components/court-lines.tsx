/**
 * Top-down pickleball court (44 × 20 ft, 7 ft kitchens) drawn in the on-brand colour, with a ball looping a
 * dink rally: each shot bounces in the far kitchen before it's returned, alternating cross-court and straight.
 * Height is faked with scale plus a ground shadow. Decorative.
 * The motion lives in globals.css (.rally-*); the global reduced-motion rule leaves the ball parked.
 */
export function CourtRally({ className = "" }: { className?: string }) {
  return (
    <svg aria-hidden viewBox="-30 -60 500 290" className={`text-primary-foreground ${className}`}>
      <rect width="440" height="200" rx="4" fill="currentColor" fillOpacity="0.1" />
      <rect x="150" width="140" height="200" fill="currentColor" fillOpacity="0.1" />
      <g fill="none" stroke="currentColor" strokeWidth="4">
        <rect width="440" height="200" />
        <path d="M150 0v200M290 0v200M0 100h150M290 100h150" />
      </g>
      <path d="M220 -14v228" stroke="currentColor" strokeWidth="6" strokeDasharray="2 7" />
      {/* Ground position moves at a steady speed; only height eases (gravity), so the ball never stalls mid-air */}
      <g className="rally-ground">
        <ellipse className="rally-shadow" rx="11" ry="5" fill="#000" fillOpacity="0.3" />
        <circle className="rally-ball" r="11" fill="#E8F55A" stroke="#000" strokeOpacity="0.15" />
      </g>
    </svg>
  );
}
