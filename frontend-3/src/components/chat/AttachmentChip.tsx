/**
 * Attaching files to a chat message — images, audio, PDF and Office documents,
 * text files — for the playground and agent chat.
 *
 * Which model the message goes to decides how each file reaches it, and the
 * chips say so: "as image" / "as audio" / "as document" when the model takes
 * it as it is, "as text" when it is converted first (an image for a model
 * that cannot see becomes the text read from it; audio the API cannot take
 * becomes its transcript). The rules live in the backend
 * (app/services/attachments.py) and arrive through GET /api/uploads/support.
 */
import { useQuery } from "@tanstack/react-query";
import {
  AudioLines,
  FileText,
  FileType2,
  Image as ImageIcon,
  Loader2,
  Paperclip,
  X,
  type LucideIcon,
} from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { inputSupportApi, uploadAttachment } from "@/api";
import { errorMessage } from "@/api/client";
import { cn } from "@/lib/utils";
import type { Attachment, AttachmentKind, InputSupport } from "@/types";

const MAX_MB = 20;
const MAX_FILES = 5;

export const KIND_META: Record<
  AttachmentKind,
  { label: string; icon: LucideIcon; native: string }
> = {
  image: { label: "Images", icon: ImageIcon, native: "as image" },
  audio: { label: "Audio", icon: AudioLines, native: "as audio" },
  document: { label: "PDF & Office documents", icon: FileType2, native: "as document" },
  text: { label: "Text files", icon: FileText, native: "as text" },
};

const KINDS: AttachmentKind[] = ["image", "audio", "document", "text"];

/** What the target takes. `agentId` wins: agent chat uses the agent's own model. */
export function useInputSupport(target: {
  model?: string | undefined;
  agentId?: string | undefined;
}) {
  const params = target.agentId ? { agent_id: target.agentId } : { model: target.model ?? "" };
  return useQuery({
    queryKey: ["input-support", params],
    queryFn: () => inputSupportApi.get(params),
    enabled: Boolean(target.agentId || target.model),
    staleTime: 5 * 60_000,
  });
}

function how(support: InputSupport | undefined, kind: AttachmentKind): string {
  const mode = support?.kinds?.[kind]?.mode;
  if (!mode || kind === "text") return KIND_META[kind].native;
  if (mode === "native") return KIND_META[kind].native;
  return kind === "audio" ? "as transcript" : "as text";
}

function explain(support: InputSupport | undefined): string {
  const lines = KINDS.map((k) => {
    const mode = support?.kinds?.[k]?.mode;
    const note =
      k === "text" || mode === "native" || !mode
        ? KIND_META[k].native
        : k === "audio"
          ? "transcribed first"
          : k === "image"
            ? "this model cannot see — the text in the image is read and sent"
            : "converted to text first";
    return `${KIND_META[k].label}: ${note}`;
  });
  return `Attach files (up to ${MAX_FILES}, ${MAX_MB} MB each)\n${lines.join("\n")}`;
}

const ACCEPT = [
  "image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp,.gif",
  "audio/*,.mp3,.wav,.m4a,.ogg,.flac,.webm,.aac",
  ".pdf,.docx,.pptx,.xlsx",
  ".txt,.md,.csv,.json,.yaml,.yml,.html,.xml,.log",
].join(",");

/** The paperclip: picks files and uploads them. */
export function AttachmentButton({
  attachments,
  onAdd,
  uploading,
  setUploading,
  support,
  disabled,
}: {
  attachments: Attachment[];
  onAdd: (a: Attachment) => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  support: InputSupport | undefined;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFiles = async (files: File[]) => {
    const room = MAX_FILES - attachments.length;
    if (files.length > room) toast.error(`At most ${MAX_FILES} files per message.`);
    setUploading(true);
    try {
      for (const file of files.slice(0, Math.max(0, room))) {
        if (file.size > MAX_MB * 1024 * 1024) {
          toast.error(`${file.name} exceeds the ${MAX_MB} MB limit.`);
          continue;
        }
        try {
          onAdd(await uploadAttachment(file));
        } catch (err) {
          toast.error(errorMessage(err));
        }
      }
    } finally {
      setUploading(false);
    }
  };

  const title = explain(support);
  return (
    <>
      <input
        ref={inputRef}
        type="file"
        multiple
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          if (files.length) void handleFiles(files);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || uploading || attachments.length >= MAX_FILES}
        onClick={() => inputRef.current?.click()}
        title={title}
        aria-label="Attach files"
        className="inline-flex size-8 items-center justify-center rounded-xl border border-border glass text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
      >
        {uploading ? (
          <Loader2 className="size-3.5 animate-spin" />
        ) : (
          <Paperclip className="size-3.5" />
        )}
      </button>
    </>
  );
}

function size(bytes: number): string {
  return bytes >= 1048576
    ? `${(bytes / 1048576).toFixed(1)} MB`
    : `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** One attached file: what it is, and how it will reach the model. */
export function AttachmentChipView({
  attachment,
  support,
  onRemove,
}: {
  attachment: Attachment;
  support?: InputSupport | undefined;
  onRemove?: (() => void) | undefined;
}) {
  const meta = KIND_META[attachment.kind] ?? KIND_META.document;
  const Icon = meta.icon;
  const sentAs = support ? how(support, attachment.kind) : null;
  const converted = sentAs !== null && sentAs !== meta.native;
  return (
    <div
      className="inline-flex max-w-[240px] items-center gap-1.5 rounded-lg border border-border bg-background-elevated px-1.5 py-1 text-xs text-foreground"
      title={`${attachment.filename} · ${size(attachment.size)}${sentAs ? ` · sent ${sentAs}` : ""}`}
    >
      {attachment.kind === "image" ? (
        <img src={attachment.url} alt="" className="size-5 shrink-0 rounded object-cover" />
      ) : (
        <Icon className="size-4 shrink-0 text-muted-foreground" />
      )}
      <span className="min-w-0 truncate">{attachment.filename}</span>
      {sentAs ? (
        <span
          className={cn(
            "shrink-0 rounded px-1 text-[9px] font-medium tracking-wide uppercase",
            converted ? "bg-amber/15 text-amber" : "bg-surface-hover text-muted-foreground",
          )}
        >
          {sentAs}
        </span>
      ) : null}
      {onRemove ? (
        <button
          type="button"
          aria-label={`Remove ${attachment.filename}`}
          onClick={onRemove}
          className="shrink-0 text-muted-foreground hover:text-red"
        >
          <X className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
}

/** The files waiting to be sent with the next message. */
export function PendingAttachments({
  attachments,
  support,
  onRemove,
}: {
  attachments: Attachment[];
  support: InputSupport | undefined;
  onRemove: (uploadId: string) => void;
}) {
  if (!attachments.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-1.5">
      {attachments.map((a) => (
        <AttachmentChipView
          key={a.upload_id}
          attachment={a}
          support={support}
          onRemove={() => onRemove(a.upload_id)}
        />
      ))}
    </div>
  );
}
