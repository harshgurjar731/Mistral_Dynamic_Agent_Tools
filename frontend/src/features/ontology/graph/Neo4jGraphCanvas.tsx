import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  SigmaContainer,
  useCamera,
  useLoadGraph,
  useRegisterEvents,
  useSetSettings,
  useSigma,
} from '@react-sigma/core';
import '@react-sigma/core/lib/style.css';
import { MultiDirectedGraph } from 'graphology';
import { EdgeArrowProgram } from 'sigma/rendering';
import { Loader2, Maximize2, Minimize2, MousePointerClick, X } from 'lucide-react';
import type { UnifiedEdge, UnifiedGraph, UnifiedNode } from '../../../api/rag';
import { cn } from '../../../lib/utils';
import { colorForLabel } from './labelPalette';
import { computeForceLayout } from './forceLayout';

/**
 * A Neo4j-Browser-style rendering of a graph: force-scattered rather than
 * geometrically arranged, one colour per label (auto-assigned, not looked up
 * from a fixed vocabulary), relationship types always on, and a double-click
 * on a node expands its neighbourhood — the interaction Neo4j Browser is
 * built around. Built for the Query tab, where the graph shape is whatever
 * the query happens to return and can carry any label at all, unlike the
 * closed entity vocabulary `SigmaGraphCanvas` was built for.
 */

const STATIC_SETTINGS = {
  defaultEdgeType: 'arrow',
  edgeProgramClasses: { arrow: EdgeArrowProgram },
  renderEdgeLabels: true,
  labelRenderedSizeThreshold: 0,
  labelDensity: 1,
  labelColor: { color: '#e2e8f0' },
  labelSize: 12,
  edgeLabelColor: { color: '#cbd5e1' },
  edgeLabelSize: 10,
  minCameraRatio: 0.02,
  maxCameraRatio: 4,
  zIndex: true,
};

// Fields the backend adds for bookkeeping — not real graph properties, so
// they stay out of the property panel and the legend groups on `type` instead.
const INTERNAL_NODE_FIELDS = new Set(['id', 'kind', 'type', 'label', 'degree', 'labels', 'element_id']);
const INTERNAL_EDGE_FIELDS = new Set(['source', 'target', 'predicate']);

function nodeSize(degree: number): number {
  return Math.min(22, 11 + Math.sqrt(degree || 0) * 3);
}

function withAlpha(hex: string, alpha: number): string {
  const clean = hex.replace('#', '');
  const value = parseInt(clean, 16);
  const r = (value >> 16) & 255;
  const g = (value >> 8) & 255;
  const b = value & 255;
  return `rgba(${r},${g},${b},${alpha})`;
}

interface GraphContentProps {
  graph: UnifiedGraph;
  hiddenTypes: Set<string>;
  onSelectNode: (node: UnifiedNode | null) => void;
  onSelectEdge: (edge: UnifiedEdge | null) => void;
  onExpandNode: (node: UnifiedNode) => void;
  expandingId: string | null;
}

