/**
 * Fruchterman–Reingold force-directed placement — the "springy" scatter that
 * makes a graph read as Neo4j Browser rather than as this app's other, more
 * deliberately arranged canvases.
 *
 * The rest of this app's layouts (`graphLayout.ts`) are geometric on purpose:
 * the ontology is a hierarchy, so a tree or a set of industry islands answers
 * the question a viewer actually has. An ad hoc Cypher result has no such
 * shape to lean on — it might be a hierarchy, a cycle, or a handful of
 * unrelated components — so physics is the right default here specifically:
 * nodes repel each other, edges pull their endpoints together, and whatever
 * structure exists falls out of the simulation instead of being assumed.
 *
 * Hand-rolled rather than a dependency (graphology-layout-forceatlas2, d3-force)
 * because a capped ad hoc query is never more than a couple hundred nodes —
 * this is a few hundred lines' worth of math the app already carries the style
 * for, not a new subsystem.
 */

export interface ForceLayoutOptions {
  width?: number;
  height?: number;
  iterations?: number;
  /** Positions to start from — settled nodes stay roughly put on a re-run. */
  seed?: Map<string, { x: number; y: number }>;
}

/** Above this, an O(n²) repulsion pass per iteration stops being cheap. */
const MAX_SIMULATED_NODES = 600;

export function computeForceLayout(
  nodeIds: string[],
  edges: { source: string; target: string }[],
  options: ForceLayoutOptions = {},
): Map<string, { x: number; y: number }> {
  const n = nodeIds.length;
  const positions = new Map<string, { x: number; y: number }>();
  if (n === 0) return positions;

  const width = options.width ?? 900;
  const height = options.height ?? 900;
  const seed = options.seed;

  // Deterministic PRNG, seeded from the node id set — the same graph settles
  // into the same layout on every render instead of reshuffling each time,
  // which would make it unreadable the moment a filter toggles.
  let state = 0;
  for (const id of nodeIds) for (let i = 0; i < id.length; i += 1) state = (state * 31 + id.charCodeAt(i)) | 0;
  state = (Math.abs(state) || 1) >>> 0;
  const rand = () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };

  const radius = Math.min(width, height) / 2.2;
  nodeIds.forEach((id, i) => {
    const carried = seed?.get(id);
    if (carried) {
      positions.set(id, { ...carried });
      return;
    }
    // New (unseeded) nodes start on a ring rather than fully at random — a
    // ring start produces measurably fewer crossed edges for the same
    // iteration budget than uniform random placement does.
    const angle = (i / n) * Math.PI * 2;
    positions.set(id, {
      x: Math.cos(angle) * radius * (0.4 + rand() * 0.6),
      y: Math.sin(angle) * radius * (0.4 + rand() * 0.6),
    });
  });

  if (n > MAX_SIMULATED_NODES) return positions;

  // Iteration budget shrinks as the graph grows — O(n²) per pass means the
  // wall-clock cost is already growing quadratically without also fixing the
  // pass count at a size meant for a few dozen nodes.
  const iterations = options.iterations ?? Math.max(40, Math.min(260, Math.round(30000 / n)));

  const area = width * height;
  const k = Math.sqrt(area / n); // ideal inter-node distance
  const idealEdgeLength = k * 0.85;
  const validEdges = edges.filter((e) => positions.has(e.source) && positions.has(e.target));

  const dispX = new Float64Array(n);
  const dispY = new Float64Array(n);
  const indexOf = new Map(nodeIds.map((id, i) => [id, i]));

  for (let iter = 0; iter < iterations; iter += 1) {
    dispX.fill(0);
    dispY.fill(0);

    // Repulsion — every pair pushes apart. Fine at this node count; a
    // Barnes–Hut approximation would be the next step past a few thousand.
    for (let i = 0; i < n; i += 1) {
      const pi = positions.get(nodeIds[i])!;
      for (let j = i + 1; j < n; j += 1) {
        const pj = positions.get(nodeIds[j])!;
        let dx = pi.x - pj.x;
        let dy = pi.y - pj.y;
        const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const force = (k * k) / dist;
        dx = (dx / dist) * force;
        dy = (dy / dist) * force;
        dispX[i] += dx; dispY[i] += dy;
        dispX[j] -= dx; dispY[j] -= dy;
      }
    }

    // Attraction — edges pull their endpoints together like springs.
    for (const edge of validEdges) {
      const si = indexOf.get(edge.source)!;
      const ti = indexOf.get(edge.target)!;
      const ps = positions.get(edge.source)!;
      const pt = positions.get(edge.target)!;
      let dx = ps.x - pt.x;
      let dy = ps.y - pt.y;
      const dist = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (dist * dist) / idealEdgeLength;
      dx = (dx / dist) * force;
      dy = (dy / dist) * force;
      dispX[si] -= dx; dispY[si] -= dy;
      dispX[ti] += dx; dispY[ti] += dy;
    }

    // Cooling — large steps early, settling to near-stillness by the end.
    const temp = (1 - iter / iterations) * k * 0.6;
    for (let i = 0; i < n; i += 1) {
      const dist = Math.sqrt(dispX[i] * dispX[i] + dispY[i] * dispY[i]) || 0.01;
      const step = Math.min(dist, temp);
      const p = positions.get(nodeIds[i])!;
      p.x += (dispX[i] / dist) * step;
      p.y += (dispY[i] / dist) * step;
    }
  }

  return positions;
}
