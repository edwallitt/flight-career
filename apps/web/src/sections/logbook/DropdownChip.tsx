import { useEffect, useRef, useState } from "react";

interface DropdownOption {
  value: string;
  label: string;
}

export function DropdownChip({
  label,
  value,
  options,
  onChange,
  width = 220,
}: {
  label: string;
  value: string;
  options: DropdownOption[];
  onChange: (v: string) => void;
  width?: number;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const onDocClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="flex flex-col gap-1.5" ref={rootRef}>
      <span className="label">{label}</span>
      <div className="relative" style={{ width }}>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className={[
            "flex w-full items-center justify-between gap-2 rounded-sm border bg-ink-750 px-3 py-1.5 font-mono text-[12px] text-text-high outline-none transition-colors",
            open
              ? "border-amber-deep bg-amber-glow/[0.04]"
              : "border-ink-600 hover:border-ink-500",
          ].join(" ")}
        >
          <span className="truncate text-left">
            {selected?.label ?? "—"}
          </span>
          <Chevron open={open} />
        </button>
        {open && (
          <div
            className="absolute left-0 top-full z-30 mt-1 max-h-[280px] overflow-y-auto rounded-sm border border-ink-600 bg-ink-800 shadow-[0_8px_24px_rgba(0,0,0,0.4)]"
            style={{ width }}
          >
            {options.map((opt) => {
              const active = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onChange(opt.value);
                    setOpen(false);
                  }}
                  className={[
                    "flex w-full items-center gap-2 px-3 py-2 text-left font-mono text-[12px] transition-colors",
                    active
                      ? "bg-amber-glow/[0.10] text-amber-glow"
                      : "text-text hover:bg-ink-750/70 hover:text-text-high",
                  ].join(" ")}
                >
                  <span
                    aria-hidden
                    className={[
                      "inline-block h-1 w-1 rounded-full",
                      active ? "bg-amber-glow" : "bg-transparent",
                    ].join(" ")}
                  />
                  <span className="truncate">{opt.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function Chevron({ open }: { open: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      className={[
        "shrink-0 text-muted transition-transform",
        open ? "rotate-180 text-amber-glow" : "",
      ].join(" ")}
      aria-hidden
    >
      <path
        d="M2 4 L5 7 L8 4"
        stroke="currentColor"
        strokeWidth="1.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