function GraphContent({
  graph, hiddenTypes, onSelectNode, onSelectEdge, onExpandNode, expandingId,
}: GraphContentProps) {
  const loadGraph = useLoadGraph();
  const registerEvents = useRegisterEvents();
  const setSettings = useSetSettings();
  const sigma = useSigma();
  const { reset } = useCamera();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const seedRef = useRef<Map<string, { x: number; y: number }>>(new Map());
  const loadedIdsRef = useRef<string>('');
  const onSelectNodeRef = useRef(onSelectNode);
  const onSelectEdgeRef = useRef(onSelectEdge);
  useEffect(() => { onSelectNodeRef.current = onSelectNode; onSelectEdgeRef.current = onSelectEdge; });

  // A graph that only grew (an expand) reuses existing node positions as the
  // seed, so the part of the picture the user was already looking at doesn't
  // jump — only the newly-revealed nodes settle into place.
  useEffect(() => {
    const ids = graph.nodes.map((n) => n.id);
    const idKey = ids.slice().sort().join('|');
    if (idKey === loadedIdsRef.current) return;
    loadedIdsRef.current = idKey;

    const positions = computeForceLayout(ids, graph.edges, { seed: seedRef.current });
    seedRef.current = positions;

    const g = new MultiDirectedGraph();
    for (const node of graph.nodes) {
      const pos = positions.get(node.id) ?? { x: 0, y: 0 };
      const style = colorForLabel(node.type);
      g.addNode(node.id, {
        x: pos.x,
        y: pos.y,
        size: nodeSize(node.degree),
        color: style.color,
        label: node.label,
        raw: node,
      });
    }
    graph.edges.forEach((edge: UnifiedEdge, index: number) => {
      if (!g.hasNode(edge.source) || !g.hasNode(edge.target)) return;
      const key = `e${index}:${edge.source}->${edge.target}`;
      if (g.hasEdge(key)) return;
      g.addEdgeWithKey(key, edge.source, edge.target, {
        predicate: edge.predicate,
        label: String(edge.predicate || '').replace(/_/g, ' '),
        size: 1.6,
        color: withAlpha('#94A3B8', 0.55),
        raw: edge,
      });
    });

    loadGraph(g);
    setTimeout(() => reset(), 30);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, loadGraph, sigma]);

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => {
        setSelectedId((current) => {
          const next = current === node ? null : node;
          const raw = next ? (sigma.getGraph().getNodeAttribute(next, 'raw') as UnifiedNode) : null;
          onSelectNodeRef.current(raw);
          onSelectEdgeRef.current(null);
          return next;
        });
      },
      doubleClickNode: ({ node, event }) => {
        event.preventSigmaDefault();
        const raw = sigma.getGraph().getNodeAttribute(node, 'raw') as UnifiedNode;
        onExpandNode(raw);
      },
      clickEdge: ({ edge }) => {
        const raw = sigma.getGraph().getEdgeAttribute(edge, 'raw') as UnifiedEdge;
        onSelectEdgeRef.current(raw);
        onSelectNodeRef.current(null);
      },
      clickStage: () => {
        setSelectedId(null);
        onSelectNodeRef.current(null);
        onSelectEdgeRef.current(null);
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registerEvents, sigma, onExpandNode]);

  const hiddenNodeIds = useMemo(() => {
    if (!hiddenTypes.size) return new Set<string>();
    const hidden = new Set<string>();
    for (const node of graph.nodes) if (hiddenTypes.has(node.type)) hidden.add(node.id);
    return hidden;
  }, [graph, hiddenTypes]);

  useEffect(() => {
    const g = sigma.getGraph();
    let focus: Set<string> | null = null;
    if (selectedId) {
      focus = new Set<string>(g.neighbors(selectedId));
      focus.add(selectedId);
    }

    setSettings({
      nodeReducer: (node, data) => {
        if (hiddenNodeIds.has(node)) return { ...data, hidden: true };
        const expanding = node === expandingId;
        if (node === selectedId) {
          return {
            ...data,
            forceLabel: true,
            zIndex: 2,
            size: (data.size as number) * 1.15,
            borderColor: '#fff',
          };
        }
        if (expanding) return { ...data, forceLabel: true, zIndex: 2 };
        if (!focus) return { ...data, forceLabel: true };
        if (focus.has(node)) return { ...data, forceLabel: true, zIndex: 1 };
        return { ...data, color: withAlpha(data.color as string, 0.15), label: null, zIndex: 0 };
      },
      edgeReducer: (edge, data) => {
        if (hiddenNodeIds.has(g.source(edge)) || hiddenNodeIds.has(g.target(edge))) {
          return { ...data, hidden: true };
        }
        if (!focus) return data;
        const touches = g.source(edge) === selectedId || g.target(edge) === selectedId;
        if (!touches) return { ...data, color: withAlpha('#334155', 0.08), label: null };
        return { ...data, size: 2.2, zIndex: 1 };
      },
    });
  }, [selectedId, hiddenNodeIds, expandingId, sigma, setSettings]);

  return (
    <>
      {selectedId && (
        <div className="absolute bottom-3 right-3 z-10">
          <button
            onClick={() => { setSelectedId(null); onSelectNodeRef.current(null); }}
            className="flex items-center gap-1 rounded-lg border border-[var(--color-border-subtle)] bg-black/70 px-2 py-1 text-[10px] text-[var(--color-text-secondary)] hover:text-white"
          >
            <X size={10} /> clear selection
          </button>
        </div>
      )}
    </>
  );
}

