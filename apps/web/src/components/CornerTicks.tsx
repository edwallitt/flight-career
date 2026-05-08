type Inset = 3 | 4;

const TICK_BASE = "pointer-events-none absolute block h-2 w-2 border-amber-deep/70";

const POSITIONS_3 = {
  tl: "left-3 top-3 border-l border-t",
  tr: "right-3 top-3 border-r border-t",
  bl: "left-3 bottom-3 border-l border-b",
  br: "right-3 bottom-3 border-r border-b",
} as const;

const POSITIONS_4 = {
  tl: "left-4 top-4 border-l border-t",
  tr: "right-4 top-4 border-r border-t",
  bl: "left-4 bottom-4 border-l border-b",
  br: "right-4 bottom-4 border-r border-b",
} as const;

export function CornerTicks({ inset = 3 }: { inset?: Inset } = {}) {
  const p = inset === 4 ? POSITIONS_4 : POSITIONS_3;
  return (
    <>
      <span className={`${TICK_BASE} ${p.tl}`} />
      <span className={`${TICK_BASE} ${p.tr}`} />
      <span className={`${TICK_BASE} ${p.bl}`} />
      <span className={`${TICK_BASE} ${p.br}`} />
    </>
  );
}
