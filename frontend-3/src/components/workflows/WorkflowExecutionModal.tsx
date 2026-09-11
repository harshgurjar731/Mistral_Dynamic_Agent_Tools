import { useState, useEffect, useRef } from "react";
import {
  AlertCircle,
  Bot,
  CheckCircle2,
  Clock,
  ImagePlus,
  Loader2,
  Play,
  Send,
  User,
  X,
} from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { workflowsApi, executionsApi, QK, errorMessage } from "@/api";
import type { WorkflowDefinition } from "@/types";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/chat/Markdown";
import { formatDuration } from "@/lib/status";
import { cn } from "@/lib/utils";

interface StepResult {
  step_id: string;
  status: string;
  duration_ms?: number;
  error?: string;
}

interface ExecutionData {
  execution_id: string;
  status: string;
  result?: unknown;
  step_results?: StepResult[];
}

export function WorkflowExecutionModal({
  workflowName,
  open,
  onOpenChange,
}: {
  workflowName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [inputValues, setInputValues] = useState<Record<string, string>>({});
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string; imagePreview?: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null);
  const [pendingImage, setPendingImage] = useState<{ file: File; previewUrl: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const wfQuery = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
    enabled: open && Boolean(workflowName),
  });

  const workflow: WorkflowDefinition | undefined = wfQuery.data;

  // Initialize input fields
  useEffect(() => {
    if (workflow?.input_schema) {
      const initial: Record<string, string> = {};
      for (const field of workflow.input_schema) {
        initial[field.name] = "";
      }
      setInputValues(initial);
    }
  }, [workflow]);

  // Load chat history from localStorage if any
  useEffect(() => {
    if (open && workflowName) {
      const saved = localStorage.getItem(`workflow_chat_${workflowName}`);
      if (saved) {
        try {
          const parsed = JSON.parse(saved);
          if (Array.isArray(parsed.messages)) setMessages(parsed.messages);
          if (parsed.executionData) setExecutionData(parsed.executionData);
        } catch {
          // ignore
        }
      }
    }
  }, [open, workflowName]);

  // Save chat history
  useEffect(() => {
    if (workflowName && messages.length > 0) {
      localStorage.setItem(
        `workflow_chat_${workflowName}`,
        JSON.stringify({ messages, executionData }),
      );
    }
  }, [workflowName, messages, executionData]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, executionData]);

  const runMut = useMutation({
    mutationFn: async () => {
      let imageBase64: string | undefined;
      let imageMime: string | undefined;

      if (pendingImage) {
        const uploadRes = await workflowsApi.uploadImage(pendingImage.file);
        imageBase64 = uploadRes.image_base64;
        imageMime = uploadRes.image_mime;
      }

      const payload: Record<string, unknown> = { ...inputValues };
      if (imageBase64 && imageMime) {
        payload["_image"] = { image_base64: imageBase64, image_mime: imageMime };
      }

      return workflowsApi.execute(workflowName, {
        input: payload,
        wait_for_result: true,
        timeout_seconds: 120,
      });
    },
    onSuccess: (res: Record<string, unknown>) => {
      const execId = String(res["execution_id"] ?? "");
      const resOutput = res["result"] ?? res["output"] ?? res;
      const formatted =
        typeof resOutput === "string" ? resOutput : JSON.stringify(resOutput, null, 2);

      setExecutionData({
        execution_id: execId,
        status: String(res["status"] ?? "COMPLETED"),
        result: resOutput,
        step_results: (res["step_results"] as StepResult[]) ?? [],
      });

      setMessages((prev) => [
        ...prev,
        {
          role: "user",
          content: Object.entries(inputValues)
            .map(([k, v]) => `**${k}**: ${v}`)
            .join("\n"),
          ...(pendingImage?.previewUrl ? { imagePreview: pendingImage.previewUrl } : {}),
        },
        {
          role: "assistant",
          content: formatted,
        },
      ]);

      setPendingImage(null);
      toast.success("Execution completed.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const sendSignalMut = useMutation({
    mutationFn: async () => {
      if (!executionData?.execution_id || !chatInput.trim()) return;
      return executionsApi.signal(executionData.execution_id, {
        name: "user_message",
        input: { message: chatInput.trim() },
      });
    },
    onSuccess: () => {
      setMessages((prev) => [...prev, { role: "user", content: chatInput.trim() }]);
      setChatInput("");
      toast.success("Message sent to execution.");
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setPendingImage({ file, previewUrl: URL.createObjectURL(file) });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b border-border bg-background-elevated">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Play className="size-4 text-emerald" /> Run {workflowName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {/* Input schema fields */}
          {workflow?.input_schema && workflow.input_schema.length > 0 && (
            <div className="space-y-3 rounded-xl border border-border bg-background-elevated/50 p-4">
              <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                Workflow Inputs
              </h3>
              <div className="grid gap-3 sm:grid-cols-2">
                {workflow.input_schema.map((f) => (
                  <div key={f.name} className="space-y-1">
                    <label className="text-xs font-medium text-foreground">{f.name}</label>
                    <Input
                      placeholder={f.description || f.name}
                      value={inputValues[f.name] ?? ""}
                      onChange={(e) =>
                        setInputValues((prev) => ({ ...prev, [f.name]: e.target.value }))
                      }
                      className="h-8 text-xs"
                    />
                  </div>
                ))}
              </div>

              {/* Image attachment */}
              <div className="flex items-center gap-2 pt-1">
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleImageSelect}
                  accept="image/*"
                  className="hidden"
                />
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => fileInputRef.current?.click()}
                  className="h-7 text-xs gap-1.5"
                >
                  <ImagePlus className="size-3.5" />
                  {pendingImage ? "Change image" : "Attach image"}
                </Button>
                {pendingImage && (
                  <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                    <img
                      src={pendingImage.previewUrl}
                      alt="preview"
                      className="size-6 rounded object-cover"
                    />
                    <button
                      type="button"
                      onClick={() => setPendingImage(null)}
                      className="text-muted-foreground hover:text-red"
                    >
                      <X className="size-3" />
                    </button>
                  </div>
                )}
                <Button
                  size="sm"
                  disabled={runMut.isPending}
                  onClick={() => runMut.mutate()}
                  className="ml-auto h-7 text-xs gap-1.5 bg-emerald hover:bg-emerald/90 text-black font-semibold"
                >
                  {runMut.isPending ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <Play className="size-3.5" />
                  )}
                  Execute
                </Button>
              </div>
            </div>
          )}

          {/* Step results timeline if available */}
          {executionData?.step_results && executionData.step_results.length > 0 && (
            <div className="rounded-xl border border-border bg-background-elevated/40 p-3 space-y-1.5">
              <p className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Step Execution Timeline
              </p>
              <div className="space-y-1">
                {executionData.step_results.map((st) => (
                  <div
                    key={st.step_id}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded bg-surface-hover/60"
                  >
                    <div className="flex items-center gap-2">
                      {st.status === "COMPLETED" ? (
                        <CheckCircle2 className="size-3.5 text-emerald" />
                      ) : (
                        <AlertCircle className="size-3.5 text-red" />
                      )}
                      <span className="font-mono text-foreground">{st.step_id}</span>
                    </div>
                    {st.duration_ms && (
                      <span className="text-[11px] text-muted-foreground font-mono">
                        {formatDuration(st.duration_ms)}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Chat Messages */}
          <div className="space-y-3 pt-2">
            {messages.map((m, i) => (
              <div
                key={i}
                className={cn(
                  "flex gap-2.5 rounded-xl p-3.5 text-xs",
                  m.role === "user"
                    ? "bg-primary/10 border border-primary/20 text-foreground ml-6"
                    : "bg-background-elevated border border-border text-foreground mr-6",
                )}
              >
                <div className="shrink-0 mt-0.5">
                  {m.role === "user" ? (
                    <User className="size-4 text-primary" />
                  ) : (
                    <Bot className="size-4 text-emerald" />
                  )}
                </div>
                <div className="min-w-0 flex-1 space-y-2">
                  {m.imagePreview && (
                    <img
                      src={m.imagePreview}
                      alt="attachment"
                      className="max-h-40 rounded-lg object-contain border border-border"
                    />
                  )}
                  <Markdown content={m.content} />
                </div>
              </div>
            ))}
            <div ref={endRef} />
          </div>
        </div>

        {/* Continuation bar if execution is active */}
        {executionData && (
          <div className="p-3 border-t border-border bg-background-elevated flex items-center gap-2">
            <Input
              placeholder="Send message or signal to this execution…"
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  sendSignalMut.mutate();
                }
              }}
              className="h-8 text-xs"
            />
            <Button
              size="sm"
              disabled={!chatInput.trim() || sendSignalMut.isPending}
              onClick={() => sendSignalMut.mutate()}
              className="h-8 px-3"
            >
              <Send className="size-3.5" />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
