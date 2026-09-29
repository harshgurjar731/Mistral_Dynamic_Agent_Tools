import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from "react";
import dagre from "dagre";
import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
} from "d3-force";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  ReactFlowProvider,
  useReactFlow,
  useStore,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  ChevronDown,
  Map as MapIcon,
  Maximize2,
  Minimize2,
  Minus,
  Plus,
  RotateCcw,
  Scan,
} from "lucide-react";
import { useFullscreen } from "@/lib/useFullscreen";
import { cn } from "@/lib/utils";
import { TONE_VAR, type GraphTone } from "./graphTones";

const CARD_W = 212;
const CARD_H = 62;
const DOT_BOX_W = 136;
const LABEL_H = 22;

export type { GraphTone };

export interface SimpleNode {
  id: string;
  label: string;
  sublabel?: string;
  tone?: GraphTone;
  /** Any CSS colour; wins over `tone`. */
  color?: string;
  /** Nodes with the same group cluster together in the network layout. */
  group?: string;
  /** How connected the node is — dot nodes grow with it. */
  weight?: number;
}
export interface SimpleEdge {
  id: string;
  source: string;
  target: string;
  label?: string;
  dashed?: boolean;
  /** Any CSS colour; without it the line takes the canvas default. */
  color?: string | undefined;
}

export type GraphLayout = "network" | "hierarchy" | "radial";
type NodeStyle = "card" | "dot";

interface NodeData extends Record<string, unknown> {
  label: string;
  sublabel?: string | undefined;
  color: string;
  dimmed: boolean;
  focused: boolean;
  radius: number;
  /** Hierarchy flows top-to-bottom; the network has no direction. */
  vertical: boolean;
  /** Dot nodes only: the box around the circle and its label. */
  boxWidth?: number;
  /** Dot nodes only: a small pill, a bold caption (radial inner ring), or none. */
  labelMode?: "pill" | "strong" | "none";
}

const HANDLE_STYLE = {
  opacity: 0,
  width: 1,
  height: 1,
  border: 0,
  minWidth: 0,
  minHeight: 0,
} as const;

const colorOf = (n: SimpleNode) => n.color ?? TONE_VAR[n.tone ?? "slate"];
const radiusOf = (n: SimpleNode) => 7 + Math.min(15, Math.sqrt(n.weight ?? 0) * 2.4);

/* ── Nodes ───────────────────────────────────────────────────────────── */

const CardNode = memo(function CardNode({ data, selected }: NodeProps) {
  const { label, sublabel, color, dimmed, focused, vertical } = data as NodeData;
  const lit = selected || focused;
  return (
    <div
      title={label}
      className={cn(
        "relative flex w-full flex-col justify-center gap-0.5 rounded-xl border px-3 py-2 text-left transition-all duration-200",
        "bg-background-elevated/95",
        dimmed ? "opacity-40" : "opacity-100",
        lit && "shadow-[0_0_0_1px_var(--accent-color),0_8px_24px_-12px_var(--accent-color)]",
      )}
      style={
        {
          "--accent-color": color,
          borderColor: lit ? color : "var(--border)",
          height: CARD_H,
        } as CSSProperties
      }
    >
      <Handle
        type="target"
        position={vertical ? Position.Top : Position.Left}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
      <div className="flex items-center gap-1.5">
        <span
          className="size-1.5 shrink-0 rounded-full"
          style={{ background: color, boxShadow: `0 0 6px -1px ${color}` }}
        />
        <span className="truncate text-xs font-semibold text-foreground">{label}</span>
      </div>
      {sublabel ? (
        <span className="truncate pl-3 text-[10px] text-muted-foreground">{sublabel}</span>
      ) : null}
      <Handle
        type="source"
        position={vertical ? Position.Bottom : Position.Right}
        style={HANDLE_STYLE}
        isConnectable={false}
      />
    </div>
  );
});

/** A circle sized by how connected the node is, with its label underneath. */
const DotNode = memo(function DotNode({ data, selected }: NodeProps) {
  const { label, sublabel, color, dimmed, focused, radius, boxWidth, labelMode } = data as NodeData;
  const lit = selected || focused;
  // Radial dots are solid, like points on a chart; the others are rimmed.
  const solid = labelMode === "strong" || labelMode === "none";
  const centre: CSSProperties = {
    ...HANDLE_STYLE,
    left: "50%",
    top: radius,
    transform: "translate(-50%, -50%)",
  };
  return (
    <div
      title={sublabel ? `${label} — ${sublabel}` : label}
      className={cn(
        "group/dot flex flex-col items-center transition-opacity duration-200",
        dimmed ? "opacity-35" : "opacity-100",
      )}
      style={{ width: boxWidth ?? DOT_BOX_W }}
    >
      <Handle type="target" position={Position.Top} style={centre} isConnectable={false} />
      {/* Scales about the dot's centre, where the edges meet it. */}
      <div
        className="flex w-full flex-col items-center"
        style={{
          transform: "scale(var(--node-scale, 1))",
          transformOrigin: `50% ${radius}px`,
        }}
      >
        <span
          className={cn(
            "block shrink-0 rounded-full transition-transform duration-200 group-hover/dot:scale-125",
            !solid && "border-2",
          )}
          style={{
            width: radius * 2,
            height: radius * 2,
            borderColor: color,
            background: solid
              ? color
              : `color-mix(in oklch, ${color} ${lit ? 75 : 50}%, var(--background))`,
            boxShadow: lit
              ? `0 0 0 4px color-mix(in oklch, ${color} 25%, transparent), 0 0 22px -2px ${color}`
              : solid
                ? "none"
                : `0 0 12px -4px ${color}`,
          }}
        />
        {labelMode === "none" ? null : labelMode === "strong" ? (
          <span className="mt-1.5 max-w-full truncate text-center text-[13px] leading-4 font-semibold text-foreground">
            {label}
          </span>
        ) : (
          <span
            className={cn(
              "dot-label mt-1 max-w-full truncate rounded bg-background/75 px-1 text-center text-[10px] leading-4 text-foreground",
              lit && "font-semibold",
            )}
          >
            {label}
          </span>
        )}
      </div>
      <Handle type="source" position={Position.Bottom} style={centre} isConnectable={false} />
    </div>
  );
});

