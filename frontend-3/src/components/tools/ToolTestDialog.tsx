/**
 * Run one tool/activity version by hand with proper parameters.
 *
 * The form is built from the version's input schema. Picking a worked example
 * prefills it, and the result is then compared to that example's expected
 * output. A failed run can go straight to "Rebuild from this failure" with the
 * error, the input and (for an example) the expected output filled in.
 */
import { useMutation } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  CheckCircle2,
  FileInput,
  Hammer,
  ListChecks,
  Loader2,
  Play,
  XCircle,
} from "lucide-react";
import { errorMessage, toolsApi } from "@/api";
import type { Tool, ToolTestResult } from "@/types";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { CodeBlock } from "@/components/shared/CodeBlock";
import { cn } from "@/lib/utils";
import { paramFields, toArguments, valuesFrom, type ParamField } from "./paramForm";
import { LivePercent } from "@/components/activity/LiveProgress";

export interface RebuildPrefill {
  error: string;
  failingInput: Record<string, unknown> | null;
  expectedOutput?: unknown;
}

const OUTCOME = {
  passed: { label: "Passed — matches the worked example", icon: CheckCircle2, cls: "text-emerald" },
  succeeded: { label: "Ran successfully", icon: CheckCircle2, cls: "text-emerald" },
  wrong_output: { label: "Wrong output", icon: AlertTriangle, cls: "text-amber" },
  returned_error: { label: "The code returned an error", icon: XCircle, cls: "text-destructive" },
  call_failed: { label: "The call was refused", icon: XCircle, cls: "text-destructive" },
} as const;

