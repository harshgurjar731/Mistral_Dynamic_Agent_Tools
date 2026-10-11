import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { errorMessage, QK, revisionsApi, workflowsApi } from "@/api";
import type { RevisionOperation, WorkflowRevision } from "@/types";

/**
 * Everything the refine workspace needs: the workflow, the conversation of
 * proposals, what is previewed and focused, and the actions on them.
 *
 * Proposing never changes the workflow, so the only writes are apply,
 * restore and undo — and each refreshes the workflow, its validation, its
 * versions and the suggestions, since all four depend on the definition.
 */
export function useWorkflowRefine(workflowName: string, origin: "editor" | "planner" = "editor") {
  const qc = useQueryClient();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [focus, setFocus] = useState<string[]>([]);
  /** The instruction in flight, shown as the user's turn until the answer lands. */
  const [pending, setPending] = useState<{ instruction: string; focus: string[] } | null>(null);

  const workflow = useQuery({
    queryKey: QK.workflow(workflowName),
    queryFn: () => workflowsApi.get(workflowName),
  });
  const definition = workflow.data;

  const validation = useQuery({
    queryKey: [...QK.workflow(workflowName), "validation", definition?.updated_at ?? ""],
    queryFn: () => workflowsApi.validate(definition!),
    enabled: Boolean(definition?.steps?.length),
  });

  const revisions = useQuery({
    queryKey: QK.workflowRevisions(workflowName),
    queryFn: () => revisionsApi.list(workflowName),
    enabled: Boolean(definition),
  });

  const versions = useQuery({
    queryKey: QK.workflowVersions(workflowName),
    queryFn: () => revisionsApi.versions(workflowName),
    enabled: Boolean(definition),
  });

  const suggestions = useQuery({
    queryKey: [...QK.revisionSuggestions(workflowName), definition?.updated_at ?? ""],
    queryFn: () => revisionsApi.suggestions(workflowName),
    enabled: Boolean(definition?.steps?.length),
    staleTime: 30_000,
  });

  const catalog = useQuery({
    queryKey: QK.builderCatalog(),
    queryFn: workflowsApi.catalog,
    enabled: Boolean(definition),
    staleTime: 60_000,
  });

  const refreshAll = useCallback(() => {
    void qc.invalidateQueries({ queryKey: QK.workflow(workflowName) });
    void qc.invalidateQueries({ queryKey: QK.workflows() });
    void qc.invalidateQueries({ queryKey: QK.workflowPrerequisites(workflowName) });
  }, [qc, workflowName]);

  const upsertRevision = useCallback(
    (rev: WorkflowRevision) => {
      qc.setQueryData<WorkflowRevision[]>(QK.workflowRevisions(workflowName), (old) => {
        const list = old ?? [];
        return list.some((r) => r.id === rev.id)
          ? list.map((r) => (r.id === rev.id ? { ...r, ...rev } : r))
          : [...list, rev];
      });
    },
    [qc, workflowName],
  );

  const propose = useMutation({
    mutationFn: (body: { instruction?: string; operations?: RevisionOperation[] }) =>
      revisionsApi.propose(workflowName, {
        ...body,
        focus_step_ids: focus,
        origin,
      }),
    onMutate: (body) =>
      setPending({ instruction: body.instruction?.trim() || "Applying your edit…", focus }),
    onSuccess: (rev) => {
      upsertRevision(rev);
      // Show a fresh proposal on the canvas straight away.
      if (rev.status === "proposed") setPreviewId(rev.id);
      setFocus([]);
    },
    onError: (e) => toast.error(`Could not prepare the change: ${errorMessage(e)}`),
    onSettled: () => setPending(null),
  });

  const apply = useMutation({
    mutationFn: ({ id, allowErrors }: { id: string; allowErrors?: boolean }) =>
      revisionsApi.apply(workflowName, id, allowErrors),
    onSuccess: (res) => {
      upsertRevision(res.revision);
      if (res.workflow) qc.setQueryData(QK.workflow(workflowName), res.workflow);
      setPreviewId(null);
      refreshAll();
      toast.success(
        res.version_no ? `Change applied — saved as version ${res.version_no}` : "Change applied",
        {
          action: { label: "Undo", onClick: () => undo.mutate() },
        },
      );
    },
    onError: (e) => {
      toast.error(errorMessage(e));
      void qc.invalidateQueries({ queryKey: QK.workflowRevisions(workflowName) });
    },
  });

  const discard = useMutation({
    mutationFn: (id: string) => revisionsApi.discard(workflowName, id),
    onSuccess: (rev) => {
      upsertRevision(rev);
      setPreviewId((p) => (p === rev.id ? null : p));
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const undo = useMutation({
    mutationFn: () => revisionsApi.undo(workflowName),
    onSuccess: (res) => {
      if (res.workflow) qc.setQueryData(QK.workflow(workflowName), res.workflow);
      setPreviewId(null);
      refreshAll();
      toast.success(`Reverted to version ${res.restored_version}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const restore = useMutation({
    mutationFn: (versionNo: number) => revisionsApi.restore(workflowName, versionNo),
    onSuccess: (res) => {
      if (res.workflow) qc.setQueryData(QK.workflow(workflowName), res.workflow);
      setPreviewId(null);
      refreshAll();
      toast.success(`Restored version ${res.restored_version}`);
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const publish = useMutation({
    mutationFn: () => workflowsApi.publish(workflowName),
    onSuccess: (res) => {
      toast.success(String(res["message"] ?? "Workflow published"));
      refreshAll();
    },
    onError: (e) => toast.error(errorMessage(e)),
  });

  const list = useMemo(() => revisions.data ?? [], [revisions.data]);
  const preview = useMemo(
    () => list.find((r) => r.id === previewId && r.status === "proposed") ?? null,
    [list, previewId],
  );

  // A previewed proposal that stops being open (applied elsewhere, superseded)
  // leaves preview mode rather than showing a stale picture.
  const lastPreview = useRef<string | null>(null);
  useEffect(() => {
    if (previewId && !preview && lastPreview.current === previewId) setPreviewId(null);
    lastPreview.current = previewId;
  }, [preview, previewId]);

  const toggleFocus = useCallback(
    (stepId: string) =>
      setFocus((f) => (f.includes(stepId) ? f.filter((x) => x !== stepId) : [...f, stepId])),
    [],
  );

  return {
    workflow,
    definition,
    validation,
    revisions: list,
    revisionsLoading: revisions.isLoading,
    versions,
    suggestions: suggestions.data?.suggestions ?? [],
    catalog: catalog.data,
    preview,
    previewId,
    setPreviewId,
    focus,
    setFocus,
    toggleFocus,
    pending,
    propose,
    apply,
    discard,
    undo,
    restore,
    publish,
  };
}

export type WorkflowRefine = ReturnType<typeof useWorkflowRefine>;
