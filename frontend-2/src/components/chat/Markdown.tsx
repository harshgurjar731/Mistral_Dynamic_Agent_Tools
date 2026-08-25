import { memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

export const Markdown = memo(function Markdown({
  content,
  className,
}: {
  content: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "prose-invert max-w-none text-sm leading-relaxed text-foreground/90",
        "[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2",
        "[&_h1]:mt-4 [&_h1]:mb-2 [&_h1]:text-lg [&_h1]:font-semibold",
        "[&_h2]:mt-4 [&_h2]:mb-2 [&_h2]:text-base [&_h2]:font-semibold",
        "[&_h3]:mt-3 [&_h3]:mb-1.5 [&_h3]:text-sm [&_h3]:font-semibold",
        "[&_p]:my-2 [&_ul]:my-2 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:my-2 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_li]:my-1",
        "[&_blockquote]:my-3 [&_blockquote]:border-l-2 [&_blockquote]:border-primary/40 [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground",
        "[&_table]:my-3 [&_table]:w-full [&_table]:border-collapse [&_table]:text-xs",
        "[&_th]:border [&_th]:border-border [&_th]:bg-surface [&_th]:px-2 [&_th]:py-1.5 [&_th]:text-left",
        "[&_td]:border [&_td]:border-border [&_td]:px-2 [&_td]:py-1.5",
        "[&_hr]:my-4 [&_hr]:border-border",
        className,
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          code({ className: codeClass, children, ...props }) {
            const match = /language-(\w+)/.exec(codeClass ?? "");
            const text = String(children).replace(/\n$/, "");
            const inline = !codeClass && !text.includes("\n");
            if (inline) {
              return (
                <code
                  className="rounded-md border border-border bg-background-elevated px-1.5 py-0.5 font-mono text-[0.8em] text-cyan"
                  {...props}
                >
                  {children}
                </code>
              );
            }
            return (
              <div className="my-3 overflow-hidden rounded-xl border border-border bg-background-elevated">
                {match ? (
                  <div className="border-b border-border px-3 py-1.5 font-mono text-[10px] tracking-wider text-muted-foreground uppercase">
                    {match[1]}
                  </div>
                ) : null}
                <SyntaxHighlighter
                  language={match?.[1] ?? "text"}
                  style={oneDark}
                  customStyle={{
                    margin: 0,
                    background: "transparent",
                    fontSize: "0.78rem",
                    padding: "0.9rem",
                  }}
                  codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
                >
                  {text}
                </SyntaxHighlighter>
              </div>
            );
          },
        }}
      >
        {content}
      </ReactMarkdown>
    </div>
  );
});
