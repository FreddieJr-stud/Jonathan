/**
 * Fixed palette for color-coding boards, ported 1:1 from DashboardPlusPlus's
 * TaskColors.kt so colors render identically across both clients.
 */
export const palette: number[] = [
  0xff89b4fa, // blue
  0xffa6e3a1, // green
  0xfff9e2af, // yellow
  0xfffab387, // peach
  0xfff38ba8, // red
  0xffcba6f7, // mauve
  0xff94e2d5, // teal
  0xfff5c2e7, // pink
  0xfff5e0dc, // rosewater
  0xfff2cdcd, // flamingo
  0xffeba0ac, // maroon
  0xffe0a3c7, // orchid
  0xffb4befe, // lavender
  0xff74c7ec, // sapphire
  0xff89dceb, // sky
  0xffeb6f92, // rose
  0xff9ccfd8, // foam
  0xffc4a7e7, // iris
  0xfff6c177, // gold
  0xff3eb489, // emerald
];

/** Picks a random palette color not already used; falls back to any palette color if all are taken. */
export function nextUnused(usedColors: Iterable<number | null | undefined>): number {
  const used = new Set<number>();
  for (const c of usedColors) if (c != null) used.add(c);
  const free = palette.filter((c) => !used.has(c));
  const pool = free.length > 0 ? free : palette;
  return pool[Math.floor(Math.random() * pool.length)];
}

/**
 * Returns {boardId -> color} for every board with a null colorArgb, treating
 * colors assigned earlier in this same pass as used too.
 */
export function pickBackfillColors(
  boards: { id: number; colorArgb: number | null }[],
): Map<number, number> {
  const used = new Set<number>();
  for (const b of boards) if (b.colorArgb != null) used.add(b.colorArgb);

  const result = new Map<number, number>();
  for (const b of boards) {
    if (b.colorArgb != null) continue;
    const color = nextUnused(used);
    used.add(color);
    result.set(b.id, color);
  }
  return result;
}
