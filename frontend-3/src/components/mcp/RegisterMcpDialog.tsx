import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileText, Globe, Info, Loader2, Plus } from "lucide-react";
import { errorMessage, mcpApi, QK } from "@/api";
import { SectionCard } from "@/components/shared/SectionCard";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

/** Register an MCP server: the Tool Service handshakes with it and discovers its tools. */
export function RegisterMcpDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  const [description, setDescription] = useState("");

  const create = useMutation({
    mutationFn: () => mcpApi.addServer({ name: name.trim(), url: url.trim(), description }),
    onSuccess: () => {
      toast.success(`Registered "${name.trim()}".`);
      setName("");
      setUrl("");
      setDescription("");
      onOpenChange(false);
      qc.invalidateQueries({ queryKey: QK.mcpServers() });
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const validUrl = /^https?:\/\/\S+$/.test(url.trim());

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="custom-scrollbar max-h-[88vh] max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Register an MCP server</DialogTitle>
          <DialogDescription>
            The server is contacted right away: an initialize handshake, then tool discovery.
          </DialogDescription>
        </DialogHeader>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (name.trim() && validUrl) create.mutate();
          }}
        >
          <SectionCard icon={FileText} title="Basics" bodyClassName="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                Name<span className="text-red"> *</span>
              </Label>
              <Input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="github-mcp"
                autoFocus
              />
              <p className="text-[11px] text-muted-foreground">
                Used in tool references, so keep it short and without spaces.
              </p>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs">Description</Label>
              <Textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="What does this server provide?"
                rows={2}
              />
            </div>
          </SectionCard>

          <SectionCard icon={Globe} title="Endpoint" bodyClassName="space-y-3">
            <div className="space-y-1.5">
              <Label className="text-xs">
                URL<span className="text-red"> *</span>
              </Label>
              <Input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://mcp.example.com/mcp"
                className="font-mono text-xs"
              />
              {url && !validUrl ? (
                <p className="text-[11px] text-red">Must be an http:// or https:// URL.</p>
              ) : null}
            </div>
            <div className="flex gap-2 rounded-xl border border-blue/20 bg-blue/5 p-3 text-[11px] text-muted-foreground">
              <Info className="mt-0.5 size-3.5 shrink-0 text-blue" />
              The Tool Service runs in Docker, so use an address reachable from inside its container
              (e.g. a sibling container name, or host.docker.internal).
            </div>
          </SectionCard>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={!name.trim() || !validUrl || create.isPending}>
              {create.isPending ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Plus className="size-3.5" />
              )}
              {create.isPending ? "Registering…" : "Register server"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
