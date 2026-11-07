import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { AlertTriangle, ArrowLeft, Copy, Loader2, Lock, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { z } from "zod";
import { adminApi, authKeys, type PermissionDef } from "@/api/auth";
import { errorMessage } from "@/api/client";
import { AdminPage, Confirm, PageHeader, Panel } from "@/components/admin/parts";
import { FormError } from "@/components/auth/AuthParts";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { ErrorState } from "@/components/ui/ErrorState";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/admin/roles/$id")({
  validateSearch: z.object({ from: z.string().optional() }),
  head: () => ({ meta: [{ title: "Role — Admin console" }] }),
  component: RoleEditorPage,
});

function RoleEditorPage() {
  const { id } = Route.useParams();
  const { from } = Route.useSearch();
  const isNew = id === "new";
  const qc = useQueryClient();
  const navigate = useNavigate();

  const perms = useQuery({ queryKey: authKeys.admin.permissions(), queryFn: adminApi.permissions });
  const roles = useQuery({ queryKey: authKeys.admin.roles(), queryFn: adminApi.roles });
  const sourceId = isNew ? from : id;
  const role = useQuery({
    queryKey: authKeys.admin.role(sourceId ?? "none"),
    queryFn: () => adminApi.role(sourceId!),
    enabled: !!sourceId,
  });

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [reassign, setReassign] = useState<string>("");

  useEffect(() => {
    if (role.data) {
      setName(isNew ? `${role.data.name} (copy)` : role.data.name);
      setDescription(role.data.description);
      setSelected(new Set(role.data.permissions));
    } else if (isNew && !from) {
      setName("");
      setDescription("");
      setSelected(new Set());
    }
  }, [role.data, isNew, from]);

  const readOnly = !isNew && !!role.data?.system;
  const groups = useMemo(() => {
    const out = new Map<string, PermissionDef[]>();
    for (const p of perms.data?.permissions ?? []) {
      out.set(p.group, [...(out.get(p.group) ?? []), p]);
    }
    return [...out.entries()];
  }, [perms.data]);

  const invalidate = () => {
    void qc.invalidateQueries({ queryKey: authKeys.admin.roles() });
    void qc.invalidateQueries({ queryKey: ["admin", "roles"] });
  };

  const save = useMutation({
    mutationFn: () =>
      isNew
        ? adminApi.createRole({ name: name.trim(), description, permissions: [...selected] })
        : adminApi.updateRole(id, { name: name.trim(), description, permissions: [...selected] }),
    onSuccess: (r) => {
      toast.success(
        isNew ? `Role “${r.name}” created` : "Role saved — members get it on their next request",
      );
      invalidate();
      if (isNew)
        void navigate({ to: "/admin/roles/$id", params: { id: r.id }, search: {}, replace: true });
    },
    onError: (e) => setError(errorMessage(e)),
  });
  const remove = useMutation({
    mutationFn: () => adminApi.deleteRole(id, reassign || undefined),
    onSuccess: () => {
      toast.success("Role deleted");
      invalidate();
      void navigate({ to: "/admin/roles" });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const toggle = (key: string, on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      if (on) n.add(key);
      else n.delete(key);
      return n;
    });
  const toggleGroup = (items: PermissionDef[], on: boolean) =>
    setSelected((s) => {
      const n = new Set(s);
      items.forEach((p) => (on ? n.add(p.key) : n.delete(p.key)));
      return n;
    });

  if (role.isError || perms.isError)
    return (
      <AdminPage>
        <ErrorState error={role.error ?? perms.error} />
      </AdminPage>
    );
  const loading = perms.isLoading || (!!sourceId && role.isLoading);
  const members = role.data && !isNew ? role.data.members : 0;
  const others = (roles.data?.roles ?? []).filter((r) => r.id !== id);

  return (
    <AdminPage>
      <PageHeader
        back={
          <Link
            to="/admin/roles"
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
          >
            <ArrowLeft className="size-3.5" /> Roles
          </Link>
        }
        title={
          isNew ? (
            "New role"
          ) : role.data ? (
            <span className="flex items-center gap-2.5">
              {role.data.name}
              {role.data.system ? (
                <span className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  <Lock className="size-3" /> Built-in
                </span>
              ) : null}
            </span>
          ) : (
            <Skeleton className="h-8 w-48" />
          )
        }
        description={
          readOnly
            ? "Built-in roles keep the platform predictable, so they can't be edited. Duplicate it to make a custom role."
            : isNew
              ? "Choose exactly what members with this role may do in their workspace."
              : `${members} membership${members === 1 ? "" : "s"} use this role. Changes apply on their next request.`
        }
        actions={
          !isNew && role.data ? (
            <>
              <Link
                to="/admin/roles/$id"
                params={{ id: "new" }}
                search={{ from: role.data.id }}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-background-elevated px-3 text-sm font-medium transition hover:bg-surface-hover"
              >
                <Copy className="size-4" /> Duplicate
              </Link>
              {!role.data.system ? (
                <Button variant="destructive" onClick={() => setDeleteOpen(true)}>
                  <Trash2 /> Delete
                </Button>
              ) : null}
            </>
          ) : null
        }
      />

      {loading ? (
        <Skeleton className="h-96 rounded-lg" />
      ) : (
        <form
          className="space-y-6"
          onSubmit={(e) => {
            e.preventDefault();
            setError(null);
            save.mutate();
          }}
        >
          <FormError message={error} />
          <Panel>
            <div className="grid gap-4 md:grid-cols-[1fr_2fr]">
              <div className="space-y-1.5">
                <Label className="text-xs">Name</Label>
                <Input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  maxLength={60}
                  disabled={readOnly}
                  required
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs">Description</Label>
                <Textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  maxLength={500}
                  disabled={readOnly}
                  placeholder="Who should get this role, and why"
                />
              </div>
            </div>
          </Panel>

          <div className="grid gap-4 lg:grid-cols-2">
            {groups.map(([group, items]) => {
              const on = items.filter((p) => selected.has(p.key)).length;
              return (
                <Panel
                  key={group}
                  title={group}
                  actions={
                    !readOnly ? (
                      <button
                        type="button"
                        className="text-xs text-primary hover:underline"
                        onClick={() => toggleGroup(items, on !== items.length)}
                      >
                        {on === items.length ? "Clear" : "Select all"}
                      </button>
                    ) : (
                      <span className="text-xs text-muted-foreground">
                        {on}/{items.length}
                      </span>
                    )
                  }
                >
                  <ul className="space-y-3">
                    {items.map((p) => (
                      <li key={p.key}>
                        <label
                          className={cn(
                            "flex cursor-pointer gap-3 rounded-md p-1.5 -m-1.5 transition",
                            !readOnly && "hover:bg-surface-hover",
                            readOnly && "cursor-default",
                          )}
                        >
                          <Checkbox
                            checked={selected.has(p.key)}
                            onCheckedChange={(v) => toggle(p.key, v === true)}
                            disabled={readOnly}
                            className="mt-0.5"
                          />
                          <span className="min-w-0">
                            <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-foreground">
                              {p.label}
                              <code className="font-mono text-[10px] font-normal text-muted-foreground">
                                {p.key}
                              </code>
                            </span>
                            <span className="mt-0.5 block text-xs text-muted-foreground">
                              {p.description}
                            </span>
                            {p.shared && p.key.endsWith(".manage") ? (
                              <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-amber">
                                <AlertTriangle className="size-3" /> Shared by every workspace
                              </span>
                            ) : null}
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                </Panel>
              );
            })}
          </div>

          {!readOnly ? (
            <div className="sticky bottom-0 -mx-4 flex items-center justify-between gap-3 border-t border-border bg-background/90 px-4 py-3 backdrop-blur-xl sm:mx-0 sm:rounded-lg sm:border">
              <span className="text-sm text-muted-foreground">
                {selected.size} permission{selected.size === 1 ? "" : "s"} selected
              </span>
              <Button type="submit" disabled={!name.trim() || !selected.size || save.isPending}>
                {save.isPending ? <Loader2 className="animate-spin" /> : null}
                {isNew ? "Create role" : "Save role"}
              </Button>
            </div>
          ) : null}
        </form>
      )}

      <Confirm
        open={deleteOpen}
        onOpenChange={setDeleteOpen}
        title={`Delete ${role.data?.name ?? "role"}?`}
        description={
          members
            ? `${members} membership${members === 1 ? "" : "s"} use this role. Choose the role they move to.`
            : "No one uses this role."
        }
        confirmLabel="Delete role"
        destructive
        busy={remove.isPending}
        onConfirm={() => remove.mutate()}
      >
        {members ? (
          <Select value={reassign} onValueChange={setReassign}>
            <SelectTrigger>
              <SelectValue placeholder="Move members to…" />
            </SelectTrigger>
            <SelectContent>
              {others.map((r) => (
                <SelectItem key={r.id} value={r.id}>
                  {r.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : null}
      </Confirm>
    </AdminPage>
  );
}
