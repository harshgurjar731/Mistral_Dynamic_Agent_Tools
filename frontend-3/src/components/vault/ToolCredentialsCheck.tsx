/**
 * The credentials a hand-picked set of tools will read, and whether each one
 * reaches them — for forms that attach tools directly (Create agent in the
 * workflow builder, an agent's Tools Equipped), where no build runs the
 * prerequisite check. A missing one can be added to the vault in place.
 */
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckCircle2, KeyRound, ServerCog, TriangleAlert } from "lucide-react";
import { get } from "@/api/client";
import { QK } from "@/api";
import { VaultSecretDialog } from "@/components/vault/VaultSecretDialog";
import { cn } from "@/lib/utils";

interface ToolRequirements {
  tools: Array<{
    tool: string;
    known: boolean;
    secrets: Array<{
      name: string;
      source: "vault" | "environment" | null;
      reason: string | null;
      id: string | null;
      label: string | null;
    }>;
  }>;
  missing: number;
}

const REASON: Record<string, string> = {
  expired: "expired in the vault",
  disabled: "switched off in the vault",
  denied: "this tool is not in its allowed tools",
  vault_off: "the vault is off",
};

export function ToolCredentialsCheck({
  tools,
  className,
}: {
  tools: string[];
  className?: string;
}) {
  const qc = useQueryClient();
  const key = [...tools].sort().join(",");
  const [adding, setAdding] = useState<string | null>(null);
  const q = useQuery({
    queryKey: [...QK.vault(), "tool-requirements", key],
    queryFn: () => get<ToolRequirements>("/api/vault/tool-requirements", { tools: key }),
    enabled: tools.length > 0,
    staleTime: 15_000,
  });

  const rows = (q.data?.tools ?? []).filter((t) => t.secrets.length > 0);
  if (!tools.length || !rows.length) return null;
  const missing = q.data?.missing ?? 0;

  return (
    <div
      className={cn(
        "rounded-lg border p-3 text-[11px]",
        missing ? "border-amber/40 bg-amber/5" : "border-emerald/30 bg-emerald/5",
        className,
      )}
    >
      <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
        {missing ? (
          <TriangleAlert className="size-3.5 text-amber" />
        ) : (
          <CheckCircle2 className="size-3.5 text-emerald" />
        )}
        {missing
          ? `${missing} credential(s) these tools need are not available`
          : "Every credential these tools need is available"}
      </p>
      <ul className="space-y-1">
        {rows.flatMap((t) =>
          t.secrets.map((s) => (
            <li key={`${t.tool}:${s.name}`} className="flex flex-wrap items-center gap-x-2">
              <code className="font-mono text-foreground">{s.name}</code>
              <span className="text-muted-foreground">for {t.tool}</span>
              {s.source === "vault" ? (
                <span className="flex items-center gap-1 text-emerald">
                  <KeyRound className="size-3" /> vault
                </span>
              ) : s.source === "environment" ? (
                <span className="flex items-center gap-1 text-emerald">
                  <ServerCog className="size-3" /> Tool Service environment
                </span>
              ) : (
                <>
                  <span className="text-amber">
                    {REASON[s.reason ?? ""] ?? "not in the vault"} — the tool will report a
                    configuration error
                  </span>
                  {s.id ? null : (
                    <button
                      type="button"
                      onClick={() => setAdding(s.name)}
                      className="text-primary hover:underline"
                    >
                      Add to the vault
                    </button>
                  )}
                </>
              )}
            </li>
          )),
        )}
      </ul>
      <VaultSecretDialog
        open={adding !== null}
        onOpenChange={(o) => !o && setAdding(null)}
        preset={adding ? { name: adding } : undefined}
        onSaved={() => void qc.invalidateQueries({ queryKey: QK.vault() })}
      />
    </div>
  );
}
