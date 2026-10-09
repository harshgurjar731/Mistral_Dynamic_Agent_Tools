import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2, Trash2 } from "lucide-react";
import { QK, errorMessage } from "@/api";
import { remoteServersApi, type RemoteServer, type RemoteWorkflow } from "@/api/remoteServers";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Confirm deleting a deployed workflow package from the server. The deletion
 * runs as a logged command; `onStarted` gets its deployment id to follow.
 */
export function DeleteRemoteWorkflowDialog({
  server,
  workflow,
  open,
  onOpenChange,
  onStarted,
}: {
  server: RemoteServer;
  workflow: RemoteWorkflow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onStarted: (deploymentId: number) => void;
}) {
  const qc = useQueryClient();
  const [confirm, setConfirm] = useState("");
  const [stopContainers, setStopContainers] = useState(true);
  const [removeVolumes, setRemoveVolumes] = useState(false);
  const [removeImages, setRemoveImages] = useState(true);

  const del = useMutation({
    mutationFn: () =>
      remoteServersApi.deleteWorkflow(server.id, {
        workflow: workflow.name,
        confirm,
        stop_containers: stopContainers,
        remove_volumes: stopContainers && removeVolumes,
        remove_images: stopContainers && removeImages,
      }),
    onSuccess: (dep) => {
      toast.success(`Deleting "${workflow.name}" from ${server.name}…`);
      qc.invalidateQueries({ queryKey: QK.remoteServerDeployments(String(server.id)) });
      onStarted(dep.id);
      onOpenChange(false);
      setConfirm("");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const running = workflow.containers.filter((c) => c.status.startsWith("Up")).length;
  const options = [
    {
      checked: stopContainers,
      set: setStopContainers,
      label: "Stop and remove its containers",
      hint:
        running > 0
          ? `${running} running — without this they keep running with no files left to manage them`
          : "docker compose down",
      disabled: false,
    },
    {
      checked: stopContainers && removeImages,
      set: setRemoveImages,
      label: "Remove its built images",
      hint: "Frees disk space; a redeploy rebuilds them",
      disabled: !stopContainers,
    },
    {
      checked: stopContainers && removeVolumes,
      set: setRemoveVolumes,
      label: "Delete its data volumes",
      hint: "Neo4j graph and tool-service data — cannot be undone",
      disabled: !stopContainers,
    },
  ];

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (!o) setConfirm("");
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            Delete “{workflow.name}” from {server.name}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            Removes the package directory — code, .env and anything stored under it — from{" "}
            <span className="font-mono">
              {String(server.config["deploy_path"] ?? "~/workflow-deployments")}
            </span>
            . The workflow in this app is not affected.
          </AlertDialogDescription>
        </AlertDialogHeader>

        <div className="space-y-2">
          {options.map((o) => (
            <label
              key={o.label}
              className={`flex items-start gap-2 ${o.disabled ? "opacity-50" : "cursor-pointer"}`}
            >
              <Checkbox
                checked={o.checked}
                disabled={o.disabled}
                onCheckedChange={(v) => o.set(v === true)}
                className="mt-0.5"
              />
              <span>
                <span className="block text-xs text-foreground">{o.label}</span>
                <span className="block text-[11px] text-muted-foreground">{o.hint}</span>
              </span>
            </label>
          ))}
        </div>

        <div className="space-y-1.5">
          <p className="text-xs text-muted-foreground">
            Type <span className="font-mono text-foreground">{workflow.name}</span> to confirm
          </p>
          <Input
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
            className="font-mono text-xs"
            autoComplete="off"
            spellCheck={false}
          />
        </div>

        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <Button
            variant="destructive"
            onClick={() => del.mutate()}
            disabled={confirm.trim() !== workflow.name || del.isPending}
          >
            {del.isPending ? (
              <Loader2 className="size-3.5 animate-spin" />
            ) : (
              <Trash2 className="size-3.5" />
            )}
            Delete from server
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