/** The root every radial branch grows from. */
const HubNode = memo(function HubNode() {
  return (
    <div className="pointer-events-none size-full rounded-full bg-foreground shadow-[0_8px_24px_-10px_var(--foreground)]">
      <Handle
        type="source"
        position={Position.Bottom}
        style={{ ...HANDLE_STYLE, left: "50%", top: "50%", transform: "translate(-50%, -50%)" }}
        isConnectable={false}
      />
    </div>
  );
});

/**
 * A link that leaves each end along its own spoke and bends in between, the
 * way d3's radial links do. The hub sits at the origin, so every end's angle
 * is read straight from its position.
 */
const RadialEdge = memo(function RadialEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  style,
}: EdgeProps) {
  const rs = Math.hypot(sourceX, sourceY);
  const rt = Math.hypot(targetX, targetY);
  const at = Math.atan2(targetY, targetX);
  const as = rs < 1 ? at : Math.atan2(sourceY, sourceX);
  const mid = (rs + rt) / 2;
  const path =
    `M${sourceX},${sourceY} ` +
    `C${Math.cos(as) * mid},${Math.sin(as) * mid} ` +
    `${Math.cos(at) * mid},${Math.sin(at) * mid} ` +
    `${targetX},${targetY}`;
  return <BaseEdge id={id} path={path} {...(style ? { style } : {})} />;
});

const edgeTypes = { radial: RadialEdge };

const CLUSTER_W = 360;

/** A cluster's name, drawn large so it still reads with the whole graph in view. */
const ClusterLabel = memo(function ClusterLabel({ data }: NodeProps) {
  const { label, color, dimmed, align } = data as {
    label: string;
    color?: string;
    dimmed: boolean;
    align: "center" | "start";
  };
  return (
    <div
      className={cn(
        "pointer-events-none font-display leading-none font-bold whitespace-nowrap transition-opacity duration-200",
        // Network clusters are read zoomed right out; layered bands much closer.
        align === "start" ? "text-left text-[40px]" : "text-center text-[64px]",
        dimmed ? "opacity-10" : "opacity-55",
      )}
      style={{ color: color ?? "var(--muted-foreground)" }}
    >
      {label}
    </div>
  );
});

const nodeTypes = {
  card: CardNode,
  dot: DotNode,
  cluster: ClusterLabel,
  hub: HubNode,
};

/* ── Layouts ─────────────────────────────────────────────────────────── */

type Point = { x: number; y: number };

function boxOf(n: SimpleNode, style: NodeStyle) {
  return style === "card"
    ? { w: CARD_W, h: CARD_H }
    : { w: DOT_BOX_W, h: radiusOf(n) * 2 + LABEL_H };
}

/** Ranked layout. Returns each node's top-left corner. */
function hierarchyLayout(
  nodes: SimpleNode[],
  edges: SimpleEdge[],
  rankdir: "LR" | "TB",
  style: NodeStyle,
): Record<string, Point> {
  const g = new dagre.graphlib.Graph();
  g.setDefaultEdgeLabel(() => ({}));
  const compact = style === "dot";
  g.setGraph({
    rankdir,
    nodesep: compact ? 10 : rankdir === "LR" ? 28 : 44,
    ranksep: compact ? 110 : rankdir === "LR" ? 120 : 84,
    marginx: 40,
    marginy: 40,
  });
  for (const n of nodes) {
    const { w, h } = boxOf(n, style);
    g.setNode(n.id, { width: w, height: h });
  }
  for (const e of edges) {
    if (g.hasNode(e.source) && g.hasNode(e.target)) g.setEdge(e.source, e.target);
  }
  dagre.layout(g);
  const out: Record<string, Point> = {};
  for (const n of nodes) {
    const pos = g.node(n.id);
    const { w, h } = boxOf(n, style);
    out[n.id] = pos ? { x: pos.x - w / 2, y: pos.y - h / 2 } : { x: 0, y: 0 };
  }
  return out;
}

interface Cluster {
  group: string;
  x: number;
  top: number;
  /** Centred over a network cluster, or at the start of a band. */
  align?: "center" | "start";
}

interface SimNode extends SimulationNodeDatum {
  id: string;
  group: string;
  r: number;
}

/**
 * One band per group, top to bottom in `order`, each wrapping onto as many
 * lines as it needs. Within a band, nodes are sorted by where their links
 * already sit above (the barycentre heuristic), which keeps lines short.
 */
