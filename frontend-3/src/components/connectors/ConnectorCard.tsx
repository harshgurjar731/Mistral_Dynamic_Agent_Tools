import { Link } from "@tanstack/react-router";
import { Trash2, Plug } from "lucide-react";
import type { Connector } from "@/types";
import { Button } from "@/components/ui/button";
import { GlassPanel } from "@/components/glass/GlassPanel";
import { StatusPill } from "@/components/ui/StatusPill";

const VISIBILITY_LABEL: Record<string, string> = {
  shared_org: "Organisation",
  shared_workspace: "Workspace",
  private: "Private",
  shared_global: "Global directory",
};

export function ConnectorCard({
  connector,
  onDelete,
}: {
  connector: Connector;
  onDelete: () => void;
}) {
  return (
    <GlassPanel className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
        {connector.icon_url ? (
          <img src={connector.icon_url} alt="" className="size-9 rounded-lg border border-border" />
        ) : (
          <div className="flex size-9 items-center justify-center rounded-lg border border-border bg-muted/30">
            <Plug className="size-4 text-muted-foreground" />
          </div>
        )}
        <div className="min-w-0 flex-1">
          <Link
            to="/connectors/$id"
            params={{ id: connector.id }}
            className="truncate text-sm font-semibold text-foreground hover:text-primary"
          >
            {connector.title ?? connector.name}
          </Link>
          <p className="line-clamp-2 text-xs text-muted-foreground">{connector.description}</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          {connector.protocol}
        </span>
        <span className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px] text-muted-foreground">
          {VISIBILITY_LABEL[connector.visibility] ?? connector.visibility}
        </span>
        {connector.is_directory ? (
          <span className="rounded-full border border-blue/30 bg-blue/10 px-2 py-0.5 text-[10px] text-blue">
            Directory
          </span>
        ) : null}
        <StatusPill
          identity={
            connector.is_authenticated
              ? { label: "Authenticated", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30" }
              : { label: "Not authenticated", text: "text-amber", bg: "bg-amber/10", border: "border-amber/30" }
          }
        />
        <StatusPill
          identity={
            connector.active
              ? { label: "Active", text: "text-emerald", bg: "bg-emerald/10", border: "border-emerald/30", pulse: true }
              : { label: "Inactive", text: "text-slate", bg: "bg-slate/10", border: "border-slate/30" }
          }
        />
      </div>
      <div className="mt-auto flex items-center justify-between pt-1">
        <span className="text-xs text-muted-foreground">{connector.tool_count ?? 0} tools</span>
        {!connector.is_directory ? (
          <Button size="sm" variant="ghost" className="text-red hover:text-red" onClick={onDelete}>
            <Trash2 className="size-3.5" /> Delete
          </Button>
        ) : null}
      </div>
    </GlassPanel>
  );
}
