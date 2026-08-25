import { Prism as SyntaxHighlighter } from "react-syntax-highlighter";
import { oneDark } from "react-syntax-highlighter/dist/esm/styles/prism";
import { cn } from "@/lib/utils";

export function CodeBlock({
  code,
  language = "python",
  className,
}: {
  code: string;
  language?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "overflow-hidden rounded-xl border border-border bg-background-elevated",
        className,
      )}
    >
      <SyntaxHighlighter
        language={language}
        style={oneDark}
        customStyle={{ margin: 0, background: "transparent", fontSize: "0.78rem", padding: "0.9rem" }}
        codeTagProps={{ style: { fontFamily: "var(--font-mono)" } }}
      >
        {code || " "}
      </SyntaxHighlighter>
    </div>
  );
}