function layeredLayout(nodes: SimpleNode[], edges: SimpleEdge[], order: string[] | undefined) {
  const groups = [...new Set(nodes.map((n) => n.group ?? "_"))].sort((a, b) => {
    const ia = order?.indexOf(a) ?? -1;
    const ib = order?.indexOf(b) ?? -1;
    return (ia < 0 ? 1e6 : ia) - (ib < 0 ? 1e6 : ib);
  });
  const perLine = Math.max(8, Math.ceil(Math.sqrt(nodes.length * 1.8)));
  const slot = DOT_BOX_W + 6;
  // The largest dot (radius 22), its label, and a little air.
  const lineH = 2 * 22 + LABEL_H + 10;
  const bandGap = 70;

  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
  }

  const centre = new Map<string, Point>();
  const out: Record<string, Point> = {};
  const clusters: Cluster[] = [];
  const width = perLine * slot;
  let y = 0;
  for (const g of groups) {
    const members = nodes.filter((n) => (n.group ?? "_") === g);
    const score = (n: SimpleNode) => {
      const xs = (neighbours.get(n.id) ?? []).flatMap((id) => {
        const p = centre.get(id);
        return p ? [p.x] : [];
      });
      return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.POSITIVE_INFINITY;
    };
    const sorted = members
      .map((n, i) => ({ n, i, s: score(n) }))
      .sort((a, b) => a.s - b.s || a.i - b.i)
      .map((m) => m.n);

    clusters.push({ group: g, x: -width / 2, top: y, align: "start" });
    for (let start = 0; start < sorted.length; start += perLine) {
      const line = sorted.slice(start, start + perLine);
      const lineW = line.length * slot;
      line.forEach((n, i) => {
        const cx = -lineW / 2 + slot * i + slot / 2;
        const r = radiusOf(n);
        const cy = y + 22;
        centre.set(n.id, { x: cx, y: cy });
        out[n.id] = { x: cx - DOT_BOX_W / 2, y: cy - r };
      });
      y += lineH;
    }
    y += bandGap;
  }
  return { positions: out, clusters };
}

/**
 * Each node's parent: the neighbour one or more levels above it. Levels come
 * from `order`, so for the application graph that is industry → domain →
 * subdomain → agent → workflow. Ties break on id, so the tree is stable.
 */
function parentMap(nodes: SimpleNode[], edges: SimpleEdge[], levelOf: (n: SimpleNode) => number) {
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const neighbours = new Map<string, string[]>();
  for (const e of edges) {
    if (!byId.has(e.source) || !byId.has(e.target)) continue;
    neighbours.set(e.source, [...(neighbours.get(e.source) ?? []), e.target]);
    neighbours.set(e.target, [...(neighbours.get(e.target) ?? []), e.source]);
  }
  const parent = new Map<string, string | null>();
  for (const n of nodes) {
    const level = levelOf(n);
    let best: { id: string; level: number } | null = null;
    for (const id of neighbours.get(n.id) ?? []) {
      const other = byId.get(id);
      if (!other) continue;
      const otherLevel = levelOf(other);
      // The closest level above wins: a workflow prefers a subdomain to an industry.
      if (
        otherLevel < level &&
        (!best || otherLevel > best.level || (otherLevel === best.level && id < best.id))
      ) {
        best = { id, level: otherLevel };
      }
    }
    parent.set(n.id, best?.id ?? null);
  }
  return parent;
}

/** Dot radius per ring, innermost first; deeper rings reuse the last. */
const RADIAL_DOT = [11, 8, 6, 5];
/** The innermost ring is captioned, so its boxes are wide enough to read. */
const RADIAL_LABEL_W = 190;
const HUB_R = 20;
const HUB_ID = "__hub";

interface RadialSize {
  r: number;
  labelled: boolean;
}

interface RadialInfo {
  size: Map<string, RadialSize>;
  parent: Map<string, string | null>;
  roots: string[];
}

const radialBox = (s: RadialSize) => ({
  w: s.labelled ? RADIAL_LABEL_W : s.r * 2,
  h: s.r * 2 + (s.labelled ? LABEL_H : 0),
});

/**
 * A hub in the middle, then one ring per level. Each subtree owns a slice of
 * the circle in proportion to its leaves, and a node's children bunch into a
 * tight arc around it inside that slice — so branches read as separate fans
 * with gaps between them, not an evenly spread ring.
 */
