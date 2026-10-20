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
            <a
              href="/docs/DTCC_Platform_Overview.pdf"
              target="_blank"
              rel="noreferrer"
            >
              Documentation <span className="nav-format">PDF</span>
            </a>
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
            Run static checks in your browser, or connect your own AWS Bedrock
            account for three independent model reviews.
          </p>
        </div>
        <nav className="guide-index" aria-label="Guide sections">
          <a href="#static">Static analysis</a>
          <a href="#bedrock">Connect Bedrock</a>
          <a href="#reports">Read the report</a>
          <a href="#local">Run locally</a>
        </nav>
        <section id="static" className="guide-section">
          <span className="guide-number">01</span>
          <div>
            <h2>Start with static analysis</h2>
            <p>
              Open a reference case, upload a single <code>.sol</code> file, or
              edit the source. Select <strong>Static analysis</strong> and run
              the check. Source stays in your browser; no API key is required.
            </p>
            <p>
              The input limit is 48,000 UTF-8 bytes, 1,200 lines and 2,000
              characters per line. Imports are not resolved and source is not
              compiled.
            </p>
          </div>
        </section>
        <section id="bedrock" className="guide-section">
          <span className="guide-number">02</span>
          <div>
            <h2>Connect AWS Bedrock</h2>
            <p>
              One Bedrock key connects all three models. In your DevX AWS
              session, select <strong>US East (N. Virginia)</strong>, then open
              <strong> Amazon Bedrock → API keys → Short-term API keys</strong>
              and generate a key. Copy the complete value beginning
              <code> bedrock-api-key-</code>, without the export command or
              quotes.
            </p>
            <p>
              In the workspace, select <strong>API analysis</strong>, paste the
              key and choose <strong>Use API key</strong>. Then select
              <strong> Run API analysis</strong> for your contract. The hosted
              website handles the full workflow; no terminal is required.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>Models</dt>
                <dd>GPT-6.1 Sol, Claude Opus 5.5 and Grok 4.7.</dd>
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
              settings and usage charges apply. Each model reviews the source
              independently, without seeing static findings or peer results.
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
              and first-use requirements. A partial run retains successful
              reviews and identifies failed models. No calls are retried
              automatically. Cancelling may not stop AWS work already in
              progress.
            </p>
          </div>
        </section>
        <section id="reports" className="guide-section">
          <span className="guide-number">03</span>
          <div>
            <h2>Review the evidence and export</h2>
            <p>
              Filter findings by severity or search by title, category or rule.
              Open a finding to read its rationale, source excerpt and
              recommended action. Select its line number to inspect the code.
            </p>
            <p>
              The orchestration layer groups compatible model findings by
              weakness and source location. One supporting model gives LOW
              agreement, two give MEDIUM, and three give HIGH. Agreement is
              separate from severity and does not represent a probability.
            </p>
            <p>
              Each group keeps its original model findings. The highest proposed
              severity is displayed, with disagreements retained for inspection.
              Static results stay separate and do not count as a model vote.
              Download JSON or Markdown to preserve model outcomes, original
              reviews, consolidated findings and source provenance.
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
        <section id="local" className="guide-section">
          <span className="guide-number">04</span>
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
