import { useState, useEffect, useRef } from "react";
import { Bot, Play, Send, User } from "lucide-react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { workflowsApi, executionsApi, QK, errorMessage } from "@/api";
import type { DocumentRef, WorkflowDefinition } from "@/types";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Markdown } from "@/components/chat/Markdown";
import { ExecutionStepTimeline } from "./ExecutionStepTimeline";
import { rememberRunInput } from "./runForm/fieldModel";
import { WorkflowRunForm } from "./runForm/WorkflowRunForm";
import { useWorkflowPrerequisites, WorkflowPrerequisites } from "./WorkflowPrerequisites";
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

/** How one run input reads in the chat transcript — a document by its name. */
function describeInput(value: unknown): string {
  const items: unknown[] = Array.isArray(value) ? value : [value];
  const docs = items.filter((v): v is DocumentRef =>
    Boolean(v && typeof v === "object" && "$document" in v),
  );
  if (docs.length) return docs.map((d) => `${d.$document.name} (document)`).join(", ");
  return typeof value === "string" ? value : JSON.stringify(value);
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
  const [messages, setMessages] = useState<
    Array<{ role: "user" | "assistant"; content: string; imagePreview?: string }>
  >([]);
  const [chatInput, setChatInput] = useState("");
  const [executionData, setExecutionData] = useState<ExecutionData | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const wfQuery = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
    enabled: open && Boolean(workflowName),
  });

  const workflow: WorkflowDefinition | undefined = wfQuery.data;
  // The backend refuses a run while a blocking prerequisite is unmet.
  const prereq = useWorkflowPrerequisites(open ? workflowName : null);
  const prereqReady = Boolean(prereq.data?.ready);

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

  // The form is the workflow's own run form: it sends exactly the declared
  // inputs, with document inputs as references to their uploaded documents.
  const runMut = useMutation({
    mutationFn: async (input: Record<string, unknown>) => {
      rememberRunInput(workflowName, input);
      return workflowsApi.execute(workflowName, {
        input,
        wait_for_result: true,
        timeout_seconds: 120,
      });
    },
    onSuccess: (res: Record<string, unknown>, input) => {
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
          content: Object.entries(input)
            .map(([k, v]) => `**${k}**: ${describeInput(v)}`)
            .join("\n"),
        },
        {
          role: "assistant",
          content: formatted,
        },
      ]);

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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[88vh] flex flex-col p-0 overflow-hidden">
        <DialogHeader className="p-4 border-b border-border bg-background-elevated">
          <DialogTitle className="flex items-center gap-2 text-base">
            <Play className="size-4 text-emerald" /> Run {workflowName}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto custom-scrollbar p-5 space-y-4">
          {!prereqReady ? <WorkflowPrerequisites workflowName={workflowName} /> : null}
          {/* The workflow's own run form, built from its declared inputs */}
          {workflow ? (
            <div className="rounded-xl border border-border bg-background-elevated/50">
              <WorkflowRunForm
                definition={workflow}
                running={runMut.isPending}
                onRun={(input) => runMut.mutate(input)}
                blockedReason={prereqReady ? null : "Resolve the prerequisites above first"}
              />
            </div>
          ) : null}

          {/* Step results timeline if available */}
          {executionData?.step_results && executionData.step_results.length > 0 && (
            <div className="rounded-xl border border-border bg-background-elevated/40 p-3">
              <p className="mb-3 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                Step Execution Timeline
              </p>
              <ExecutionStepTimeline
                steps={executionData.step_results.map((st) => ({
                  id: st.step_id,
                  name: st.step_id,
                  status: st.status,
                  duration_ms: st.duration_ms ?? null,
                  error: st.error ?? null,
                }))}
              />
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