function radialLayout(nodes: SimpleNode[], edges: SimpleEdge[], order: string[] | undefined) {
  const levels = order?.length ? order : [...new Set(nodes.map((n) => n.group ?? "_"))];
  const levelOf = (n: SimpleNode) => {
    const i = levels.indexOf(n.group ?? "_");
    return i < 0 ? levels.length : i;
  };
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const parent = parentMap(nodes, edges, levelOf);

  const children = new Map<string, string[]>();
  const roots: string[] = [];
  for (const n of nodes) {
    const p = parent.get(n.id);
    if (p) children.set(p, [...(children.get(p) ?? []), n.id]);
    else roots.push(n.id);
  }
  const order2 = (ids: string[]) =>
    [...ids].sort((a, b) => {
      const x = byId.get(a)!;
      const y = byId.get(b)!;
      return levelOf(x) - levelOf(y) || x.label.localeCompare(y.label);
    });

  // Angular width is proportional to how many leaves a branch ends in.
  const leaves = new Map<string, number>();
  const countLeaves = (id: string): number => {
    const kids = children.get(id) ?? [];
    const n = kids.length ? kids.reduce((sum, k) => sum + countLeaves(k), 0) : 1;
    leaves.set(id, n);
    return n;
  };
  const FULL = Math.PI * 2;
  const total = order2(roots).reduce((sum, r) => sum + countLeaves(r), 0) || 1;

  // Each subtree's slice, in proportion to the leaves it ends in.
  const slice = new Map<string, [number, number]>();
  const carve = (id: string, from: number, to: number) => {
    slice.set(id, [from, to]);
    let at = from;
    for (const kid of order2(children.get(id) ?? [])) {
      const width = ((to - from) * (leaves.get(kid) ?? 1)) / Math.max(1, leaves.get(id) ?? 1);
      carve(kid, at, at + width);
      at += width;
    }
  };
  let at = -Math.PI / 2;
  for (const root of order2(roots)) {
    const width = (FULL * (leaves.get(root) ?? 1)) / total;
    carve(root, at, at + width);
    at += width;
  }

  const angle = new Map<string, number>();
  /** Pushes a ring's dots apart until none overlap, keeping their order. */
  const spread = (ids: string[], gap: number) => {
    if (ids.length < 2) return;
    const sorted = [...ids].sort((a, b) => angle.get(a)! - angle.get(b)!);
    const min = Math.min(gap, FULL / sorted.length);
    const wanted = sorted.map((id) => angle.get(id)!);
    let placed = [...wanted];
    for (let i = 1; i < placed.length; i++) {
      placed[i] = Math.max(placed[i]!, placed[i - 1]! + min);
    }
    // Past a full turn the last dot would land on the first: squeeze back in.
    const overflow = placed[placed.length - 1]! + min - (placed[0]! + FULL);
    if (overflow > 0) {
      placed = placed.map((a, i) => a - (overflow * i) / (placed.length - 1));
    }
    // Pushing only forwards drifts the ring round; recentre on where it wanted to be.
    const drift = placed.reduce((sum, a, i) => sum + a - wanted[i]!, 0) / placed.length;
    sorted.forEach((id, i) => angle.set(id, placed[i]! - drift));
  };

  // Rings from the middle out, so every parent is placed before its children.
  const ringLevels = [...new Set(nodes.map(levelOf))].sort((a, b) => a - b);
  const size = new Map<string, RadialSize>();
  const ringRadius = new Map<number, number>();
  let previous = 0;
  ringLevels.forEach((level, ring) => {
    const members = order2(nodes.filter((n) => levelOf(n) === level).map((n) => n.id));
    const r = RADIAL_DOT[Math.min(ring, RADIAL_DOT.length - 1)]!;
    const labelled = ring === 0;
    const outermost = ring === ringLevels.length - 1;
    const spacing = labelled ? 84 : r * 2 + 3;
    // Far enough out to hold every dot, and clear of the ring inside it.
    const radius = Math.max(previous + (ring === 0 ? 170 : 110), (members.length * spacing) / FULL);
    previous = radius;
    ringRadius.set(level, radius);
    for (const id of members) size.set(id, { r, labelled });

    const gap = spacing / radius;
    const byParent = new Map<string | null, string[]>();
    for (const id of members) {
      const p = parent.get(id) ?? null;
      byParent.set(p, [...(byParent.get(p) ?? []), id]);
    }
    for (const [p, kids] of byParent) {
      if (!p) {
        for (const kid of kids) {
          const [from, to] = slice.get(kid)!;
          angle.set(kid, (from + to) / 2);
        }
        continue;
      }
      // Siblings bunch around their parent, kept inside its slice. On the
      // outermost ring they fill the slice instead, so the edge reads as one
      // continuous circle rather than ragged fans.
      const [from, to] = slice.get(p)!;
      const room = (to - from) * 0.9;
      const bunched = (kids.length - 1) * gap;
      const span = outermost && kids.length > 1 ? room : Math.min(bunched, room);
      const step = kids.length > 1 ? span / (kids.length - 1) : 0;
      const centre = Math.min(Math.max(angle.get(p)!, from + span / 2), to - span / 2);
      kids.forEach((kid, i) => angle.set(kid, centre - span / 2 + i * step));
    }
    spread(members, gap);
  });

  const positions: Record<string, Point> = {};
  for (const n of nodes) {
    const s = size.get(n.id)!;
    const radius = ringRadius.get(levelOf(n))!;
    const a = angle.get(n.id) ?? 0;
    positions[n.id] = {
      x: Math.cos(a) * radius - radialBox(s).w / 2,
      y: Math.sin(a) * radius - s.r,
    };
  }
  const radial: RadialInfo = { size, parent, roots };
  return { positions, clusters: [] as Cluster[], radial };
}

/**
 * Force-directed layout with one gravity well per group, so each kind forms
 * its own cluster and the links between clusters stay readable. Seeded from
 * fixed positions, so the same graph always lands the same way.
 */
