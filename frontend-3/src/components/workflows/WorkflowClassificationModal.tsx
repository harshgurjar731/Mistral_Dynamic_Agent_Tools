import { Tag } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DomainClassificationEditor } from "@/components/ontology/DomainClassificationEditor";

export function WorkflowClassificationModal({
  workflowName,
  open,
  onOpenChange,
}: {
  workflowName: string;
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
            Which business domain <span className="font-mono text-foreground font-semibold">{workflowName}</span> serves.
            New workflows are classified automatically — correct it here if that guess was wrong.
          </DialogDescription>
        </DialogHeader>
        <div className="py-2">
          <DomainClassificationEditor subjectType="workflow" subjectId={workflowName} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
