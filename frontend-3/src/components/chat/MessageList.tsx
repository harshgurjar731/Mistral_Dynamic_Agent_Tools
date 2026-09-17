import { Bot, User } from "lucide-react";
import { cn } from "@/lib/utils";
import { Markdown } from "@/components/chat/Markdown";
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
          isUser ? "border-primary/30 bg-primary/10 text-primary" : "border-border glass text-foreground",
        )}
      >
        {isUser ? <User className="size-3.5" /> : <Bot className="size-3.5" />}
      </div>
      <div
        className={cn(
          "min-w-0 max-w-[85%] rounded-2xl border px-4 py-3",
          isUser
            ? "border-primary/25 bg-primary/10 text-foreground"
            : "border-border glass",
        )}
      >
        {message.imageUrl ? (
          <img
            src={message.imageUrl}
            alt="attachment"
            className="mb-2 max-h-56 rounded-lg border border-border object-contain"
          />
        ) : null}
        {message.content ? (
          <Markdown content={message.content} />
        ) : message.streaming ? (
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
