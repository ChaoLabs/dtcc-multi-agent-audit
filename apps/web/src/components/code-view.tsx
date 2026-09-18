import { Fragment, type RefObject } from "react";

function tokens(line: string) {
  return line
    .split(
      /(\/\/.*$|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\b(?:pragma|solidity|contract|interface|library|function|constructor|receive|fallback|mapping|address|uint\d*|int\d*|bool|bytes\d*|string|public|private|external|internal|payable|view|pure|returns|return|require|if|else|for|while|event|emit|modifier|memory|storage|calldata|true|false)\b|\b\d+\b)/g,
    )
    .filter(Boolean)
    .map((token, i) => {
      const kind = token.startsWith("//")
        ? "comment"
        : /^["']/.test(token)
          ? "string"
          : /^\d+$/.test(token)
            ? "number"
            : /^(pragma|solidity|contract|interface|library|function|constructor|receive|fallback|mapping|address|uint\d*|int\d*|bool|bytes\d*|string|public|private|external|internal|payable|view|pure|returns|return|require|if|else|for|while|event|emit|modifier|memory|storage|calldata|true|false)$/.test(
                  token,
                )
              ? "keyword"
              : "plain";
      return (
        <span className={`syntax-${kind}`} key={i}>
          {token}
        </span>
      );
    });
}
export function CodeView({
  source,
  active,
  viewRef,
}: {
  source: string;
  active?: { line_start: number; line_end: number };
  viewRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div
      ref={viewRef}
      className="code-view"
      tabIndex={0}
      role="region"
      aria-label="Solidity source snapshot"
    >
      <pre>
        <code>
          {source.split(/\r\n|\r|\n/).map((line, index) => (
            <span
              key={index}
              data-line={index + 1}
              className={`code-line ${active && index + 1 >= active.line_start && index + 1 <= active.line_end ? "highlight" : ""}`}
            >
              <span className="line-number" aria-hidden="true">
                {index + 1}
              </span>
              <span>
                <Fragment>{tokens(line || " ")}</Fragment>
              </span>
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
