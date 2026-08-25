import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  ArrowLeft,
  KeyRound,
  Loader2,
  Plug,
  Plus,
  ShieldCheck,
  Trash2,
  ExternalLink,
  Play,
} from "lucide-react";
import { connectorsApi, QK, errorMessage } from "@/api";
import type { ConnectorScope, ConnectorTool } from "@/types";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { DetailSkeleton } from "@/components/ui/Skeletons";
import { StatusPill } from "@/components/ui/StatusPill";
import { CodeBlock } from "@/components/shared/CodeBlock";
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from "@/components/ui/select";

export const Route = createFileRoute("/connectors/$id")({
  head: () => ({
    meta: [
      { title: "Connector — Agentic AI Design Patterns" },
      { name: "description", content: "Connector detail." },
      { property: "og:title", content: "Connector — Agentic AI Design Patterns" },
      { property: "og:description", content: "Connector detail." },
    ],
  }),
  component: ConnectorsIdPage,
});

const SCOPES: ConnectorScope[] = ["user", "workspace", "organization"];

function ToolsSection({ id }: { id: string }) {
  const query = useQuery({ queryKey: QK.connectorTools(id), queryFn: () => connectorsApi.tools(id) });
  const [testTool, setTestTool] = useState<ConnectorTool | null>(null);
  const [args, setArgs] = useState("{}");
  const [credName, setCredName] = useState("");
  const [result, setResult] = useState<{ result: unknown; output: unknown } | null>(null);

  const call = useMutation({
    mutationFn: () => {
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(args || "{}");
      } catch {
        throw new Error("Arguments must be valid JSON.");
      }
      return connectorsApi.callTool(id, testTool!.name, {
        arguments: parsed,
        ...(credName ? { credentials_name: credName } : {}),
      });
    },
    onSuccess: (res) => setResult(res),
    onError: (e) => toast.error(errorMessage(e)),
  });

  if (query.isLoading) return <DetailSkeleton />;
  if (query.isError) return <ErrorState error={query.error} onRetry={() => query.refetch()} />;
  const tools = query.data?.tools ?? [];
  if (tools.length === 0) return <EmptyState icon={<Plug className="size-6" />} title="No tools exposed." />;

  return (
    <div className="space-y-3">
      {tools.map((tool) => (
        <div key={tool.name} className="rounded-xl border border-border bg-background-elevated/50 p-3">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="text-sm font-medium text-foreground">{tool.name}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{tool.description}</p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setTestTool(tool);
                setArgs("{}");
                setResult(null);
              }}
            >
              <Play className="size-3.5" /> Test
            </Button>
          </div>
          {Object.keys(tool.parameters ?? {}).length > 0 ? (
            <CodeBlock code={JSON.stringify(tool.parameters, null, 2)} language="json" />
          ) : null}
        </div>
      ))}

      {testTool ? (
        <GlassPanel className="p-4">
          <GlassPanelHeader
            title={`Test — ${testTool.name}`}
            actions={
              <Button size="sm" variant="ghost" onClick={() => setTestTool(null)}>
                Close
              </Button>
            }
          />
          <div className="space-y-2 p-4">
            <Textarea
              value={args}
              onChange={(e) => setArgs(e.target.value)}
              rows={6}
              className="font-mono text-xs"
              placeholder="Arguments (JSON)"
            />
            <Input
              value={credName}
              onChange={(e) => setCredName(e.target.value)}
              placeholder="credentials_name (optional)"
            />
            <div className="flex justify-end">
              <Button size="sm" onClick={() => call.mutate()} disabled={call.isPending}>
                {call.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
                Call tool
              </Button>
            </div>
            {result ? (
              <div className="space-y-3 pt-2">
                <div>
                  <p className="eyebrow mb-1.5">Result</p>
                  <CodeBlock code={JSON.stringify(result.result, null, 2)} language="json" />
                </div>
                <div>
                  <p className="eyebrow mb-1.5">Output</p>
                  <CodeBlock code={JSON.stringify(result.output, null, 2)} language="json" />
                </div>
              </div>
            ) : null}
          </div>
        </GlassPanel>
      ) : null}
    </div>
  );
}

