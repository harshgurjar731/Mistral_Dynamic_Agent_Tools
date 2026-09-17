import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Library as LibraryIcon, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { errorMessage, librariesApi, QK } from "@/api";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Library } from "@/types";

/** Create a library, or edit an existing one when `library` is given. */
export function LibraryFormDialog({
  open,
  onOpenChange,
  library,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  library?: Library | null;
  onCreated?: (library: Library) => void;
}) {
  const qc = useQueryClient();
  const editing = Boolean(library);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(library?.name ?? "");
    setDescription(library?.description ?? "");
  }, [open, library]);

  const submit = useMutation({
    mutationFn: () =>
      library
        ? librariesApi.update(library.id, { name, description })
        : librariesApi.create({ name, description }),
    onSuccess: (lib) => {
      toast.success(editing ? "Library updated." : "Library created.");
      void qc.invalidateQueries({ queryKey: QK.libraries() });
      onOpenChange(false);
      if (!editing && lib?.id) onCreated?.(lib);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editing ? "Edit library" : "New library"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label className="eyebrow mb-1.5 block">Name</label>
            <Input
              value={name}
              placeholder="EU regulation"
              onChange={(e) => setName(e.target.value)}
            />
          </div>
          <div>
            <label className="eyebrow mb-1.5 block">Description</label>
            <Textarea
              rows={3}
              value={description}
              placeholder="What this library holds and who should use it."
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={() => submit.mutate()} disabled={!name.trim() || submit.isPending}>
            {submit.isPending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <LibraryIcon className="size-4" />
            )}
            {editing ? "Save changes" : "Create"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
