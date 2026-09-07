/**
 * One colour per entity type, shared by every content-graph surface: the
 * Sigma canvas, its legend/filter chips, the schema designer's type list, and
 * the draft-review entity editor. Kept in its own module (rather than living
 * inside a canvas component) so none of those have to import a renderer just
 * to get a colour.
 */

export const NODE_STYLES: Record<string, { color: string; bg: string }> = {
  // Content types
  Person: { color: '#F472B6', bg: 'rgba(244,114,182,0.13)' },
  Organization: { color: '#818CF8', bg: 'rgba(129,140,248,0.13)' },
  Supplier: { color: '#818CF8', bg: 'rgba(129,140,248,0.13)' },
  Purchaser: { color: '#22D3EE', bg: 'rgba(34,211,238,0.13)' },
  Carrier: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
  Subcontractor: { color: '#C084FC', bg: 'rgba(192,132,252,0.13)' },
  Product: { color: '#38BDF8', bg: 'rgba(56,189,248,0.12)' },
  Process: { color: '#2DD4BF', bg: 'rgba(45,212,191,0.12)' },
  Metric: { color: '#34D399', bg: 'rgba(52,211,153,0.12)' },
  Regulation: { color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  Standard: { color: '#FBBF24', bg: 'rgba(251,191,36,0.12)' },
  Obligation: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  System: { color: '#A78BFA', bg: 'rgba(167,139,250,0.12)' },
  Location: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
  Facility: { color: '#FB923C', bg: 'rgba(251,146,60,0.12)' },
  Event: { color: '#F87171', bg: 'rgba(248,113,113,0.12)' },
  Individual: { color: '#F472B6', bg: 'rgba(244,114,182,0.13)' },
  Concept: { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
  // Platform levels
  Library: { color: '#A3E635', bg: 'rgba(163,230,53,0.12)' },
  Document: { color: '#60A5FA', bg: 'rgba(96,165,250,0.12)' },
  domain: { color: '#8B5CF6', bg: 'rgba(139,92,246,0.14)' },
  capability: { color: '#06B6D4', bg: 'rgba(6,182,212,0.12)' },
  data_class: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)' },
  agent_tier: { color: '#94A3B8', bg: 'rgba(148,163,184,0.12)' },
};

const FALLBACK = NODE_STYLES.Concept;

export function nodeStyle(type: string) {
  return NODE_STYLES[type] ?? FALLBACK;
}
