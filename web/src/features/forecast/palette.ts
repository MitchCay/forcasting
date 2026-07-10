// Per-account line palettes, shared by the chart, the summary tiles, and the
// tooltip so a given account reads as the same color everywhere. Reserved
// variants are desaturated (they sit on the faint dashed reserved line);
// available variants use the brighter accent-family hues.

export const RESERVED_COLORS = [
  '#9aa4b2',
  '#8ab0a0',
  '#b0a88a',
  '#a08ab0',
  '#8a9ab0',
  '#b08a9a',
  '#8ab0b0',
  '#a8a090',
]

export const AVAILABLE_COLORS = [
  '#6ea8ff',
  '#5bc0c2',
  '#a78bfa',
  '#8cb9ff',
  '#f472b6',
  '#fbbf24',
  '#4ade80',
  '#94a3b8',
]

export function reservedColor(i: number): string {
  return RESERVED_COLORS[i % RESERVED_COLORS.length]!
}

export function availableColor(i: number): string {
  return AVAILABLE_COLORS[i % AVAILABLE_COLORS.length]!
}
