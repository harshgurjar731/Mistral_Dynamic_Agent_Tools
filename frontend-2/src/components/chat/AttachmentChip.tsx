import { Paperclip, X, Loader2 } from "lucide-react";
import { useRef } from "react";
import { toast } from "sonner";
import { uploadImage } from "@/api";
import { errorMessage } from "@/api/client";
import type { UploadResult } from "@/types";

const ACCEPT = "image/jpeg,image/png,image/webp,image/gif";

export function AttachmentControl({
  attachment,
  onAttach,
  onClear,
  uploading,
  setUploading,
  disabled,
}: {
  attachment: UploadResult | null;
  onAttach: (u: UploadResult) => void;
  onClear: () => void;
  uploading: boolean;
  setUploading: (v: boolean) => void;
  disabled?: boolean;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (file.size > 20 * 1024 * 1024) {
      toast.error("Image exceeds the 20MB limit.");
      return;
    }
    setUploading(true);
    try {
      const result = await uploadImage(file);
      onAttach(result);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  if (attachment) {
    return (
      <div className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-background-elevated px-1.5 py-1 text-xs text-foreground">
        <img
          src={attachment.image_url}
          alt="attachment preview"
          className="size-5 rounded object-cover"
        />
        <span className="max-w-[100px] truncate">{attachment.filename}</span>
        <button type="button" aria-label="Remove attachment" onClick={onClear} className="text-muted-foreground hover:text-red">
          <X className="size-3.5" />
        </button>
      </div>
    );
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
      <button
        type="button"
        disabled={disabled || uploading}
        onClick={() => inputRef.current?.click()}
        title="Attach image (JPG, PNG, WebP, GIF — max 20MB)"
        aria-label="Attach image"
        className="inline-flex size-8 items-center justify-center rounded-xl border border-border glass text-muted-foreground transition hover:bg-surface-hover hover:text-foreground disabled:opacity-50"
      >
        {uploading ? <Loader2 className="size-3.5 animate-spin" /> : <Paperclip className="size-3.5" />}
      </button>
    </>
  );
}