export default function Neo4jGraphCanvas({
  graph,
  height = 560,
  title,
  onExpand,
}: {
  graph: UnifiedGraph;
  height?: number;
  title?: string;
  /** Double-click a node to pull in its neighbourhood. Omit to disable expand. */
  onExpand?: (node: UnifiedNode) => Promise<{ nodes: UnifiedNode[]; edges: UnifiedEdge[] } | void>;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  const [hiddenTypes, setHiddenTypes] = useState<Set<string>>(new Set());
  const [selectedNode, setSelectedNode] = useState<UnifiedNode | null>(null);
  const [selectedEdge, setSelectedEdge] = useState<UnifiedEdge | null>(null);
  const [expandingId, setExpandingId] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  const toggleFullscreen = useCallback(async () => {
    const element = container.current;
    if (!element) return;
    try {
      if (document.fullscreenElement) await document.exitFullscreen();
      else await element.requestFullscreen();
    } catch {
      setFullscreen((v) => !v);
    }
  }, []);

  useEffect(() => {
    const onChange = () => setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const typeCounts = useMemo(() => {
    const counts: Record<string, number> = {};
    for (const node of graph.nodes) counts[node.type] = (counts[node.type] ?? 0) + 1;
    return counts;
  }, [graph]);
  const types = useMemo(
    () => Object.keys(typeCounts).sort((a, b) => typeCounts[b] - typeCounts[a]),
    [typeCounts],
  );

  const toggleType = useCallback((type: string) => {
    setHiddenTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleExpand = useCallback(
    async (node: UnifiedNode) => {
      if (!onExpand || expandingId) return;
      setExpandingId(node.id);
      try {
        await onExpand(node);
      } finally {
        setExpandingId(null);
      }
    },
    [onExpand, expandingId],
  );

  if (!graph.nodes.length) {
    return (
      <div
        style={{ height }}
        className="flex items-center justify-center rounded-lg border border-dashed border-[var(--color-border-subtle)]"
      >
        <p className="max-w-sm text-center text-xs text-[var(--color-text-muted)]">
          Nothing to draw — the query returned no nodes.
        </p>
      </div>
    );
  }

  const selected = selectedNode ?? selectedEdge;
  const properties = selectedNode
    ? Object.entries(selectedNode).filter(([k]) => !INTERNAL_NODE_FIELDS.has(k))
    : selectedEdge
      ? Object.entries(selectedEdge).filter(([k]) => !INTERNAL_EDGE_FIELDS.has(k))
      : [];

  return (
    <div
      ref={container}
      style={{ height: fullscreen ? '100vh' : height }}
      className="relative overflow-hidden rounded-lg border border-[var(--color-border-subtle)] bg-[#080d18]"
    >
      <div className="absolute left-3 top-3 z-10 flex max-w-[calc(100%-90px)] flex-wrap items-center gap-2">
        {title && (
          <span className="rounded-lg bg-black/70 px-2 py-1 text-[11px] text-white">{title}</span>
        )}
        {onExpand && (
          <span className="flex items-center gap-1 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-[var(--color-text-muted)]">
            <MousePointerClick size={10} /> double-click a node to expand it
          </span>
        )}
      </div>

      <button
        onClick={toggleFullscreen}
        title={fullscreen ? 'Exit full screen' : 'Full screen'}
        className="absolute right-3 top-3 z-10 rounded-lg border border-[var(--color-border-subtle)] bg-black/70 p-1.5 text-[var(--color-text-secondary)] hover:text-white"
      >
        {fullscreen ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
      </button>

      {/* Legend — one swatch per label, click to hide/show, mirroring Neo4j
          Browser's own top-of-canvas legend. */}
      <div className="absolute bottom-3 left-3 z-10 max-w-[min(560px,80%)] rounded-lg bg-black/70 px-2.5 py-1.5">
        <div className="flex flex-wrap items-center gap-1.5">
          {types.map((type) => {
            const style = colorForLabel(type);
            const on = !hiddenTypes.has(type);
            return (
              <button
                key={type}
                onClick={() => toggleType(type)}
                title={`Click to ${on ? 'hide' : 'show'} ${type}`}
                style={{
                  borderColor: on ? `${style.color}66` : 'var(--color-border-subtle)',
                  background: on ? style.bg : 'transparent',
                }}
                className={cn(
                  'flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-opacity hover:opacity-90',
                  !on && 'opacity-45',
                )}
              >
                <span className="h-2 w-2 rounded-full" style={{ background: style.color }} />
                <span className="text-[var(--color-text-secondary)]">{type}</span>
                <span className="font-mono tabular-nums text-[var(--color-text-muted)]">
                  {typeCounts[type]}
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {expandingId && (
        <div className="absolute right-3 top-14 z-10 flex items-center gap-1.5 rounded-lg bg-black/70 px-2 py-1 text-[10px] text-indigo-300">
          <Loader2 size={11} className="animate-spin" /> expanding…
        </div>
      )}

      <SigmaContainer
        graph={MultiDirectedGraph}
        settings={STATIC_SETTINGS}
        style={{ width: '100%', height: '100%', background: '#080d18' }}
      >
        <GraphContent
          graph={graph}
          hiddenTypes={hiddenTypes}
          onSelectNode={setSelectedNode}
          onSelectEdge={setSelectedEdge}
          onExpandNode={handleExpand}
          expandingId={expandingId}
        />
      </SigmaContainer>

      {/* Property panel — Neo4j Browser's bottom drawer. Shown for whichever
          of a node or an edge was last clicked. */}
      {selected && (
        <div className="absolute inset-x-3 bottom-3 z-10 max-h-[38%] overflow-y-auto rounded-lg border border-[var(--color-border-subtle)] bg-black/85 p-3 backdrop-blur-sm custom-scrollbar">
          <div className="mb-1.5 flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              {selectedNode && (
                <span
                  className="rounded-full border px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider"
                  style={{
                    color: colorForLabel(selectedNode.type).color,
                    borderColor: `${colorForLabel(selectedNode.type).color}66`,
                    background: colorForLabel(selectedNode.type).bg,
                  }}
                >
                  {selectedNode.type}
                </span>
              )}
              {selectedEdge && (
                <span className="rounded-full border border-indigo-400/40 bg-indigo-500/15 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wider text-indigo-200">
                  {String(selectedEdge.predicate).replace(/_/g, ' ')}
                </span>
              )}
              <span className="truncate text-xs font-medium text-white">
                {selectedNode ? selectedNode.label : `${selectedEdge?.source} → ${selectedEdge?.target}`}
              </span>
            </div>
            <button
              onClick={() => { setSelectedNode(null); setSelectedEdge(null); }}
              className="shrink-0 text-[var(--color-text-muted)] hover:text-white"
            >
              <X size={13} />
            </button>
          </div>
          {properties.length === 0 ? (
            <p className="text-[10px] text-[var(--color-text-muted)]">No properties.</p>
          ) : (
            <table className="w-full text-[10px]">
              <tbody>
                {properties.map(([key, value]) => (
                  <tr key={key} className="align-top">
                    <td className="whitespace-nowrap py-0.5 pr-3 font-mono text-indigo-300">{key}</td>
                    <td className="py-0.5 font-mono text-[var(--color-text-secondary)]">
                      {typeof value === 'object' ? JSON.stringify(value) : String(value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}
