/**
 * Words and numbers for a tracked request: what it is, how far it has got,
 * and what it is doing right now — all from what actually happened, never
 * from a timer.
 */
import type { TrackedOp } from "@/stores/ops";

/** Path verbs, by the segment that names the action. */
const ACTIONS: Record<string, string> = {
  activate: "Activating",
  approve: "Approving",
  apply: "Applying revision",
  archive: "Archiving",
  build: "Building on server",
  cancel: "Cancelling",
  check: "Running diagnostics",
  "check-all": "Checking all servers",
  classify: "Classifying",
  commit: "Committing to graph",
  completions: "Generating answer",
  "delete-workflow": "Removing workflow from server",
  "deploy-workflow": "Deploying workflow",
  disconnect: "Disconnecting",
  discard: "Discarding",
  draft: "Drafting with AI",
  ensure: "Preparing optimiser",
  export: "Exporting",
  extract: "Extracting knowledge",
  fix: "Fixing with AI",
  "generate-key": "Generating key",
  "health-check": "Checking MCP servers",
  login: "Signing in",
  logout: "Signing out",
  orchestrate: "Orchestrating",
  package: "Packaging deployment",
  preview: "Building preview",
  propose: "Proposing ontology",
  provision: "Provisioning server",
  "publish-mcp": "Publishing to MCP",
  query: "Querying",
  reconnect: "Reconnecting",
  refresh: "Refreshing",
  reject: "Rejecting",
  reset: "Resetting",
  restore: "Restoring",
  reveal: "Revealing",
  rollback: "Rolling back",
  "run-workflow": "Running workflow on server",
  search: "Searching",
  "send-tool": "Sending tool to server",
  start: "Starting",
  sync: "Syncing",
  "sync-taxonomy": "Syncing taxonomy",
  synthesize: "Synthesising",
  terminate: "Terminating",
  test: "Testing",
  "turn-off": "Turning off",
  unarchive: "Restoring",
  undo: "Undoing",
  validate: "Validating",
  webpage: "Importing webpage",
};

const NOUNS: Record<string, string> = {
  agents: "agent",
  cleanup: "cleanup",
  concepts: "concept",
  connectors: "connector",
  conversations: "conversation",
  documents: "document",
  executions: "execution",
  knowledge: "knowledge",
  libraries: "library",
  mcp: "MCP server",
  ontology: "ontology",
  processes: "process",
  rag: "knowledge graph",
  "remote-servers": "remote server",
  rules: "rule",
  runs: "run",
  schemes: "scheme",
  secrets: "secret",
  settings: "settings",
  templates: "template",
  tools: "tool",
  uploads: "file",
  vault: "vault",
  workflows: "workflow",
};

const isId = (seg: string) => /^\d+$/.test(seg) || /^[0-9a-f-]{12,}$/i.test(seg);

export function describeRequest(method: string, url: string): string {
  const path = url.split("?")[0] ?? "";
  const segs = path
    .replace(/^\/api\//, "")
    .split("/")
    .filter(Boolean)
    .map(decodeURIComponent);
  // Actions are POSTs to a verb: /remote-servers/3/check. A PUT or DELETE of
  // the same path names the thing, not an action.
  const last = [...segs].reverse().find((s) => !isId(s)) ?? "";
  const action = method === "POST" ? ACTIONS[last] : undefined;
  // The innermost resource the path names — "documents" in /libraries/x/documents.
  const nounSeg = [...segs].reverse().find((s) => NOUNS[s]);
  const noun = nounSeg ? NOUNS[nounSeg] : (segs[0] ?? "data");
  if (method === "GET") return `Loading ${noun}`;
  if (action) return action;
  if (nounSeg === "uploads" || segs.includes("documents")) {
    if (method === "POST") return `Uploading ${noun}`;
  }
  if (nounSeg === "cleanup" && method === "POST") return "Cleaning up";
  switch (method) {
    case "POST":
      return isId(segs[segs.length - 1] ?? "") ? `Updating ${noun}` : `Creating ${noun}`;
    case "PUT":
    case "PATCH":
      return `Saving ${noun}`;
    case "DELETE":
      return `Deleting ${noun}`;
    default:
      return `${method} ${noun}`;
  }
}

const uploading = (op: TrackedOp) =>
  !!op.upload && op.upload.total > 0 && op.upload.loaded < op.upload.total;

/** How far the request has measurably got, 0–1, or null when nothing measures it. */
export function opFraction(op: TrackedOp): number | null {
  if (op.status !== "pending") return 1;
  if (uploading(op)) return op.upload!.loaded / op.upload!.total;
  if (op.layers.length) {
    const settled = op.layers.filter((l) => l.state !== "pending" && l.state !== "active").length;
    return settled / op.layers.length;
  }
  if (op.measured && op.measured.total > 0) return op.measured.done / op.measured.total;
  if (op.download && op.download.total > 0) return op.download.loaded / op.download.total;
  return null;
}

/** "3 / 7" — the count behind the fraction, when there is one. */
export function opCount(op: TrackedOp): string | null {
  if (op.layers.length) {
    const settled = op.layers.filter((l) => l.state !== "pending" && l.state !== "active").length;
    return `${settled}/${op.layers.length}`;
  }
  if (op.measured) return `${op.measured.done}/${op.measured.total}`;
  return null;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const STEP_VERB: Record<string, string> = {
  model: "Calling model",
  tool: "Running tool",
  step: "Workflow step",
  stage: "",
};

function activeStep(op: TrackedOp) {
  for (let i = op.steps.length - 1; i >= 0; i--) {
    const s = op.steps[i];
    if (s && s.state === "active") return s;
  }
  return undefined;
}

/** What the request is doing right now, in one line. */
export function opActivity(op: TrackedOp): string {
  if (op.status === "completed") return "Done";
  if (op.status === "failed") return op.error ?? "Failed";
  if (uploading(op)) {
    return `Uploading ${formatBytes(op.upload!.loaded)} of ${formatBytes(op.upload!.total)}`;
  }
  const layer = op.layers.find((l) => l.state === "active");
  const step = activeStep(op);
  if (step) {
    const verb = STEP_VERB[step.kind] ?? step.kind;
    const stepText = verb ? `${verb} · ${step.name}` : step.name;
    return layer ? `${layer.label} — ${stepText}` : stepText;
  }
  if (layer) return layer.label;
  if (op.stage) return op.stage.label;
  if (op.note) return op.note;
  if (op.download && op.download.loaded > 0) {
    return `Receiving response · ${formatBytes(op.download.loaded)}`;
  }
  if (op.upload && op.upload.total > 0) return "Uploaded — processing on the server";
  return "Waiting for the server";
}

/** A second line of detail under the activity, when there is one worth showing. */
export function opDetail(op: TrackedOp): string | null {
  if (op.status !== "pending") return null;
  const detail = op.stage?.detail ?? op.note;
  return detail && detail !== opActivity(op) ? detail : null;
}