function AuthenticationSection({ id }: { id: string }) {
  const query = useQuery({ queryKey: [...QK.connector(id), "auth"], queryFn: () => connectorsApi.authentication(id) });
  const [authUrl, setAuthUrl] = useState<string | null>(null);

  const fetchAuthUrl = useMutation({
    mutationFn: () => connectorsApi.authUrl(id),
    onSuccess: (res) => {
      setAuthUrl(res.auth_url);
      window.open(res.auth_url, "_blank", "noopener,noreferrer");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      {query.isLoading ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : (
        <CodeBlock code={JSON.stringify(query.data, null, 2)} language="json" />
      )}
      <Button size="sm" variant="outline" onClick={() => fetchAuthUrl.mutate()} disabled={fetchAuthUrl.isPending}>
        {fetchAuthUrl.isPending ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
        Get auth URL
      </Button>
      <p className="text-xs text-muted-foreground">
        Auth URLs are short-lived — fetched fresh on click and never cached.
      </p>
      {authUrl ? (
        <p className="break-all rounded-lg border border-border bg-background-elevated/50 p-2 text-xs text-foreground">
          {authUrl}
        </p>
      ) : null}
    </div>
  );
}

interface CredentialItem {
  name: string;
  is_default?: boolean;
  [k: string]: unknown;
}

function CredentialsSection({ id }: { id: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<ConnectorScope>("user");
  const [showForm, setShowForm] = useState(false);
  const [name, setName] = useState("");
  const [token, setToken] = useState("");
  const [isDefault, setIsDefault] = useState(false);

  const query = useQuery({
    queryKey: [...QK.connectorCreds(id), scope],
    queryFn: () => connectorsApi.credentials(id, scope),
  });

  const create = useMutation({
    mutationFn: () =>
      connectorsApi.createCredentials(id, { name, credentials: { bearer_token: token }, is_default: isDefault }, scope),
    onSuccess: () => {
      toast.success("Credentials saved.");
      setName("");
      setToken("");
      setIsDefault(false);
      setShowForm(false);
      qc.invalidateQueries({ queryKey: QK.connectorCreds(id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const remove = useMutation({
    mutationFn: (credName: string) => connectorsApi.deleteCredentials(id, credName, scope),
    onSuccess: () => {
      toast.success("Credentials deleted.");
      qc.invalidateQueries({ queryKey: QK.connectorCreds(id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const items = (query.data?.credentials ?? []) as CredentialItem[];

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Select value={scope} onValueChange={(v) => setScope(v as ConnectorScope)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button size="sm" variant="outline" onClick={() => setShowForm((s) => !s)}>
          <Plus className="size-3.5" /> Add credentials
        </Button>
      </div>

      {showForm ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && token.trim()) create.mutate();
          }}
          className="space-y-2 rounded-xl border border-border bg-background-elevated/60 p-3"
        >
          <Input placeholder="name" value={name} onChange={(e) => setName(e.target.value)} />
          <Input placeholder="token" value={token} onChange={(e) => setToken(e.target.value)} />
          <label className="flex items-center gap-2 text-xs text-muted-foreground">
            <Switch checked={isDefault} onCheckedChange={setIsDefault} /> Set as default
          </label>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setShowForm(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={create.isPending}>
              {create.isPending ? "Saving…" : "Save"}
            </Button>
          </div>
        </form>
      ) : null}

      {query.isLoading ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} onRetry={() => query.refetch()} />
      ) : items.length === 0 ? (
        <EmptyState icon={<KeyRound className="size-6" />} title={`No credentials at ${scope} scope.`} />
      ) : (
        <ul className="space-y-2">
          {items.map((cred) => (
            <li
              key={cred.name}
              className="flex items-center justify-between gap-2 rounded-xl border border-border bg-background-elevated/50 p-3"
            >
              <div className="flex items-center gap-2">
                <p className="text-sm text-foreground">{cred.name}</p>
                {cred.is_default ? (
                  <StatusPill
                    identity={{ label: "Default", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30" }}
                    size="xs"
                  />
                ) : null}
              </div>
              <Button
                size="sm"
                variant="ghost"
                className="text-red hover:text-red"
                onClick={() => remove.mutate(cred.name)}
                disabled={remove.isPending}
              >
                <Trash2 className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ActivationSection({ id }: { id: string }) {
  const qc = useQueryClient();
  const [scope, setScope] = useState<ConnectorScope>("organization");
  const [active, setActive] = useState(true);
  const [include, setInclude] = useState("");
  const [exclude, setExclude] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);

  const includeList = include.split(",").map((s) => s.trim()).filter(Boolean);
  const excludeList = exclude.split(",").map((s) => s.trim()).filter(Boolean);

  const setActivation = useMutation({
    mutationFn: () =>
      connectorsApi.setActivation(id, { active, include: includeList, exclude: excludeList }, scope),
    onSuccess: () => {
      toast.success(`Activation updated for ${scope} scope.`);
      setConfirmOpen(false);
      qc.invalidateQueries({ queryKey: QK.connector(id) });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <Select value={scope} onValueChange={(v) => setScope(v as ConnectorScope)}>
          <SelectTrigger className="w-48">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SCOPES.map((s) => (
              <SelectItem key={s} value={s}>
                {s}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <label className="flex items-center gap-2 text-xs text-muted-foreground">
          <Switch checked={active} onCheckedChange={setActive} /> Active
        </label>
      </div>
      <Input
        placeholder="include tool names (comma separated)"
        value={include}
        onChange={(e) => setInclude(e.target.value)}
      />
      <Input
        placeholder="exclude tool names (comma separated)"
        value={exclude}
        onChange={(e) => setExclude(e.target.value)}
      />
      <Button size="sm" onClick={() => setConfirmOpen(true)}>
        <ShieldCheck className="size-3.5" /> Update activation
      </Button>

      {confirmOpen ? (
        <GlassPanel className="space-y-3 p-4">
          <p className="text-sm font-semibold text-foreground">Confirm activation change</p>
          <p className="text-xs text-muted-foreground">
            Scope <span className="text-foreground">{scope}</span> will be set to{" "}
            <span className="text-foreground">{active ? "active" : "inactive"}</span>.
          </p>
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <p className="eyebrow mb-1">Include</p>
              {includeList.length === 0 ? (
                <p className="text-xs text-muted-foreground">All tools</p>
              ) : (
                <ul className="list-inside list-disc text-xs text-foreground">
                  {includeList.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
            <div>
              <p className="eyebrow mb-1">Exclude</p>
              {excludeList.length === 0 ? (
                <p className="text-xs text-muted-foreground">None</p>
              ) : (
                <ul className="list-inside list-disc text-xs text-foreground">
                  {excludeList.map((t) => (
                    <li key={t}>{t}</li>
                  ))}
                </ul>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" onClick={() => setConfirmOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={() => setActivation.mutate()} disabled={setActivation.isPending}>
              {setActivation.isPending ? <Loader2 className="size-3.5 animate-spin" /> : null}
              Confirm
            </Button>
          </div>
        </GlassPanel>
      ) : null}
    </div>
  );
}

function ConnectorsIdPage() {
  const { id } = Route.useParams();
  const query = useQuery({ queryKey: QK.connector(id), queryFn: () => connectorsApi.get(id) });

  return (
    <div className="px-6 py-8">
      <Button size="sm" variant="ghost" asChild className="mb-4">
        <Link to="/connectors">
          <ArrowLeft className="size-3.5" /> Back to Connectors
        </Link>
      </Button>

      {query.isLoading ? (
        <DetailSkeleton />
      ) : query.isError ? (
        <ErrorState error={query.error} title="Connector not found." onRetry={() => query.refetch()} />
      ) : !query.data ? (
        <EmptyState icon={<Plug className="size-6" />} title="Connector not found." />
      ) : (
        <div className="space-y-6">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight text-foreground">
              {query.data.title ?? query.data.name}
            </h1>
            <p className="mt-2 max-w-2xl text-sm text-muted-foreground">{query.data.description}</p>
          </div>

          <GlassPanel>
            <GlassPanelHeader title="Tools" description="Invoke connector tools and inspect results." />
            <div className="p-4">
              <ToolsSection id={id} />
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader title="Authentication" description="Supported auth methods and OAuth flow." />
            <div className="p-4">
              <AuthenticationSection id={id} />
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader title="Credentials" description="Scoped named credentials." />
            <div className="p-4">
              <CredentialsSection id={id} />
            </div>
          </GlassPanel>

          <GlassPanel>
            <GlassPanelHeader title="Activation" description="Enable or disable this connector and its tools." />
            <div className="p-4">
              <ActivationSection id={id} />
            </div>
          </GlassPanel>
        </div>
      )}
    </div>
  );
}
