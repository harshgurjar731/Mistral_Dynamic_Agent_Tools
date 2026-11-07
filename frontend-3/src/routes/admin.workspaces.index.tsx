import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import {
  Building2,
  CheckCircle2,
  ChevronRight,
  KeyRound,
  Loader2,
  Plus,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { adminApi, authKeys } from "@/api/auth";
import { errorMessage } from "@/api/client";
import { AdminPage, KeyStatusBadge, PageHeader, WorkerBadge } from "@/components/admin/parts";
import { FormError } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { EmptyState } from "@/components/ui/EmptyState";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { initials } from "@/lib/auth";
import { formatRelative } from "@/lib/status";

export const Route = createFileRoute("/admin/workspaces/")({
  validateSearch: z.object({ create: z.boolean().optional() }),
  head: () => ({ meta: [{ title: "Workspaces — Admin console" }] }),
  component: WorkspacesPage,
});

function WorkspacesPage() {
  const { create } = Route.useSearch();
  const navigate = useNavigate();
  const [open, setOpen] = useState(!!create);
  useEffect(() => setOpen(!!create), [create]);
  const q = useQuery({ queryKey: authKeys.admin.workspaces(), queryFn: adminApi.workspaces });

  return (
    <AdminPage>
      <PageHeader
        title="Workspaces"
        description="A workspace is a team on its own Mistral API key. Everything its members create — agents, conversations, libraries, workflows, traces — lives in that Mistral workspace."
        actions={
          <Button onClick={() => setOpen(true)}>
            <Plus /> New workspace
          </Button>
        }
      />

      {q.isError ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : null}
      {q.isLoading ? (
        <div className="grid gap-4 md:grid-cols-2">
          {[0, 1].map((i) => (
            <Skeleton key={i} className="h-40 rounded-lg" />
          ))}
        </div>
      ) : q.data && !q.data.workspaces.length ? (
        <EmptyState
          icon={<Building2 className="size-6" />}
          title="No workspaces yet"
          description="Create the first one with a Mistral API key."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {q.data?.workspaces.map((w) => (
            <Link
              key={w.id}
              to="/admin/workspaces/$id"
              params={{ id: w.id }}
              className="glass group rounded-lg p-5 transition hover:border-border-strong"
            >
              <div className="flex items-start gap-3">
                <span className="grid size-10 shrink-0 place-items-center rounded-md bg-secondary text-sm font-bold">
                  {initials(w.name)}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-[15px] font-semibold text-foreground">{w.name}</h2>
                    {w.is_default ? (
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-2 py-0.5 text-[10px] font-semibold text-primary">
                        Default
                      </span>
                    ) : null}
                    {w.disabled ? (
                      <span className="rounded-full border border-border bg-secondary px-2 py-0.5 text-[10px] font-medium text-muted-foreground">
                        Disabled
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {w.description || "No description."}
                  </p>
                </div>
                <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
              </div>
              <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border pt-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5">
                  <KeyRound className="size-3.5" />
                  <span className="font-mono">
                    {w.key_source === "platform" ? "platform key" : w.key_hint}
                  </span>
                </span>
                <KeyStatusBadge status={w.key_status} />
                <WorkerBadge worker={w.worker} />
                <span>
                  {w.members} member{w.members === 1 ? "" : "s"}
                </span>
                <span className="ml-auto">checked {formatRelative(w.key_checked_at)}</span>
              </div>
            </Link>
          ))}
        </div>
      )}

      <CreateWorkspaceDialog
        open={open}
        onOpenChange={(v) => {
          setOpen(v);
          if (!v && create) void navigate({ to: "/admin/workspaces", search: {}, replace: true });
        }}
      />
    </AdminPage>
  );
}

function CreateWorkspaceDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setName("");
      setDescription("");
      setApiKey("");
      setError(null);
      setTested(null);
    }
  }, [open]);

  const test = useMutation({
    mutationFn: () => adminApi.checkKey(apiKey.trim()),
    onSuccess: (r) => {
      setTested(r.message);
      setError(null);
    },
    onError: (e) => {
      setTested(null);
      setError(errorMessage(e));
    },
  });
  const create = useMutation({
    mutationFn: () =>
      adminApi.createWorkspace({ name: name.trim(), api_key: apiKey.trim(), description }),
    onSuccess: (w) => {
      toast.success(`Workspace “${w.name}” created`);
      void qc.invalidateQueries({ queryKey: authKeys.admin.workspaces() });
      void qc.invalidateQueries({ queryKey: authKeys.admin.overview() });
      onOpenChange(false);
      void navigate({ to: "/admin/workspaces/$id", params: { id: w.id } });
    },
    onError: (e) => setError(errorMessage(e)),
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    create.mutate();
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>New workspace</DialogTitle>
          <DialogDescription>
            The key is checked with Mistral before anything is saved, then stored encrypted. Only
            its last four characters are ever shown again.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <FormError message={error} />
          <div className="space-y-1.5">
            <Label htmlFor="ws-name" className="text-xs">
              Name
            </Label>
            <Input
              id="ws-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Lending team"
              maxLength={80}
              autoFocus
              required
            />
            <p className="text-[11px] text-muted-foreground">
              Your name for it here. It doesn't have to match the Mistral workspace's name.
            </p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-desc" className="text-xs">
              Description <span className="text-muted-foreground">(optional)</span>
            </Label>
            <Textarea
              id="ws-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              maxLength={500}
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ws-key" className="text-xs">
              Mistral API key
            </Label>
            <div className="flex gap-2">
              <Input
                id="ws-key"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={apiKey}
                onChange={(e) => {
                  setApiKey(e.target.value);
                  setTested(null);
                }}
                placeholder="Paste the key from console.mistral.ai"
                className="font-mono"
                required
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => test.mutate()}
                disabled={!apiKey.trim() || test.isPending}
              >
                {test.isPending ? <Loader2 className="animate-spin" /> : <ShieldCheck />}
                Test
              </Button>
            </div>
            {tested ? (
              <p className="flex items-center gap-1.5 text-xs text-emerald">
                <CheckCircle2 className="size-3.5" /> {tested}
              </p>
            ) : (
              <p className="text-[11px] text-muted-foreground">
                Create it in the Mistral workspace this team should use (Admin → API keys).
              </p>
            )}
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !apiKey.trim() || create.isPending}>
              {create.isPending ? <Loader2 className="animate-spin" /> : null}
              Verify and create
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
