export type SchemaVersion = "1.0.0";
export type RunId = string;
export type CreatedAt = string;
export type Execution = "recorded" | "local" | "browser";
export type Mode = "static";
export type Engine = "legacy-static-rules" | "browser-static-rules";
export type EngineVersion = "0.1.0";
export type SourceSha256 = string;
export type Filename = string;
export type Source = string;
export type Id = string;
export type RuleId = string;
export type Title = string;
export type Category = string;
export type ProposedSeverity = "HIGH" | "MEDIUM" | "LOW";
export type Disposition = "needs-review";
export type Rationale = string;
export type Recommendation = string;
export type LineStart = number;
export type LineEnd = number;
export type Excerpt = string;
export type Validation = "source-bound";
export type Origin = "legacy-static-rules" | "browser-static-rules";
export type Candidates = Candidate[];
export type Name =
  "Static rules" | "Three-model analysis" | "Orchestration" | "Human review";
export type Status = "completed" | "not-implemented" | "not-performed";
export type Stages = Stage[];
export type Limitations = string[];

export interface AuditReport {
  schema_version: SchemaVersion;
  run_id: RunId;
  created_at: CreatedAt;
  execution: Execution;
  mode: Mode;
  engine: Engine;
  engine_version: EngineVersion;
  source_sha256: SourceSha256;
  input: AuditInput;
  candidates: Candidates;
  stages: Stages;
  limitations: Limitations;
}
export interface AuditInput {
  filename: Filename;
  source: Source;
}
export interface Candidate {
  id: Id;
  rule_id: RuleId;
  title: Title;
  category: Category;
  proposed_severity: ProposedSeverity;
  disposition: Disposition;
  rationale: Rationale;
  recommendation: Recommendation;
  evidence: Evidence;
  origin: Origin;
}
export interface Evidence {
  line_start: LineStart;
  line_end: LineEnd;
  excerpt: Excerpt;
  validation: Validation;
}
export interface Stage {
  name: Name;
  status: Status;
}
