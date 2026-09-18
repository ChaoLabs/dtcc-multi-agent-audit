import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Connection & analysis guide | DTCC",
  description:
    "Use browser analysis, connect AWS Bedrock, or run the workspace locally.",
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
            account for model-assisted review.
          </p>
        </div>
        <nav className="guide-index" aria-label="Guide sections">
          <a href="#static">Static analysis</a>
          <a href="#local">Run locally</a>
          <a href="#bedrock">Connect Bedrock</a>
          <a href="#reports">Read the report</a>
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
        <section id="local" className="guide-section">
          <span className="guide-number">02</span>
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
        <section id="bedrock" className="guide-section">
          <span className="guide-number">03</span>
          <div>
            <h2>Connect AWS Bedrock</h2>
            <p>
              Select <strong>API analysis</strong>, paste a valid Bedrock API
              key, then choose <strong>Use API key</strong>. Return to your
              contract and choose <strong>Run API analysis</strong>. This works
              on the hosted website and locally; no Python server is needed for
              the web workflow.
            </p>
            <dl className="guide-definitions">
              <div>
                <dt>Model</dt>
                <dd>GPT-6 Astra via Amazon Bedrock Converse.</dd>
              </div>
              <div>
                <dt>Region</dt>
                <dd>
                  us-east-1, using the US inference profile{" "}
                  <code>us.openai.gpt-6-astra</code>.
                </dd>
              </div>
              <div>
                <dt>Connection</dt>
                <dd>
                  Key format is checked when you add it. AWS access is verified
                  only by a successful analysis.
                </dd>
              </div>
            </dl>
            <aside>
              Running analysis sends your key, source and static candidates
              through this site&apos;s server to AWS. Your AWS account&apos;s
              model access, logging settings and usage charges apply.
            </aside>
            <p>
              The application holds your key only in this tab&apos;s memory and
              for the duration of a server request. It does not store keys in
              cookies, localStorage, a database or application logs. Refresh the
              page or select <strong>Clear key</strong> to remove the active
              connection.
            </p>
            <p>
              If access is denied, reopen API analysis and replace an expired
              key, or verify your AWS account can invoke this model. Invalid
              model evidence is rejected and static results remain available.
              Cancelling stops the browser wait; AWS may already have processed
              the request.
            </p>
          </div>
        </section>
        <section id="reports" className="guide-section">
          <span className="guide-number">04</span>
          <div>
            <h2>Review the evidence and export</h2>
            <p>
              Filter findings by severity or search by title, category or rule.
              Open a finding to read its rationale, source excerpt and
              recommended action. Select its line number to inspect the code.
            </p>
            <p>
              Static and Bedrock findings are labeled separately. Report details
              show source provenance and the source hash. Download JSON for
              structured data or Markdown for a readable record.
            </p>
            <p>
              Pattern matches and model findings are review candidates. Matching
              a source excerpt does not establish exploitability, and an empty
              result does not establish safety.
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
      </main>
    </div>
  );
}
