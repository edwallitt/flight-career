export function RouteCell({
  origin,
  destination,
}: {
  origin: string;
  destination: string;
}) {
  return (
    <div className="flex items-center gap-2">
      <span className="icao text-text-high">{origin}</span>
      <svg
        width="34"
        height="10"
        viewBox="0 0 34 10"
        preserveAspectRatio="none"
        className="text-amber-deep/80"
        aria-hidden
      >
        <line
          x1="2"
          y1="5"
          x2="32"
          y2="5"
          stroke="currentColor"
          strokeDasharray="2 3"
          strokeWidth="1"
        />
        <circle cx="2" cy="5" r="1.6" fill="currentColor" />
        <circle cx="32" cy="5" r="1.6" fill="currentColor" />
      </svg>
      <span className="icao text-text-high">{destination}</span>
    </div>
  );
}
