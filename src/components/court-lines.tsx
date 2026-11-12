/** Faint pickleball court lines (baseline, kitchen lines, centre line) in the brand colour, fading out at the edges. Decorative. */
export function CourtLines({ className = "" }: { className?: string }) {
  return (
    <svg
      aria-hidden
      className={`pointer-events-none absolute inset-0 h-full w-full text-primary [mask-image:radial-gradient(ellipse_70%_80%_at_70%_40%,#000_15%,transparent_72%)] ${className}`}
    >
      <defs>
        <pattern id="court-lines" width="240" height="112" patternUnits="userSpaceOnUse">
          <g fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="1.5">
            <rect x="10" y="6" width="220" height="100" />
            <path d="M120 6v100M85 6v100M155 6v100M10 56h75M155 56h75" />
          </g>
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#court-lines)" />
    </svg>
  );
}