function networkLayout(nodes: SimpleNode[], edges: SimpleEdge[], style: NodeStyle) {
  const groups = [...new Set(nodes.map((n) => n.group ?? "_"))];
  // Wells sit on a ring big enough that clusters never overlap each other.
  const ring = Math.max(320, groups.length * 110 + Math.sqrt(nodes.length) * 18);
  const anchor = new Map<string, Point>(
    groups.map((g, i) => {
      const a = (i / groups.length) * Math.PI * 2 - Math.PI / 2;
      // An ellipse, wider than tall, to match the shape of a screen.
      return [
        g,
        groups.length === 1
          ? { x: 0, y: 0 }
          : { x: Math.cos(a) * ring * 1.6, y: Math.sin(a) * ring },
      ];
    }),
  );

  const seen = new Map<string, number>();
  const sim: SimNode[] = nodes.map((n) => {
    const group = n.group ?? "_";
    const a = anchor.get(group)!;
    const i = seen.get(group) ?? 0;
    seen.set(group, i + 1);
    // Golden-angle spiral around the group's well: deterministic, no overlaps.
    const t = i * 2.39996;
    const d = 12 * Math.sqrt(i + 1);
    return { id: n.id, group, r: radiusOf(n), x: a.x + Math.cos(t) * d, y: a.y + Math.sin(t) * d };
  });
  const ids = new Set(nodes.map((n) => n.id));
  const links = edges
    .filter((e) => ids.has(e.source) && ids.has(e.target) && e.source !== e.target)
    .map((e) => ({ source: e.source, target: e.target }));

  const simulation = forceSimulation(sim)
    .force(
      "link",
      forceLink<SimNode, { source: string; target: string }>(links)
        .id((d) => d.id)
        .distance(70)
        .strength(0.06),
    )
    .force("charge", forceManyBody<SimNode>().strength(-150).distanceMax(420))
    .force("collide", forceCollide<SimNode>((d) => d.r + 26).strength(1))
    .force("x", forceX<SimNode>((d) => anchor.get(d.group)!.x).strength(0.22))
    .force("y", forceY<SimNode>((d) => anchor.get(d.group)!.y).strength(0.22))
    .stop();
  const ticks = Math.min(400, 120 + nodes.length);
  for (let i = 0; i < ticks; i++) simulation.tick();

  const out: Record<string, Point> = {};
  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const s of sim) {
    const n = byId.get(s.id)!;
    const { w, h } = boxOf(n, style);
    // Dots are anchored on the circle's centre, cards on the box centre.
    out[s.id] =
      style === "dot"
        ? { x: (s.x ?? 0) - w / 2, y: (s.y ?? 0) - s.r }
        : { x: (s.x ?? 0) - w / 2, y: (s.y ?? 0) - h / 2 };
  }
  // Where each cluster sits, for its name above it.
  // Taken from the bulk of the cluster, so a few far-flung members don't drag it away.
  const quantile = (xs: number[], q: number) => {
    const sorted = [...xs].sort((p, r) => p - r);
    return sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))] ?? 0;
  };
  const clusters: Cluster[] = groups.map((g) => {
    const members = sim.filter((m) => m.group === g);
    const x = quantile(
      members.map((m) => m.x ?? 0),
      0.5,
    );
    const top = quantile(
      members.map((m) => (m.y ?? 0) - m.r),
      0.1,
    );
    return { group: g, x, top };
  });
  return { positions: out, clusters };
}

/* ── Controls that need the flow instance ────────────────────────────── */

/** How strongly nodes resist the zoom: 0 scales with it, 1 keeps a fixed screen size. */
const ELASTICITY = 0.65;

/**
 * Sets `--node-scale` on the frame so dots, labels and edge strokes grow and
 * shrink more slowly than the gaps between them: zooming out squeezes the
 * graph together, zooming in spreads it apart.
 */
function ElasticZoom({ frame }: { frame: RefObject<HTMLDivElement | null> }) {
  const zoom = useStore((s) => s.transform[2]);
  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const scale = Math.min(Math.max(zoom ** -ELASTICITY, 0.5), 3);
    el.style.setProperty("--node-scale", scale.toFixed(3));
    return () => {
      el.style.removeProperty("--node-scale");
    };
  }, [zoom, frame]);
  return null;
}

function ViewportControls({
  onReset,
  fitKey,
  focusIds,
  minimap,
  onToggleMinimap,
  isFullscreen,
  onToggleFullscreen,
  extra,
}: {
  /** Present once nodes have been dragged: puts them back where the layout had them. */
  onReset?: (() => void) | undefined;
  fitKey: string;
  focusIds: string[] | null | undefined;
  minimap: boolean;
  onToggleMinimap: () => void;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  extra?: ReactNode;
}) {
  const rf = useReactFlow();

  // Re-frame whenever the drawing or the frame itself changes size.
  useEffect(() => {
    const t = window.setTimeout(() => void rf.fitView({ padding: 0.12, duration: 350 }), 80);
    return () => window.clearTimeout(t);
  }, [fitKey, rf]);

  useEffect(() => {
    if (!focusIds?.length) return;
    const t = window.setTimeout(
      () =>
        void rf.fitView({
          nodes: focusIds.map((id) => ({ id })),
          padding: 0.4,
          duration: 450,
          maxZoom: 1.4,
        }),
      40,
    );
    return () => window.clearTimeout(t);
  }, [focusIds, rf]);

  return (
    <Panel position="top-right" className="!m-3 flex items-center gap-1.5">
      {extra}
      {onReset ? (
        <button
          type="button"
          onClick={onReset}
          title="Put dragged nodes back"
          className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background-elevated/90 px-2.5 text-[11px] font-medium text-muted-foreground backdrop-blur-md transition hover:border-primary/40 hover:text-foreground"
        >
          <RotateCcw className="size-3.5" />
          <span className="hidden sm:inline">Reset</span>
        </button>
      ) : null}
      <div className="flex items-center rounded-lg border border-border/60 bg-background-elevated/90 p-0.5 backdrop-blur-md">
        <CanvasButton label="Zoom in" onClick={() => void rf.zoomIn({ duration: 200 })}>
          <Plus className="size-3.5" />
        </CanvasButton>
        <CanvasButton label="Zoom out" onClick={() => void rf.zoomOut({ duration: 200 })}>
          <Minus className="size-3.5" />
        </CanvasButton>
        <CanvasButton
          label="Fit to screen"
          onClick={() => void rf.fitView({ padding: 0.12, duration: 350 })}
        >
          <Scan className="size-3.5" />
        </CanvasButton>
        <CanvasButton label="Minimap" active={minimap} onClick={onToggleMinimap}>
          <MapIcon className="size-3.5" />
        </CanvasButton>
      </div>
      <button
        type="button"
        onClick={onToggleFullscreen}
        aria-label={isFullscreen ? "Exit full screen" : "Full screen"}
        title={isFullscreen ? "Exit full screen (Esc)" : "Full screen"}
        className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border/60 bg-background-elevated/90 px-2.5 text-[11px] font-medium text-foreground backdrop-blur-md transition hover:border-primary/40 hover:text-primary"
      >
        {isFullscreen ? <Minimize2 className="size-3.5" /> : <Maximize2 className="size-3.5" />}
        <span className="hidden sm:inline">{isFullscreen ? "Exit" : "Full screen"}</span>
      </button>
    </Panel>
  );
}

