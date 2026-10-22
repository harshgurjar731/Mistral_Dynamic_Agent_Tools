/**
 * The one upload flow for process documents, used by the Processes page and
 * both orchestration pages, so every ingestion point checks, reports and
 * offers the same fixes:
 *
 *   upload → validated on the server → valid: done
 *                                    → invalid: report → Fix with AI → review → accept
 *                                                      → Re-upload (replaces the invalid copy)
 *                                                      → Download template / report
 */
import { useCallback, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, processesApi, QK } from "@/api";
import type { ProcessDocument, SaveResult, ValidationReport } from "@/api/processes";
import { AiFixDialog, type AiSource } from "./AiFixDialog";
import { ValidationReportDialog } from "./ValidationReportDialog";

interface Current {
  document: ProcessDocument;
  report: ValidationReport;
  fileName: string;
  text?: string | undefined;
}

export function useDocumentIngest({
  conceptId,
  goal,
  classifyAs,
  onSaved,
}: {
  /** File under this process; omitted: an unfiled (orchestration) upload. */
  conceptId?: string | null;
  /**
   * Unfiled uploads are checked against the template of where they are
   * classified: ``classifyAs`` when the user chose, else what the document
   * names, else this request ``goal``.
   */
  goal?: string | undefined;
  classifyAs?: string | null | undefined;
  /** Called with every valid document stored. */
  onSaved?: (doc: ProcessDocument) => void;
}) {
  const qc = useQueryClient();
  const [current, setCurrent] = useState<Current | null>(null);
  const [reportOpen, setReportOpen] = useState(false);
  const [ai, setAi] = useState<AiSource | null>(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK.processes() });
    void qc.invalidateQueries({ queryKey: QK.ontology() });
  }, [qc]);

  const handle = useCallback(
    (result: SaveResult, fileName: string, text?: string) => {
      setCurrent({ document: result.document, report: result.report, fileName, text });
      refresh();
      if (result.report.valid) {
        onSaved?.(result.document);
        const warnings = result.report.warnings.length;
        toast.success(
          result.document.concept_id
            ? `Saved as version ${result.document.version}${result.document.is_active ? " (active)" : ""}.`
            : "Document checked and attached.",
          warnings
            ? {
                description: `${warnings} warning${warnings === 1 ? "" : "s"} — worth a look.`,
                action: { label: "View", onClick: () => setReportOpen(true) },
              }
            : undefined,
        );
        setReportOpen(false);
      } else {
        setReportOpen(true);
      }
    },
    [onSaved, refresh],
  );

  const run = useCallback(
    async (fn: () => Promise<SaveResult>, fileName: string, text?: string) => {
      setBusy(true);
      try {
        handle(await fn(), fileName, text);
      } catch (e) {
        toast.error(`Upload failed: ${errorMessage(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [handle],
  );

  const upload = useCallback(
    async (file: File) => {
      const text = await file.text().catch(() => undefined);
      await run(
        () =>
          conceptId
            ? processesApi.uploadTo(conceptId, file)
            : processesApi.uploadUnfiled(file, { goal, classifyAs }),
        file.name,
        text,
      );
    },
    [conceptId, goal, classifyAs, run],
  );

  const reupload = useCallback(
    async (file: File) => {
      if (!current) return upload(file);
      const text = await file.text().catch(() => undefined);
      await run(() => processesApi.reupload(current.document.id, file), file.name, text);
    },
    [current, run, upload],
  );

  /** Open the report of a document already stored — e.g. "Fix" in a list. */
  const review = useCallback(async (doc: ProcessDocument) => {
    try {
      const full = doc.report ? doc : await processesApi.document(doc.id);
      setCurrent({
        document: full,
        report: full.report!,
        fileName: full.filename ?? full.title,
        text: full.raw,
      });
      setReportOpen(true);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  }, []);

  const fixWithAi = useCallback(() => {
    if (!current) return;
    setReportOpen(false);
    setAi({
      mode: "fix",
      documentId: current.document.id,
      conceptId: current.document.concept_id ?? conceptId ?? null,
    });
  }, [current, conceptId]);

  const draft = useCallback(() => {
    setCurrent(null);
    setAi({ mode: "draft", conceptId: conceptId ?? null, classifyAs: classifyAs ?? null });
  }, [conceptId, classifyAs]);

  const accept = useCallback(
    async (document: Record<string, unknown>) => {
      const drafting = ai?.mode === "draft";
      // An invalid stored copy is replaced; a valid one gets a new version.
      const replaceId =
        !drafting && current && current.document.status !== "valid" ? current.document.id : null;
      const target = current?.document.concept_id ?? conceptId ?? null;
      const opts = {
        filename: current?.fileName ?? "ai_document.json",
        source: drafting ? "ai_drafted" : "ai_fixed",
        replace_id: replaceId,
      };
      setBusy(true);
      try {
        // An unfiled fix keeps its classification server-side (replace_id); a
        // new unfiled document is classified like an upload.
        const result = target
          ? await processesApi.saveJsonTo(target, document, opts)
          : await processesApi.saveJsonUnfiled(document, {
              ...opts,
              ...(replaceId ? {} : { goal: goal ?? "", classify_as: classifyAs ?? null }),
            });
        setAi(null);
        handle(result, opts.filename, JSON.stringify(document, null, 2));
      } catch (e) {
        toast.error(`Could not save: ${errorMessage(e)}`);
      } finally {
        setBusy(false);
      }
    },
    [ai, current, conceptId, goal, classifyAs, handle],
  );

  const dialogs: ReactNode = (
    <>
      <ValidationReportDialog
        open={reportOpen}
        onOpenChange={setReportOpen}
        report={current?.report ?? null}
        fileName={current?.fileName}
        onFixWithAi={fixWithAi}
        onReupload={(f) => void reupload(f)}
        busy={busy}
      />
      <AiFixDialog
        open={Boolean(ai)}
        onOpenChange={(o) => !o && setAi(null)}
        source={ai}
        originalText={ai?.mode === "fix" ? current?.text : undefined}
        onAccept={(doc) => void accept(doc)}
        accepting={busy}
      />
    </>
  );

  return { upload, review, draft, busy, current, dialogs };
}
