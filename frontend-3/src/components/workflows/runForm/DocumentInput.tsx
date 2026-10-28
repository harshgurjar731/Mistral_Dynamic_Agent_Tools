/**
 * The control for a document input (`type: "file"`).
 *
 * A picked file is uploaded at once — into the input's library, attached to
 * the agents that read it — and the form shows what Mistral read from it, so a
 * blank scan is caught before the run rather than by a confused agent. The run
 * sends a reference to the document, never its bytes. The document's text can
 * be pasted instead.
 */
import { useRef, useState, type DragEvent } from "react";
import {
  AlertCircle,
  ChevronDown,
  ClipboardPaste,
  FileText,
  Loader2,
  Trash2,
  Upload,
} from "lucide-react";
import { errorMessage, workflowsApi } from "@/api";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import {
  ACCEPT_GROUPS,
  acceptAttribute,
  acceptOf,
  acceptsFile,
  emptyDocuments,
  isDocumentValue,
  maxFiles,
  maxSizeMb,
  type DocumentValue,
  type FieldValue,
  type ResolvedField,
  type UploadedDocument,
} from "./fieldModel";
import { LivePercent } from "@/components/activity/LiveProgress";

function formatSize(bytes: number): string {
  if (!bytes) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function DocumentCard({ doc, onRemove }: { doc: UploadedDocument; onRemove: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-md border border-border bg-background-elevated/60">
      <div className="flex items-center gap-2 px-2.5 py-2">
        <FileText className="size-4 shrink-0 text-primary" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-foreground">{doc.name}</p>
          <p className="text-[10px] text-muted-foreground tabular-nums">
            {[
              formatSize(doc.size),
              doc.chars ? `${doc.chars.toLocaleString()} characters read` : "uploaded earlier",
            ]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {doc.preview ? (
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            className="inline-flex items-center gap-0.5 text-[10px] text-muted-foreground hover:text-foreground"
          >
            Preview
            <ChevronDown className={cn("size-3 transition-transform", !open && "-rotate-90")} />
          </button>
        ) : null}
        <button
          type="button"
          aria-label={`Remove ${doc.name}`}
          onClick={onRemove}
          className="rounded p-1 text-muted-foreground hover:text-red"
        >
          <Trash2 className="size-3.5" />
        </button>
      </div>
      {open ? (
        <pre className="max-h-40 overflow-y-auto border-t border-border px-2.5 py-2 font-sans text-[11px] leading-relaxed whitespace-pre-wrap text-muted-foreground">
          {doc.preview}
          {doc.chars > doc.preview.length ? "…" : ""}
        </pre>
      ) : null}
    </div>
  );
}

export function DocumentInput({
  r,
  id,
  workflowName,
  value,
  invalid,
  update,
  onBlur,
}: {
  r: ResolvedField;
  id: string;
  workflowName: string;
  value: FieldValue | undefined;
  invalid: boolean;
  /** Functional update — uploads finish in any order, so each applies to the latest state. */
  update: (fn: (prev: DocumentValue) => DocumentValue) => void;
  onBlur: () => void;
}) {
  const doc = isDocumentValue(value) ? value : emptyDocuments();
  const pickerRef = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const [failures, setFailures] = useState<string[]>([]);
  const limit = maxFiles(r.field);
  const sizeLimit = maxSizeMb(r.field);
  const kinds = acceptOf(r.field)
    .map((g) => ACCEPT_GROUPS[g]?.label ?? g)
    .join(", ");
  const full = doc.docs.length + doc.pending >= limit;

  const upload = (files: File[]) => {
    const problems: string[] = [];
    const room = limit - doc.docs.length - doc.pending;
    const ok: File[] = [];
    for (const file of files) {
      if (!acceptsFile(r.field, file)) {
        problems.push(`${file.name}: not an accepted file (${kinds})`);
      } else if (file.size > sizeLimit * 1024 * 1024) {
        problems.push(`${file.name}: larger than ${sizeLimit} MB`);
      } else if (ok.length >= room) {
        problems.push(
          `${file.name}: this input takes at most ${limit} document${limit === 1 ? "" : "s"}`,
        );
      } else {
        ok.push(file);
      }
    }
    setFailures(problems);
    if (!ok.length) return;
    update((prev) => ({ ...prev, mode: "upload", pending: prev.pending + ok.length }));
    for (const file of ok) {
      workflowsApi
        .uploadInputDocument(workflowName, r.name, file)
        .then((res) =>
          update((prev) => ({
            ...prev,
            pending: Math.max(0, prev.pending - 1),
            docs: [
              ...prev.docs,
              {
                ref: res.ref,
                name: res.name,
                size: res.size,
                chars: res.chars,
                preview: res.preview,
              },
            ],
          })),
        )
        .catch((e: unknown) => {
          setFailures((f) => [...f, `${file.name}: ${errorMessage(e)}`]);
          update((prev) => ({ ...prev, pending: Math.max(0, prev.pending - 1) }));
        })
        .finally(onBlur);
    }
  };

  const remove = (target: UploadedDocument) => {
    update((prev) => ({
      ...prev,
      docs: prev.docs.filter(
        (d) => d.ref.$document.document_id !== target.ref.$document.document_id,
      ),
    }));
    // Best effort: the document leaves the library too, so it is not left for
    // the agents to find in a later run.
    workflowsApi
      .deleteInputDocument(workflowName, r.name, target.ref.$document.document_id)
      .catch(() => undefined);
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    if (!full) upload(Array.from(e.dataTransfer.files));
  };

  return (
    <div>
      <div className="mb-1.5 flex w-fit rounded-md border border-border bg-background-elevated/60 p-0.5">
        {(
          [
            ["upload", "Upload", Upload],
            ["paste", "Paste text", ClipboardPaste],
          ] as const
        ).map(([mode, label, Icon]) => (
          <button
            key={mode}
            type="button"
            onClick={() => update((prev) => ({ ...prev, mode }))}
            className={cn(
              "inline-flex items-center gap-1 rounded px-2 py-0.5 text-[11px] font-medium transition",
              doc.mode === mode
                ? "bg-surface text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            <Icon className="size-3" /> {label}
          </button>
        ))}
      </div>

      {doc.mode === "paste" ? (
        <Textarea
          id={id}
          rows={6}
          value={doc.text}
          placeholder={`Paste the text of the ${r.label.toLowerCase()} here`}
          onChange={(e) => {
            const text = e.target.value;
            update((prev) => ({ ...prev, text }));
          }}
          onBlur={onBlur}
          className={cn(
            "resize-y text-xs leading-relaxed",
            invalid && "border-red/60 focus-visible:ring-red/40",
          )}
        />
      ) : (
        <div className="space-y-1.5">
          {doc.docs.map((d) => (
            <DocumentCard key={d.ref.$document.document_id} doc={d} onRemove={() => remove(d)} />
          ))}
          {Array.from({ length: doc.pending }).map((_, i) => (
            <div
              key={`pending-${i}`}
              className="flex items-center gap-2 rounded-md border border-border bg-background-elevated/40 px-2.5 py-2 text-[11px] text-muted-foreground"
            >
              <Loader2 className="size-3.5 animate-spin" /> Uploading and reading the document…{" "}
              <LivePercent />
            </div>
          ))}
          {!full ? (
            <div
              id={id}
              role="button"
              tabIndex={0}
              onClick={() => pickerRef.current?.click()}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  pickerRef.current?.click();
                }
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={onDrop}
              className={cn(
                "flex cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed px-3 py-4 text-center transition",
                dragging
                  ? "border-primary/60 bg-primary/5"
                  : "border-border bg-background-elevated/40 hover:border-border-strong",
                invalid && !dragging && "border-red/60",
              )}
            >
              <Upload className="size-4 text-muted-foreground" />
              <p className="text-xs text-foreground">
                Drop {limit > 1 ? "documents" : "the document"} here or{" "}
                <span className="text-primary">browse</span>
              </p>
              <p className="text-[10px] text-muted-foreground">
                {kinds} · up to {sizeLimit} MB
                {limit > 1 ? ` · ${limit} files` : ""}
              </p>
            </div>
          ) : null}
          <input
            ref={pickerRef}
            type="file"
            className="hidden"
            accept={acceptAttribute(r.field)}
            multiple={limit > 1}
            onChange={(e) => {
              upload(Array.from(e.target.files ?? []));
              e.target.value = "";
            }}
          />
        </div>
      )}

      {failures.length ? (
        <ul className="mt-1.5 space-y-0.5">
          {failures.map((f) => (
            <li key={f} className="flex items-start gap-1 text-[11px] text-red">
              <AlertCircle className="mt-0.5 size-3 shrink-0" /> {f}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