export function CanvasButton({
  label,
  onClick,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  active?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      aria-pressed={active}
      className={cn(
        "grid size-7 place-items-center rounded-md transition",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:bg-surface-hover hover:text-foreground",
      )}
    >
      {children}
    </button>
  );
}

/** A floating panel over the canvas that folds down to its title. */
export function CanvasCard({
  title,
  icon,
  defaultOpen = true,
  className,
  children,
}: {
  title: string;
  icon?: ReactNode;
  defaultOpen?: boolean;
  className?: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div
      className={cn(
        "rounded-xl border border-border/60 bg-background-elevated/90 shadow-[var(--shadow-panel)] backdrop-blur-md",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className="flex w-full items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-semibold text-foreground"
      >
        {icon}
        {title}
        <ChevronDown
          className={cn("ml-auto size-3.5 text-muted-foreground transition", !open && "-rotate-90")}
        />
      </button>
      {open ? <div className="border-t border-border/50 p-2.5">{children}</div> : null}
    </div>
  );
}

/* ── Canvas ──────────────────────────────────────────────────────────── */

export function GraphCanvas({
  nodes,
  edges,
  onNodeClick,
  onNodeDoubleClick,
  onPaneClick,
  selectedId,
  highlightIds,
  focusIds,
  rankdir = "LR",
  layout = "hierarchy",
  nodeStyle = "card",
  toolbar,
  controls,
  legend,
  inspector,
  minimap: minimapDefault = false,
  wheelZoom = false,
  elastic = false,
  groupLabel,
  groupOrder,
  className,
  empty,
}: {
  nodes: SimpleNode[];
  edges: SimpleEdge[];
  onNodeClick?: (id: string) => void;
  onNodeDoubleClick?: (id: string) => void;
  onPaneClick?: () => void;
  /** Highlights this node and fades everything not connected to it. */
  selectedId?: string | null;
  /** Fades everything except these (e.g. search matches) while nothing is selected. */
  highlightIds?: Set<string> | null;
  /** Zooms to these nodes whenever the array changes. */
  focusIds?: string[] | null;
  rankdir?: "LR" | "TB";
  layout?: GraphLayout;
  nodeStyle?: NodeStyle;
  /** Floating controls over the top-left of the canvas. */
  toolbar?: ReactNode;
  /** Extra buttons next to the zoom controls, top-right. */
  controls?: ReactNode;
  /** Floating key over the bottom-left of the canvas. */
  legend?: ReactNode;
  /** A details panel docked on the right; omit it to keep the canvas clear. */
  inspector?: ReactNode;
  minimap?: boolean;
  /** Nodes and edges squeeze together on zoom out and spread apart on zoom in. */
  elastic?: boolean;
  /**
   * One-hand mouse navigation: the wheel zooms toward the cursor and dragging
   * the background pans. Off, the wheel pans and Ctrl+wheel zooms.
   */
  wheelZoom?: boolean;
  /** Names each group; with it, the network layout labels its clusters. */
  groupLabel?: (group: string) => string;
  /** Top-to-bottom order of the bands in the layered layout. */
  groupOrder?: string[];
  className?: string | undefined;
  empty?: ReactNode;
}) {
  const frameRef = useRef<HTMLDivElement>(null);
  const { isFullscreen, isFallback, toggle } = useFullscreen(frameRef);
  const [minimap, setMinimap] = useState(minimapDefault);
  /** Nodes the reader has dragged somewhere better, until the layout changes. */
  const [dragged, setDragged] = useState<Record<string, Point>>({});

  /**
   * Ids one hop from the selection — the rest of the graph fades.
   *
   * Hover is deliberately not React state. Every node and edge object is
   * rebuilt when this component re-renders, so a hover handler repainted the
   * whole graph each time the cursor crossed a node, which reads as constant
   * flickering. Hovering is styled in CSS instead: see `.ontology-canvas`
   * in styles.css.
   */
  const lit = useMemo(() => {
    if (!selectedId) return highlightIds && highlightIds.size > 0 ? highlightIds : null;
    const ids = new Set<string>([selectedId]);
    for (const e of edges) {
      if (e.source === selectedId) ids.add(e.target);
      if (e.target === selectedId) ids.add(e.source);
    }
    return ids;
  }, [selectedId, highlightIds, edges]);

  const vertical = layout === "hierarchy" && (nodeStyle === "dot" || rankdir === "TB");
  const { positions, clusters, radial } = useMemo<{
    positions: Record<string, Point>;
    clusters: Cluster[];
    radial?: RadialInfo;
  }>(
    () =>
      layout === "network"
        ? networkLayout(nodes, edges, nodeStyle)
        : layout === "radial" && nodeStyle === "dot"
          ? radialLayout(nodes, edges, groupOrder)
          : nodeStyle === "dot"
            ? layeredLayout(nodes, edges, groupOrder)
            : {
                positions: hierarchyLayout(nodes, edges, rankdir, nodeStyle),
                clusters: [] as Cluster[],
              },
    [nodes, edges, layout, rankdir, nodeStyle, groupOrder],
  );

  const flowNodes = useMemo<Node<NodeData>[]>(
    () =>
      nodes.map((n) => {
        const ring = radial?.size.get(n.id);
        const { w, h } = ring ? radialBox(ring) : boxOf(n, nodeStyle);
        return {
          id: n.id,
          type: nodeStyle,
          position: dragged[n.id] ?? positions[n.id] ?? { x: 0, y: 0 },
          data: {
            label: n.label,
            sublabel: n.sublabel,
            color: colorOf(n),
            dimmed: Boolean(lit && !lit.has(n.id)),
            focused: n.id === selectedId || Boolean(!selectedId && highlightIds?.has(n.id)),
            radius: ring?.r ?? radiusOf(n),
            vertical,
            boxWidth: w,
            labelMode: ring ? (ring.labelled ? "strong" : "none") : "pill",
          },
          style: { width: w, height: h },
          draggable: true,
          connectable: false,
        };
      }),
    [nodes, positions, radial, dragged, lit, selectedId, highlightIds, nodeStyle, vertical],
  );

  /** The dark root in the middle of the radial layout. */
  const hubNodes = useMemo<Node[]>(
    () =>
      radial
        ? [
            {
              id: HUB_ID,
              type: "hub",
              position: { x: -HUB_R, y: -HUB_R },
              data: {},
              style: { width: HUB_R * 2, height: HUB_R * 2 },
              draggable: false,
              connectable: false,
              selectable: false,
              focusable: false,
            },
          ]
        : [],
    [radial],
  );

  /** One entry per level, in ring order, for the radial layout's key. */
  const levelKey = useMemo(() => {
    if (!radial || !groupLabel) return [];
    const seen = new Map<string, string>();
    for (const n of nodes) {
      const group = n.group ?? "_";
      if (!seen.has(group)) seen.set(group, colorOf(n));
    }
    const rank = (g: string) => {
      const i = groupOrder?.indexOf(g) ?? -1;
      return i < 0 ? 1e6 : i;
    };
    return [...seen.entries()]
      .sort(([a], [b]) => rank(a) - rank(b))
      .map(([group, color]) => ({ group, color, label: groupLabel(group) }));
  }, [radial, groupLabel, groupOrder, nodes]);

  /** One big name per cluster, readable when the whole network is in view. */
  const clusterNodes = useMemo<Node[]>(() => {
    if (!groupLabel || clusters.length < 2) return [];
    const colourOf = new Map(nodes.map((n) => [n.group ?? "_", colorOf(n)]));
    return clusters.map((c) => ({
      id: `__cluster:${c.group}`,
      type: "cluster",
      position:
        c.align === "start" ? { x: c.x, y: c.top - 52 } : { x: c.x - CLUSTER_W / 2, y: c.top - 96 },
      data: {
        label: groupLabel(c.group),
        color: colourOf.get(c.group),
        dimmed: Boolean(lit),
        align: c.align ?? "center",
      },
      style: { width: CLUSTER_W },
      draggable: false,
      connectable: false,
      selectable: false,
      focusable: false,
    }));
  }, [clusters, groupLabel, nodes, lit]);

  const allNodes = useMemo<Node[]>(
    () => [...hubNodes, ...clusterNodes, ...flowNodes],
    [hubNodes, clusterNodes, flowNodes],
  );

  const flowEdges = useMemo<Edge[]>(() => {
    const present = new Set(nodes.map((n) => n.id));
    const dots = nodeStyle === "dot";
    // The radial layout draws its tree and the hub's spokes; any other link
    // only shows while it touches the selection, or the fans turn to noise.
    const inTree = (e: SimpleEdge) =>
      !radial ||
      radial.parent.get(e.target) === e.source ||
      radial.parent.get(e.source) === e.target ||
      e.source === selectedId ||
      e.target === selectedId;
    const spokes: SimpleEdge[] = radial
      ? radial.roots.map((id) => ({ id: `${HUB_ID}->${id}`, source: HUB_ID, target: id }))
      : [];
    return [...spokes, ...edges.filter(inTree)]
      .filter((e) => (present.has(e.source) || e.source === HUB_ID) && present.has(e.target))
      .map((e) => {
        const active = !lit || ((e.source === HUB_ID || lit.has(e.source)) && lit.has(e.target));
        const touches = Boolean(selectedId) && (e.source === selectedId || e.target === selectedId);
        if (radial) {
          return {
            id: e.id,
            source: e.source,
            target: e.target,
            type: "radial",
            zIndex: touches ? 10 : 0,
            style: {
              stroke: touches
                ? "var(--primary)"
                : "color-mix(in oklch, var(--muted-foreground) 32%, transparent)",
              strokeWidth: `calc(${touches ? 2 : 1}px * var(--node-scale, 1))`,
              opacity: active ? 1 : 0.15,
              ...(e.dashed ? { strokeDasharray: "4 4" } : {}),
            },
          } satisfies Edge;
        }
        const stroke = touches
          ? "var(--primary)"
          : (e.color ?? "color-mix(in oklch, var(--foreground) 45%, transparent)");
        // A dense network reads better without a label on every line.
        const showLabel = Boolean(e.label) && (!dots || touches);
        return {
          id: e.id,
          source: e.source,
          target: e.target,
          type: dots ? "straight" : "smoothstep",
          ...(showLabel ? { label: e.label } : {}),
          zIndex: touches ? 10 : 0,
          style: {
            stroke,
            strokeWidth: `calc(${touches ? 2.2 : 1.2}px * var(--node-scale, 1))`,
            opacity: active ? (dots && !touches ? 0.75 : 1) : 0.18,
            ...(e.dashed ? { strokeDasharray: "4 4" } : {}),
          },
          ...(dots
            ? {}
            : {
                markerEnd: {
                  type: MarkerType.ArrowClosed,
                  width: 14,
                  height: 14,
                  color: stroke,
                },
              }),
          labelShowBg: true,
          labelBgPadding: [5, 2] as [number, number],
          labelBgBorderRadius: 4,
          labelBgStyle: { fill: "var(--background-elevated)", fillOpacity: active ? 0.95 : 0.1 },
          labelStyle: {
            fill: touches ? "var(--foreground)" : "var(--muted-foreground)",
            fontSize: 9,
            textTransform: "uppercase" as const,
            letterSpacing: "0.04em",
            opacity: active ? 1 : 0.1,
          },
        } satisfies Edge;
      });
  }, [nodes, edges, lit, selectedId, nodeStyle, radial]);

  const fitKey = `${layout}:${nodeStyle}:${nodes.length}:${edges.length}:${isFullscreen}`;

  if (nodes.length === 0) {
    return (
      <div className={cn("flex h-full min-h-[18rem] items-center justify-center", className)}>
        {empty}
      </div>
    );
  }

  return (
    <div
      ref={frameRef}
      className={cn(
        "ontology-canvas relative h-full min-h-[18rem] w-full overflow-hidden border border-border/60 bg-background",
        isFullscreen ? "rounded-none" : "rounded-2xl",
        isFallback && "fixed inset-0 z-[70] h-screen min-h-0",
        className,
        isFallback && "h-screen",
      )}
    >
      <ReactFlowProvider>
        <ReactFlow
          colorMode="dark"
          nodes={allNodes}
          edges={flowEdges}
          nodeTypes={nodeTypes}
          edgeTypes={edgeTypes}
          fitView
          fitViewOptions={{ padding: 0.12 }}
          minZoom={0.05}
          maxZoom={2.2}
          proOptions={{ hideAttribution: true }}
          nodesDraggable
          nodesConnectable={false}
          onNodesChange={(changes) => {
            for (const change of changes) {
              if (change.type === "position" && change.position && !change.id.startsWith("__")) {
                const { x, y } = change.position;
                setDragged((current) => ({ ...current, [change.id]: { x, y } }));
              }
            }
          }}
          elementsSelectable
          panOnScroll={!wheelZoom}
          zoomOnScroll={wheelZoom}
          panOnDrag
          zoomOnDoubleClick={false}
          selectionOnDrag={false}
          {...(onNodeClick
            ? {
                onNodeClick: (_e: unknown, node: { id: string }) => {
                  if (!node.id.startsWith("__")) onNodeClick(node.id);
                },
              }
            : {})}
          {...(onNodeDoubleClick
            ? {
                onNodeDoubleClick: (_e: unknown, node: { id: string }) => {
                  if (!node.id.startsWith("__")) onNodeDoubleClick(node.id);
                },
              }
            : {})}
          {...(onPaneClick ? { onPaneClick } : {})}
        >
          {radial ? (
            <Background
              variant={BackgroundVariant.Lines}
              gap={64}
              lineWidth={1}
              color="color-mix(in oklch, var(--border) 70%, transparent)"
            />
          ) : (
            <Background
              variant={BackgroundVariant.Dots}
              gap={22}
              size={1}
              color="var(--border-strong)"
            />
          )}
          {levelKey.length ? (
            <Panel position="top-right" className="!mt-14 !mr-3">
              <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-background-elevated/90 px-3 py-1.5 text-[12px] text-foreground shadow-[var(--shadow-panel)] backdrop-blur-md">
                {levelKey.map((k) => (
                  <span key={k.group} className="inline-flex items-center gap-1.5">
                    <span className="size-2.5 rounded-full" style={{ background: k.color }} />
                    {k.label}
                  </span>
                ))}
              </div>
            </Panel>
          ) : null}
          {elastic ? <ElasticZoom frame={frameRef} /> : null}
          <ViewportControls
            onReset={Object.keys(dragged).length ? () => setDragged({}) : undefined}
            fitKey={fitKey}
            focusIds={focusIds}
            minimap={minimap}
            onToggleMinimap={() => setMinimap((m) => !m)}
            isFullscreen={isFullscreen}
            onToggleFullscreen={() => void toggle()}
            extra={controls}
          />
          {minimap ? (
            <MiniMap
              pannable
              zoomable
              position="bottom-right"
              className={cn(
                "!m-3 !rounded-xl !border !border-border/60 !bg-background-elevated/90",
                inspector && "!mr-[21.5rem]",
              )}
              bgColor="transparent"
              maskColor="color-mix(in oklch, var(--background) 72%, transparent)"
              maskStrokeColor="var(--primary)"
              nodeColor={(n) =>
                n.type === "cluster"
                  ? "transparent"
                  : ((n.data as NodeData)?.color ?? "var(--slate)")
              }
              nodeStrokeWidth={0}
              nodeBorderRadius={nodeStyle === "dot" ? 40 : 4}
            />
          ) : null}
          {toolbar ? (
            <Panel position="top-left" className="!m-3 max-w-[calc(100%-22rem)]">
              {toolbar}
            </Panel>
          ) : null}
          {legend ? (
            <Panel position="bottom-left" className="!m-3">
              {legend}
            </Panel>
          ) : null}
        </ReactFlow>
      </ReactFlowProvider>

      {inspector ? (
        <div className="pointer-events-none absolute top-14 right-3 bottom-3 z-10 flex w-80 max-w-[calc(100%-1.5rem)] flex-col">
          <div className="pointer-events-auto flex max-h-full min-h-0 flex-col">{inspector}</div>
        </div>
      ) : null}
    </div>
  );
}
