import { Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DomainClassificationEditor } from "@/components/ontology/DomainClassificationEditor";

export function AgentClassificationModal({
  agentId,
  agentName,
  open,
  onOpenChange,
}: {
  agentId: string;
  agentName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Tag className="size-4 text-indigo-400" /> Domain Classification
          </DialogTitle>
          <DialogDescription>
            Which business domain <span className="font-mono text-foreground font-semibold">{agentName}</span> serves.
            The planner uses this domain to match agents to tasks.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <DomainClassificationEditor subjectType="agent" subjectId={agentId} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
