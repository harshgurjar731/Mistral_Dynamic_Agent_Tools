/**
 * One colour per Neo4j label, auto-assigned rather than looked up.
 *
 * `entityStyle.ts` colours a *closed* vocabulary — the ten-ish entity types
 * this app's own extraction pipeline produces. An ad hoc Cypher query has no
 * such vocabulary: it can return any label in the database, so anything not
 * in that fixed list fell back to one grey "Concept" swatch and the query
 * canvas read as monochrome. Neo4j Browser solves this the same way — hash
 * the label, pick from a fixed palette — which is the point: the Query tab
 * should look like the tool it is standing in for.
 */

const PALETTE: { color: string; bg: string }[] = [
  { color: '#60A5FA', bg: 'rgba(96,165,250,0.16)' },  // blue
  { color: '#34D399', bg: 'rgba(52,211,153,0.16)' },  // emerald
  { color: '#F472B6', bg: 'rgba(244,114,182,0.16)' }, // pink
  { color: '#FBBF24', bg: 'rgba(251,191,36,0.16)' },  // amber
  { color: '#A78BFA', bg: 'rgba(167,139,250,0.16)' }, // violet
  { color: '#FB923C', bg: 'rgba(251,146,60,0.16)' },  // orange
  { color: '#22D3EE', bg: 'rgba(34,211,238,0.16)' },  // cyan
  { color: '#F87171', bg: 'rgba(248,113,113,0.16)' }, // red
  { color: '#A3E635', bg: 'rgba(163,230,53,0.16)' },  // lime
  { color: '#C084FC', bg: 'rgba(192,132,252,0.16)' }, // purple
  { color: '#2DD4BF', bg: 'rgba(45,212,191,0.16)' },  // teal
  { color: '#FCD34D', bg: 'rgba(252,211,77,0.16)' },  // yellow
  { color: '#818CF8', bg: 'rgba(129,140,248,0.16)' }, // indigo
  { color: '#4ADE80', bg: 'rgba(74,222,128,0.16)' },  // green
];

/** Deterministic string hash (djb2) — same label always lands on the same swatch. */
function hash(label: string): number {
  let h = 5381;
  for (let i = 0; i < label.length; i += 1) {
    h = ((h << 5) + h + label.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function colorForLabel(label: string): { color: string; bg: string } {
  if (!label) return PALETTE[0];
  return PALETTE[hash(label) % PALETTE.length];
}