export function ToolTestDialog({
  tool,
  open,
  onOpenChange,
  onRebuild,
}: {
  tool: Tool;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when the version can be rebuilt (dynamic tools). */
  onRebuild?: ((prefill: RebuildPrefill) => void) | undefined;
}) {
  const fields = useMemo(() => paramFields(tool), [tool]);
  const examples = tool.spec?.examples ?? [];
  const [exampleIndex, setExampleIndex] = useState<number | null>(examples.length ? 0 : null);
  const [values, setValues] = useState<Record<string, string>>(() =>
    valuesFrom(fields, examples[0]?.input ?? {}),
  );
  const [mode, setMode] = useState<"form" | "json">(fields.length ? "form" : "json");
  const [json, setJson] = useState(() => JSON.stringify(examples[0]?.input ?? {}, null, 2));
  const [touched, setTouched] = useState(false);
  const [confirmSideEffects, setConfirmSideEffects] = useState(false);
  const sideEffects = tool.side_effects && !["none", "read-only"].includes(tool.side_effects);

  const pickExample = (index: number | null) => {
    setExampleIndex(index);
    const input = index == null ? {} : (examples[index]?.input ?? {});
    setValues(valuesFrom(fields, input));
    setJson(JSON.stringify(input, null, 2));
    run.reset();
  };

  const { args: formArgs, errors } = toArguments(fields, values);
  let jsonArgs: Record<string, unknown> | null = null;
  let jsonError: string | null = null;
  try {
    const parsed: unknown = json.trim() ? JSON.parse(json) : {};
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      jsonArgs = parsed as Record<string, unknown>;
    } else jsonError = "Arguments must be a JSON object";
  } catch {
    jsonError = "Not valid JSON";
  }
  const args = mode === "form" ? formArgs : jsonArgs;
  const blocked =
    mode === "form" ? Object.keys(errors).length > 0 : jsonError != null || jsonArgs == null;

  const switchMode = (next: "form" | "json") => {
    if (next === mode) return;
    if (next === "json") setJson(JSON.stringify(formArgs, null, 2));
    else if (jsonArgs) setValues(valuesFrom(fields, jsonArgs));
    setMode(next);
  };

  const run = useMutation({
    mutationFn: () =>
      toolsApi.test(tool.id, {
        arguments: args ?? {},
        ...(exampleIndex != null ? { example_index: exampleIndex } : {}),
        ...(confirmSideEffects ? { allow_side_effects: true } : {}),
      }),
  });
  const result = run.data;

  const submit = () => {
    setTouched(true);
    if (blocked || run.isPending) return;
    if (sideEffects && !confirmSideEffects) return;
    run.mutate();
  };

  const rebuildFrom = (r: ToolTestResult | null) => {
    if (!onRebuild) return;
    onRebuild({
      error: r?.error ?? errorMessage(run.error),
      failingInput: args ?? null,
      ...(r?.expected !== undefined && r?.expected !== null ? { expectedOutput: r.expected } : {}),
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] max-w-3xl gap-0 overflow-hidden p-0">
        <div className="flex max-h-[90vh] flex-col">
          <DialogHeader className="border-b border-border px-6 py-4 text-left">
            <DialogTitle className="flex items-center gap-2 text-base">
              <Play className="size-4 text-primary" /> Test {tool.name}
              <span className="font-mono text-xs font-normal text-muted-foreground">
                v{tool.version_no ?? tool.version ?? 1}
              </span>
            </DialogTitle>
            <DialogDescription className="text-xs">
              Runs this exact version on the tool service. Pick a worked example to prefill the
              parameters and check the output against it, or enter your own values.
            </DialogDescription>
          </DialogHeader>

          <div className="flex-1 space-y-4 overflow-y-auto px-6 py-4">
            {/* Examples */}
            <section>
              <p className="mb-1.5 flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                <ListChecks className="size-3" /> Start from
              </p>
              <div className="flex flex-wrap gap-1.5">
                {examples.map((ex, i) => (
                  <button
                    key={i}
                    type="button"
                    onClick={() => pickExample(i)}
                    title={ex.note || undefined}
                    className={cn(
                      "rounded-lg border px-2.5 py-1 text-[11px] transition",
                      exampleIndex === i
                        ? "border-primary bg-primary/10 text-foreground"
                        : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                    )}
                  >
                    Example {i + 1}
                  </button>
                ))}
                <button
                  type="button"
                  onClick={() => pickExample(null)}
                  className={cn(
                    "rounded-lg border px-2.5 py-1 text-[11px] transition",
                    exampleIndex == null
                      ? "border-primary bg-primary/10 text-foreground"
                      : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  My own values
                </button>
              </div>
              {exampleIndex != null && examples[exampleIndex]?.note ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  {examples[exampleIndex]?.note}
                </p>
              ) : null}
              {examples.length === 0 ? (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  This version has no worked examples — fill in the parameters below.
                </p>
              ) : null}
            </section>

            {/* Parameters */}
            <section>
              <div className="mb-1.5 flex items-center justify-between">
                <p className="flex items-center gap-1.5 text-[10px] font-semibold tracking-wider text-muted-foreground uppercase">
                  <FileInput className="size-3" /> Parameters
                </p>
                <div className="flex rounded-lg border border-border p-0.5 text-[10px]">
                  {(["form", "json"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      disabled={m === "form" && fields.length === 0}
                      onClick={() => switchMode(m)}
                      className={cn(
                        "rounded-md px-2 py-0.5 disabled:opacity-40",
                        mode === m ? "bg-secondary text-foreground" : "text-muted-foreground",
                      )}
                    >
                      {m === "form" ? "Form" : "JSON"}
                    </button>
                  ))}
                </div>
              </div>
              {mode === "form" ? (
                <div className="space-y-3">
                  {fields.map((f) => (
                    <ParamInput
                      key={f.name}
                      field={f}
                      value={values[f.name] ?? ""}
                      error={touched ? errors[f.name] : undefined}
                      onChange={(v) => {
                        setValues((prev) => ({ ...prev, [f.name]: v }));
                        run.reset();
                      }}
                    />
                  ))}
                </div>
              ) : (
                <div>
                  <Textarea
                    value={json}
                    onChange={(e) => {
                      setJson(e.target.value);
                      run.reset();
                    }}
                    rows={8}
                    className="font-mono text-xs"
                  />
                  {jsonError ? (
                    <p className="mt-1 text-[10px] text-destructive">{jsonError}</p>
                  ) : null}
                </div>
              )}
            </section>

            {sideEffects ? (
              <label className="flex items-start gap-2 rounded-lg border border-amber/30 bg-amber/5 px-3 py-2 text-[11px] text-amber">
                <input
                  type="checkbox"
                  className="mt-0.5"
                  checked={confirmSideEffects}
                  onChange={(e) => setConfirmSideEffects(e.target.checked)}
                />
                This {tool.purpose === "activity" ? "activity" : "tool"} declares “
                {tool.side_effects}” side effects: a test run changes real data. Tick to run it
                anyway.
              </label>
            ) : null}

            {/* Result */}
            {run.isError ? (
              <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-[11px] text-destructive">
                {errorMessage(run.error)}
              </div>
            ) : null}
            {result ? <TestResultView result={result} /> : null}
          </div>

          <DialogFooter className="gap-2 border-t border-border px-6 py-3 sm:space-x-0">
            {onRebuild && ((result && !result.ok) || run.isError) ? (
              <Button variant="outline" size="sm" onClick={() => rebuildFrom(result ?? null)}>
                <Hammer className="size-3.5" /> Rebuild from this failure
              </Button>
            ) : null}
            <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
              Close
            </Button>
            <Button
              size="sm"
              onClick={submit}
              disabled={run.isPending || (Boolean(sideEffects) && !confirmSideEffects)}
            >
              {run.isPending ? (
                <>
                  <Loader2 className="size-3.5 animate-spin" />
                  <LivePercent />
                </>
              ) : (
                <Play className="size-3.5" />
              )}
              {run.isPending ? "Running…" : exampleIndex != null ? "Run example" : "Run"}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ParamInput({
  field,
  value,
  error,
  onChange,
}: {
  field: ParamField;
  value: string;
  error: string | undefined;
  onChange: (value: string) => void;
}) {
  const id = `param-${field.name}`;
  const multiline = field.type === "object" || field.type === "array";
  return (
    <div>
      <label htmlFor={id} className="flex flex-wrap items-baseline gap-1.5 text-xs">
        <span className="font-mono font-medium text-foreground">{field.name}</span>
        <span className="text-[10px] text-muted-foreground">
          {field.type}
          {field.required ? " · required" : " · optional"}
        </span>
      </label>
      {field.description ? (
        <p className="mb-1 text-[10px] text-muted-foreground">{field.description}</p>
      ) : null}
      {field.enumValues ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">—</option>
          {field.enumValues.map((v) => (
            <option key={v} value={v}>
              {v}
            </option>
          ))}
        </select>
      ) : field.type === "boolean" ? (
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 w-full rounded-md border border-border bg-background px-2 text-xs"
        >
          <option value="">—</option>
          <option value="true">true</option>
          <option value="false">false</option>
        </select>
      ) : multiline ? (
        <Textarea
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          rows={4}
          placeholder={field.type === "array" ? "[ … ]" : "{ … }"}
          className="font-mono text-xs"
        />
      ) : (
        <Input
          id={id}
          value={value}
          inputMode={field.type === "string" ? undefined : "decimal"}
          onChange={(e) => onChange(e.target.value)}
          className="h-8 text-xs"
        />
      )}
      {error ? <p className="mt-0.5 text-[10px] text-destructive">{error}</p> : null}
    </div>
  );
}

function TestResultView({ result }: { result: ToolTestResult }) {
  const meta = OUTCOME[result.outcome];
  const Icon = meta.icon;
  const shown = result.data !== undefined ? result.data : result.result;
  return (
    <section
      className={cn(
        "rounded-xl border px-3 py-3",
        result.ok ? "border-emerald/30 bg-emerald/5" : "border-destructive/25 bg-destructive/5",
      )}
    >
      <p className={cn("flex items-center gap-1.5 text-xs font-semibold", meta.cls)}>
        <Icon className="size-3.5" /> {meta.label}
        <span className="ml-auto font-mono text-[10px] font-normal text-muted-foreground">
          v{result.version} · {result.duration_ms} ms
        </span>
      </p>
      {result.error ? <p className="mt-1 text-[11px] text-foreground/90">{result.error}</p> : null}
      <div className={cn("mt-2 grid gap-2", result.expected != null && "md:grid-cols-2")}>
        {shown !== undefined && shown !== null ? (
          <div>
            <p className="mb-1 flex items-center gap-1 text-[10px] text-muted-foreground uppercase">
              <Braces className="size-3" />{" "}
              {result.data !== undefined ? "Output (data)" : "Response"}
            </p>
            <CodeBlock code={JSON.stringify(shown, null, 2)} language="json" />
          </div>
        ) : null}
        {result.expected != null ? (
          <div>
            <p className="mb-1 text-[10px] text-muted-foreground uppercase">Expected (example)</p>
            <CodeBlock code={JSON.stringify(result.expected, null, 2)} language="json" />
          </div>
        ) : null}
      </div>
    </section>
  );
}
