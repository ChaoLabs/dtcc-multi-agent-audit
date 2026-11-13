import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Connection & analysis guide | DTCC",
  description:
    "Analyze Solidity in your browser, connect three Bedrock models, and review their findings.",
};

export default function GuidePage() {
  return (
    <div className="guide-shell">
      <a className="skip-link" href="#guide-content">
        Skip to guide
      </a>
      <header className="masthead">
        <div className="page-width masthead-inner">
          <Link href="/" className="brand" aria-label="DTCC home">
            <Image
              src="/dtcc-logo.png"
              alt="DTCC"
              width={116}
              height={28}
              priority
              unoptimized
            />
          </Link>
          <nav aria-label="Guide navigation">
            <Link href="/">Workspace</Link>
            <Link href="/documentation">Documentation</Link>
          </nav>
          <a
            className="repository-link"
            href="https://github.com/ChaoLabs/dtcc-multi-agent-audit"
            target="_blank"
            rel="noreferrer"
          >
            GitHub <Icon name="up" size={15} />
          </a>
        </div>
      </header>
      <main className="guide-content" id="guide-content">
        <Link className="guide-back" href="/">
          ← Return to workspace
        </Link>
        <div className="guide-heading">
          <p className="eyebrow">PLATFORM GUIDE</p>
          <h1>Connection &amp; analysis</h1>
          <p>
            Run Static Analysis or connect AWS Bedrock. Inspect first-round
            findings, initiate Second Review, then examine the Final Report.
          </p>
        </div>
        <nav className="guide-index" aria-label="Guide sections">
          <a href="#static">Static Analysis</a>
          <a href="#bedrock">Bedrock Review</a>
          <a href="#reports">Findings</a>
          <a href="#second-review">Second Review</a>
          <a href="#evaluation">Validate five cases</a>
          <a href="#local">Run locally</a>
        </nav>
        <section id="static" className="guide-section">
          <span className="guide-number">01</span>
          <div>
            <h2>Prepare the source and run Static Analysis</h2>
            <p>
              Choose a reference case, select <strong>Upload contract</strong>,
              or paste code using <strong>Edit source</strong>. To try the
              platform without an account, select{" "}
              <strong>Static Analysis</strong>, then
              <strong> Run Static Analysis</strong>. Source stays in your
              browser; no API key is required.
            </p>
            <p>
              The input limit is 48,000 UTF-8 bytes, 1,200 lines and 2,000
              characters per line. Imports are not resolved and source is not
              compiled. For the separate DAO example, open{" "}
              <strong>Reference cases → DAO Treasury</strong>. Zero findings is
              a valid result; the five-case validation set stays unchanged.
            </p>
          </div>
        </section>
        <section id="bedrock" className="guide-section">
          <span className="guide-number">02</span>
          <div>
            <h2>Connect and run Bedrock Review</h2>
            <p>
              One Bedrock key connects all three models. In your DevX AWS
              session, select <strong>US East (N. Virginia)</strong>, then open
              <strong> Amazon Bedrock → API keys → Short-term API keys</strong>
              and generate a key. Copy the complete value beginning
              <code> bedrock-api-key-</code>, without the export command or
              quotes.
            </p>
            <p>
              In the workspace, select <strong>Bedrock Review</strong>, paste
              the key and choose <strong>Use API key</strong>. Select
              <strong> Run Bedrock Review</strong> to run three independent
              analyses. The workspace stops at <strong>Findings</strong> for
              inspection. Second Review is a separate action; it never starts
              automatically. The hosted website requires no terminal.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>Models</dt>
                <dd>GPT-6 Astra, Claude Opus 5.5 and Grok 4.7.</dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>
                  us-east-1, with US cross-Region inference. Generate the key in
                  this Region.
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  Adding a key checks its format. Check all three model outcomes
                  after analysis to confirm their access.
                </dd>
              </div>
              <div>
                <dt>Expiry</dt>
                <dd>
                  Short-term keys last up to 12 hours, or until the generating
                  AWS session expires, whichever comes first.
                </dd>
              </div>
            </dl>
            <aside>
              API analysis sends your key and source through this site&apos;s
              server to AWS. Your AWS account&apos;s model permissions, logging
              settings and usage charges apply. Only submit source you are
              authorized to send. New reviews use Claude Opus 5.5; historical
              reports keep their original model identities. Each model reviews
              the source independently in the first round, without seeing static
              findings or peer results. An explicitly started second round can
              add up to nine model calls and shares selected peer claims for
              reassessment. Adding a key or changing modes does not start paid
              analysis.
            </aside>
            <p>
              The application holds your key only in this tab&apos;s memory and
              for the duration of a server request. It does not store keys in
              cookies, localStorage, a database or application logs. Refresh the
              page or select <strong>Clear key</strong> to remove the active
              connection.
            </p>
            <p>
              If a key expires, generate and enter a fresh one. If one model is
              denied access, ask your AWS administrator to check its permissions
              and first-use requirements. If a response is blocked by a content
              filter or guardrail, read the model explanation and keep the other
              results. Refreshing or replacing the key is not an established fix
              for filtering; ask your AWS administrator/provider to review the
              legitimate use case. The application does not rewrite or retry
              filtered input to bypass that decision.
            </p>
          </div>
        </section>
        <section id="reports" className="guide-section">
          <span className="guide-number">03</span>
          <div>
            <h2>Inspect the first-round Findings</h2>
            <p>
              Review <strong>Findings</strong> after Bedrock Review. Check how
              many models completed, compare their original contributions and
              inspect each finding&apos;s evidence and proposed severity. The
              review queue identifies omitted peer findings, severity disputes
              and missing coverage. The independent record remains unchanged
              when a second round is run.
            </p>
            <p>
              Model support tells you how many models agree with a finding. It
              is separate from severity, which describes the proposed impact.
              Agreement is not an accuracy score. Two successful initial checks
              and two successful assigned second-round reviews still leave
              overall coverage at two of three models.
            </p>
            <p>
              Each group keeps its original model findings. The highest proposed
              severity is displayed, with disagreements retained for inspection.
              Static results stay separate and do not count as a model vote.
              Download JSON or Markdown to preserve model outcomes, original
              reviews, consolidated findings, prompt settings, attempt history
              and source provenance.
            </p>
            <p>
              Pattern matches and model findings are review candidates. Matching
              a source excerpt does not establish exploitability. An empty
              result, partial coverage or a failed run does not establish
              safety.
            </p>
            <a
              className="guide-document"
              href="/docs/DTCC_Platform_Overview.pdf"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="file" />
              Platform overview &amp; review method
              <span>
                PDF <Icon name="up" size={14} />
              </span>
            </a>
          </div>
        </section>
        <section id="second-review" className="guide-section">
          <span className="guide-number">04</span>
          <div>
            <h2>Run Second Review, then open Final Report</h2>
            <p>
              Open <strong>Second Review</strong> after inspecting the
              first-round findings, then select{" "}
              <strong>Run Second Review</strong>. At least two successful
              initial reviews and actionable differences are required. Models
              reconsider peer findings they omitted and severity disputes. Empty
              assignments make no call; at most 12 claims are selected. A model
              that failed its initial review is not recovered by this stage. If
              no second review is eligible, read the stated reason before
              opening the available final report.
            </p>
            <p>
              Each model must answer <strong>Supported</strong>,{" "}
              <strong>Not supported</strong>, or <strong>Uncertain</strong>,
              with a rationale and exact source evidence. An assigned reviewer
              can change its position. If a reassessment fails, any valid
              first-round finding and its severity remain recorded, with that
              reassessment marked pending. Retained evidence is not a fresh
              confirmation. Accepted later uncertainty or rejection replaces the
              earlier position. The original independent report stays unchanged.
            </p>
            <p>
              Each stage allows three attempts per model and up to nine calls. A
              model that runs out of output tokens can try once with twice the
              allowance (32,768 to 65,536 tokens). The incomplete response is
              discarded. Temporary service failures and invalid evidence share
              the same attempt budget. Local reviews allow up to 11 minutes per
              model; the hosted site uses a shorter limit. The new response must
              pass all checks; no evidence is invented. Invalid access, blocked
              content and cancellation are not retried. Cancel or failure
              preserves accepted initial results. Closing the panel lets work
              continue; use its cancel control to stop. Already accepted AWS
              work may still be billed. There is no automatic debate loop.
            </p>
            <p>
              After a validated second-round result, including a partial result,
              select <strong>View Final Report</strong> to open it directly. A
              cancelled or failed request keeps the first-round findings and
              export available, without unlocking the final report solely
              because a request was attempted. The final report starts with risk
              priority, the reported risk and recommended action. Expand model
              judgments and source evidence for the audit trail. Pending
              reassessments, missing coverage and disputed severity remain
              visible even when all recorded opinions support a finding. Even
              unanimous support requires human validation.
            </p>
            <a
              className="guide-document"
              href="/docs/DTCC_Orchestration_Design.pdf"
              target="_blank"
              rel="noreferrer"
            >
              <Icon name="file" />
              Orchestration design &amp; evaluation protocol
              <span>
                PDF <Icon name="up" size={14} />
              </span>
            </a>
          </div>
        </section>
        <section id="evaluation" className="guide-section">
          <span className="guide-number">05</span>
          <div>
            <h2>Compare prompts on the same five cases</h2>
            <p>
              Open <strong>Review settings</strong> and choose
              <strong> Standard</strong> or <strong>Guided examples</strong>
              before Bedrock Review. Both use the same models and output rules.
              Guided examples add separate synthetic examples of grounded
              findings and benign lookalikes; they do not include answers from
              the reference contracts or another model&apos;s review.
            </p>
            <p>
              Within <strong>Review settings</strong>, open
              <strong> Validate 5 cases</strong> to run the five existing
              contracts one at a time. One prompt variant can make at most 45
              provider requests, including retries. Start the other variant
              separately when ready. Cancel to stop subsequent cases; completed
              records remain available for export.
            </p>
            <p>
              This batch has its own setting. Enable
              <strong> Include second review</strong> for a paired experiment:
              each case keeps its exact independent result and adds one eligible
              second review. This mode allows at most 90 provider requests and
              about 50 minutes per five-case batch. Cases with no eligible
              disagreements skip additional model calls. Access or rate-limit
              failures stop remaining cases rather than repeating them.
            </p>
            <p>
              Compare new support, withdrawn support, uncertain judgments, and
              unresolved candidates against the preserved first-pass findings.
              These are opinion changes, not confirmed corrections. Review false
              positives and missed vulnerabilities separately using the same
              criteria for both rounds.
            </p>
            <p>
              Download the evaluation JSON to compare completion, attempts,
              latency, available token usage and differences between findings.
              Returned token counters may omit failed-attempt usage. These are
              operational measures. Keep bounded run history or import a saved
              run, then import source-bound human adjudications. Quality metrics
              remain unavailable until their label requirements are met; recall
              also needs a complete reviewed issue inventory. Agreement alone
              does not establish improved accuracy.
            </p>
          </div>
        </section>
        <section id="local" className="guide-section">
          <span className="guide-number">06</span>
          <div>
            <h2>Run the workspace on your computer</h2>
            <p>
              Use Node.js 24 LTS. The optional Python backend requires Python
              3.12–3.14.
            </p>
            <pre>
              <code>{`git clone https://github.com/ChaoLabs/dtcc-multi-agent-audit.git
cd dtcc-multi-agent-audit
npm ci --prefix apps/web
npm --prefix apps/web run dev`}</code>
            </pre>
            <p>
              Open <code>http://127.0.0.1:3000</code>. If you already have the
              repository, run these commands from your existing checkout without
              cloning again.
            </p>
          </div>
        </section>
      </main>
    </div>
  );
}
