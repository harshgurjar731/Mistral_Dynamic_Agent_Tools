import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Sparkles } from "lucide-react";
import { toolsApi, QK, errorMessage } from "@/api";
import { GlassPanel, GlassPanelHeader } from "@/components/glass/GlassPanel";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ErrorState } from "@/components/ui/ErrorState";

export function ToolSynthesizer() {
  const qc = useQueryClient();
  const [task, setTask] = useState("");
  const [failure, setFailure] = useState<unknown>(null);

  const synthesize = useMutation({
    mutationFn: () => toolsApi.synthesize(task),
    onMutate: () => setFailure(null),
    onSuccess: () => {
      toast.success("Tool generated successfully and moved to the Pending Review tab.");
      setTask("");
      qc.invalidateQueries({ queryKey: QK.tools() });
      qc.invalidateQueries({ queryKey: QK.pendingTools() });
    },
    onError: (e) => setFailure(e),
  });

  return (
    <GlassPanel>
      <GlassPanelHeader
        title="Tool Synthesizer"
        description="Describe a capability in plain language and let the platform write the tool."
      />
      <div className="space-y-3 p-4">
        <Textarea
          placeholder="e.g. A function that fetches the weather for a given city."
          value={task}
          onChange={(e) => setTask(e.target.value)}
          rows={4}
          disabled={synthesize.isPending}
        />
        <Button
          className="w-full"
          onClick={() => task.trim() && synthesize.mutate()}
          disabled={synthesize.isPending || !task.trim()}
        >
          {synthesize.isPending ? (
            <span className="flex items-center gap-2">
              <span className="shimmer inline-block h-4 w-24 rounded" />
              Synthesizing… this can take a couple of minutes
            </span>
          ) : (
            <>
              <Sparkles className="size-3.5" /> Synthesize
            </>
          )}
        </Button>
        {failure ? (
          <ErrorState title="Synthesis Failed" error={failure} onRetry={() => synthesize.mutate()} />
        ) : null}
      </div>
    </GlassPanel>
  );
}
