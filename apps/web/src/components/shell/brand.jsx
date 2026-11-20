// DCL brand block for the sidebar header and the login page (mockup pages 1–7).

export function DclMark({ className = 'h-9 w-auto' }) {
  return (
    <svg viewBox="0 0 96 44" className={className} role="img" aria-label="DCL">
      <path
        d="M8 10 C 30 -2, 62 -2, 88 8"
        fill="none"
        stroke="var(--brand-orange)"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <text
        x="2"
        y="40"
        fontFamily="var(--font-inter), Arial, sans-serif"
        fontWeight="800"
        fontSize="30"
        letterSpacing="1"
        fill="#fff"
      >
        DCL
      </text>
    </svg>
  );
}

/** Stylised plant skyline (silos, preheater tower, conveyor) drawn in the sidebar header. */
export function PlantSkyline({ className = '' }) {
  return (
    <svg
      viewBox="0 0 240 70"
      preserveAspectRatio="xMidYMax slice"
      className={className}
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="sky-fade" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="#5f8fbf" stopOpacity="0.55" />
          <stop offset="1" stopColor="#0c2744" stopOpacity="0.05" />
        </linearGradient>
      </defs>
      <g fill="url(#sky-fade)">
        <rect x="18" y="38" width="10" height="32" />
        <rect x="30" y="34" width="10" height="36" />
        <rect x="120" y="22" width="16" height="48" rx="3" />
        <rect x="139" y="18" width="16" height="52" rx="3" />
        <rect x="158" y="22" width="16" height="48" rx="3" />
        <rect x="186" y="8" width="12" height="62" />
        <rect x="182" y="24" width="20" height="5" />
        <rect x="182" y="40" width="20" height="5" />
        <rect x="208" y="30" width="22" height="40" />
        <rect x="58" y="46" width="44" height="24" />
        <path d="M40 40 L120 28 L121 31 L41 43 Z" />
      </g>
    </svg>
  );
}

export function BrandBlock() {
  return (
    <div className="relative overflow-hidden border-b border-sidebar-border px-5 pb-6 pt-5">
      <PlantSkyline className="pointer-events-none absolute inset-x-0 bottom-0 h-16 w-full" />
      <div className="relative flex items-center gap-3">
        <DclMark />
        <div className="border-l border-white/30 pl-3 leading-tight">
          <div className="text-[15px] font-semibold text-white">Dewan Cement</div>
          <div className="text-[15px] font-semibold text-white">Limited</div>
          <div className="mt-0.5 text-xs text-sidebar-foreground/80">Sales Module</div>
        </div>
      </div>
    </div>
  );
}
