import { AlertCircle, Bot, Brain, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
import { AttachmentChipView } from "@/components/chat/AttachmentChip";
import { RuleOutcomeRow } from "@/components/rules/RuleOutcomeRow";
import type { Message } from "@/types";

export function MessageList({ messages }: { messages: Message[] }) {
  return (
    <div className="space-y-5">
      {messages.map((m) => (
        <MessageBubble key={m.id} message={m} />
      ))}
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  return (
    <div className={cn("flex gap-3", isUser && "flex-row-reverse")}>
      <div
        className={cn(
          "flex size-7 shrink-0 items-center justify-center rounded-lg border",
          isUser
            ? "border-primary/30 bg-primary/10 text-primary"
            : "border-border glass text-foreground",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl border px-4 py-3",
          isUser ? "border-primary/25 bg-primary/10 text-foreground" : "border-border glass",
        )}
      >
        {message.imageUrl ? (
          <img
            src={message.imageUrl}
            alt="attachment"
            className="mb-2 max-h-56 rounded-lg border border-border object-contain"
          />
        ) : null}
        {message.attachments?.length ? (
          <div className="mb-2 space-y-2">
            {message.attachments
              .filter((a) => a.kind === "image")
              .map((a) => (
                <img
                  key={a.upload_id}
                  src={a.url}
                  alt={a.filename}
                  className="max-h-56 rounded-lg border border-border object-contain"
                />
              ))}
            {message.attachments.some((a) => a.kind !== "image") ? (
              <div className="flex flex-wrap gap-1.5">
                {message.attachments
                  .filter((a) => a.kind !== "image")
                  .map((a) => (
                    <AttachmentChipView key={a.upload_id} attachment={a} />
                  ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {!isUser && message.thinking ? (
          <details
            open={message.streaming && !message.content}
            className="group/think mb-2 rounded-lg border border-border/60 bg-background/40 text-xs"
          >
            <summary className="flex cursor-pointer list-none items-center gap-1.5 px-2.5 py-1.5 text-muted-foreground select-none hover:text-foreground">
              <Brain
                className={cn("size-3.5", message.streaming && !message.content && "animate-pulse")}
              />
              {message.streaming && !message.content ? "Thinking…" : "Thought process"}
              <span className="ml-auto text-[10px] group-open/think:hidden">show</span>
              <span className="ml-auto hidden text-[10px] group-open/think:inline">hide</span>
            </summary>
            <div className="max-h-64 overflow-y-auto border-t border-border/60 px-2.5 py-2 leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {message.thinking}
            </div>
          </details>
        ) : null}
        {message.content ? (
          <Markdown content={message.content} />
        ) : message.error ? (
          <p className="flex items-start gap-1.5 text-xs text-red">
            <AlertCircle className="mt-0.5 size-3.5 shrink-0" />
            <span>{message.error}</span>
          </p>
        ) : message.streaming && !message.thinking ? (
          <span className="inline-flex gap-1">
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:150ms]" />
            <span className="size-1.5 animate-pulse rounded-full bg-muted-foreground [animation-delay:300ms]" />
          </span>
        ) : null}
        {!isUser && message.ruleOutcomes?.length ? (
          <RuleOutcomeRow outcomes={message.ruleOutcomes} />
        ) : null}
      </div>
    </div>
  );
}
