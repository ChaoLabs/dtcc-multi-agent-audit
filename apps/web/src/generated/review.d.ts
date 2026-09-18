export type SchemaVersion = "1.0.0";
export type SchemaVersion1 = "1.0.0";
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
export type Summary = string;
export type Title1 = string;
export type Category1 = string;
export type ProposedSeverity1 = "HIGH" | "MEDIUM" | "LOW";
export type Rationale1 = string;
export type Recommendation1 = string;
/**
 * @maxItems 24
 */
export type Findings = ReviewFinding[];
export type Provider = "aws-bedrock";
export type ModelId = string;
export type Region = string;
export type Protocol = "converse" | "mantle";
export type SourceSha2561 = string;
export type CreatedAt1 = string;
export type ElapsedMs = number;
export type InputTokens = number | null;
export type OutputTokens = number | null;

export interface EnhancedReport {
  schema_version: SchemaVersion;
  static_report: AuditReport;
  model_review: ModelReview;
}
export interface AuditReport {
  schema_version: SchemaVersion1;
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
export interface ModelReview {
  summary: Summary;
  findings: Findings;
  provider: Provider;
  model_id: ModelId;
  region: Region;
  protocol: Protocol;
  source_sha256: SourceSha2561;
  created_at: CreatedAt1;
  elapsed_ms: ElapsedMs;
  input_tokens: InputTokens;
  output_tokens: OutputTokens;
}
export interface ReviewFinding {
  title: Title1;
  category: Category1;
  proposed_severity: ProposedSeverity1;
  rationale: Rationale1;
  recommendation: Recommendation1;
  evidence: Evidence;
}
