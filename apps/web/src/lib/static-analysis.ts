import type { AuditReport, Candidate } from "@/generated/report";
import catalog from "@/generated/rule-catalog.json";

export const sourceLines = (source: string) => {
  const lines = source.split(/\r\n|\r|\n/);
  if (lines.at(-1) === "") lines.pop();
  return lines;
};
export async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export function validateInput(filename: string, source: string) {
  if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}\.sol$/.test(filename))
    throw new Error(
      "Use a .sol filename with letters, numbers, dots, underscores or hyphens.",
    );
  if (!source.trim())
    throw new Error("Add Solidity source before running analysis.");
  if (new TextEncoder().encode(source).length > 48_000)
    throw new Error("Source exceeds 48,000 UTF-8 bytes.");
  if (
    !source.isWellFormed() ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f\u0085\u2028\u2029]/.test(source)
  )
    throw new Error("Use valid UTF-8 source with LF or CRLF line endings.");
  const lines = sourceLines(source);
  if (lines.length > 1200 || lines.some((line) => [...line].length > 2000))
    throw new Error("Source exceeds 1,200 lines or 2,000 characters per line.");
}

type Rule = keyof typeof catalog;
type Match = { rule: Rule; line: number };
/** Browser port of the inherited 15 rule heuristics. No compilation or network I/O. */
export async function analyzeStatic(
  filename: string,
  source: string,
): Promise<AuditReport> {
  validateInput(filename, source);
  const lines = sourceLines(source);
  const funcs: { name: string; start: number; end: number }[] = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /\b(function\s+(\w+)|constructor|fallback|receive)\b/.exec(
      lines[i],
    );
    if (!match) continue;
    let depth = 0,
      started = false,
      end = i;
    for (; end < lines.length; end++) {
      depth +=
        (lines[end].match(/\{/g)?.length ?? 0) -
        (lines[end].match(/\}/g)?.length ?? 0);
      if (lines[end].includes("{")) started = true;
      if (started && depth <= 0) break;
    }
    funcs.push({
      name: match[2] || match[1],
      start: i + 1,
      end: Math.min(end + 1, lines.length),
    });
    i = end;
  }
  const found: Match[] = [];
  const add = (rule: Rule, line: number) => {
    if (!found.some((item) => item.rule === rule && item.line === line))
      found.push({ rule, line });
  };
  if (!/\bpragma\s+solidity\b/.test(source)) add("SC-008", 1);
  const writes = lines.flatMap((line, i) =>
    /balances\[.*\]\s*(=|-=|\+=)/.test(line) ? [i + 1] : [],
  );
  let randomness = false,
    parity = false;
  lines.forEach((line, index) => {
    const n = index + 1;
    if (line.trim().startsWith("//") || line.trim().startsWith("*")) return;
    if (/\.call\{value:/.test(line)) {
      const fn = funcs.find((fn) => fn.start <= n && n <= fn.end);
      if (fn && writes.some((w) => fn.start <= w && w <= fn.end && w > n))
        add("SC-001", n);
      if (!line.split(".call")[0].includes("=") && !/\brequire\s*\(/.test(line))
        add("SC-002", n);
    }
    if (
      /\.send\s*\(/.test(line) &&
      !line.split(".send")[0].includes("=") &&
      !/\brequire\s*\(/.test(line)
    )
      add("SC-003", n);
    if (/\.delegatecall\s*\(/.test(line)) add("SC-004", n);
    if (line.includes("tx.origin") && /require|==|if/.test(line))
      add("SC-005", n);
    if (/selfdestruct\s*\(/.test(line)) add("SC-006", n);
    if (/pragma solidity\s*\^?0\.[4-7]\./.test(line)) add("SC-007", n);
    if (
      !randomness &&
      /\b(blockhash|block\.timestamp|block\.difficulty|block\.prevrandao|block\.number)\b/.test(
        line,
      ) &&
      /\b(random|guess|answer|keccak256|winner|lottery)\b/i.test(source)
    ) {
      add("SC-009", n);
      randomness = true;
    }
    if (/\w+\s*\(\s*msg\.sender\s*\)\s*\.\w+\s*\(/.test(line)) add("SC-010", n);
    if (
      !parity &&
      /players\s*\[\s*\w+\s*%\s*2\s*\]/.test(line) &&
      /players\s*\[\s*0\s*\]\.number\s*\+\s*players\s*\[\s*1\s*\]\.number/.test(
        source,
      )
    ) {
      add("SC-011", n);
      parity = true;
    }
  });
  for (const fn of funcs) {
    const body = lines.slice(fn.start - 1, fn.end).join("\n"),
      header = lines[fn.start - 1];
    if (
      !["constructor", "receive", "fallback"].includes(fn.name) &&
      /\b(public|external)\b/.test(header) &&
      !/\bonly\w*\b/.test(header) &&
      !/\brequire\s*\(/.test(body)
    ) {
      const owner = lines
        .slice(fn.start - 1, fn.end)
        .findIndex((line) => /\bowner\s*=/.test(line) && !line.includes("=="));
      if (owner !== -1) add("SC-012", fn.start + owner);
    }
    if (/for\s*\([^;]*;[^;]*\.length/.test(body) || /while\s*\(/.test(body)) {
      const loop = lines
        .slice(fn.start - 1, fn.end)
        .findIndex((line) => /\b(for|while)\s*\(/.test(line));
      add("SC-015", fn.start + Math.max(0, loop));
    }
  }
  lines.forEach((line, index) => {
    const n = index + 1;
    if (
      /\b(block\.timestamp|now)\b/.test(line) &&
      /require|if|transfer|call|winner|release|unlock/i.test(line)
    )
      add("SC-013", n);
    if (/\.(transfer|send)\s*\(|\.call\s*\{\s*value/.test(line)) {
      const fn = funcs.find((fn) => fn.start <= n && n <= fn.end);
      if (fn) {
        const header = lines[fn.start - 1],
          body = lines.slice(fn.start - 1, fn.end).join("\n");
        const guarded =
          /\bonly\w*\b/.test(header) ||
          /require\s*\(\s*(?:msg\.sender|tx\.origin)\s*==/.test(body);
        if (
          /\b(public|external)\b/.test(header) &&
          !guarded &&
          fn.name !== "withdraw"
        )
          add("SC-014", n);
      }
    }
  });
  const order = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  found.sort(
    (a, b) =>
      order[catalog[a.rule].proposed_severity as keyof typeof order] -
        order[catalog[b.rule].proposed_severity as keyof typeof order] ||
      a.line - b.line,
  );
  const hash = await sha256(source);
  const candidates: Candidate[] = await Promise.all(
    found.map(async ({ rule, line }) => ({
      ...catalog[rule],
      proposed_severity: catalog[rule]
        .proposed_severity as Candidate["proposed_severity"],
      id: (
        await sha256(`browser-static-rules@0.1.0|${hash}|${rule}|${line}`)
      ).slice(0, 24),
      rule_id: rule,
      disposition: "needs-review",
      origin: "browser-static-rules",
      evidence: {
        line_start: line,
        line_end: line,
        excerpt: lines[line - 1],
        validation: "source-bound",
      },
    })),
  );
  return {
    schema_version: "1.0.0",
    run_id: crypto.randomUUID(),
    created_at: new Date().toISOString(),
    execution: "browser",
    mode: "static",
    engine: "browser-static-rules",
    engine_version: "0.1.0",
    source_sha256: hash,
    input: { filename, source },
    candidates,
    stages: [
      { name: "Static rules", status: "completed" },
      { name: "Three-model analysis", status: "not-implemented" },
      { name: "Orchestration", status: "not-implemented" },
      { name: "Human review", status: "not-performed" },
    ],
    limitations: [
      "Browser port of 15 inherited regex rules; not an AST or compiler.",
      "Comments, naming and formatting can cause false positives and misses.",
      "Source-bound evidence proves a location, not exploitability. All candidates require review.",
      "No Bedrock model or multi-agent orchestration ran. No findings does not mean safe.",
    ],
  };
}
