import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Icon } from "@/components/icons";

export const metadata: Metadata = {
  title: "Documentation | DTCC",
  description:
    "Platform overview and orchestration design for multi-agent smart contract audit and cybersecurity risk assessment.",
};

const documents = [
  {
    title: "Platform overview",
    kind: "PLATFORM GUIDE",
    pages: 8,
    filename: "DTCC_Platform_Overview.pdf",
    description:
      "Static analysis, independent Bedrock review, second-round judgments and the final evidence report.",
    topics: [
      "Static Analysis and Bedrock Review",
      "First-round findings and Final Report",
      "Second Review and human evaluation",
    ],
  },
  {
    title: "Orchestration design",
    kind: "DESIGN BRIEF",
    pages: 3,
    filename: "DTCC_Orchestration_Design.pdf",
    description:
      "How independent findings and an explicitly initiated Second Review form a traceable final report.",
    topics: [
      "Independent reviews and disagreement handling",
      "Targeted assignments and typed decisions",
      "Retry limits, filtering outcomes and evaluation",
    ],
  },
] as const;

export default function DocumentationPage() {
  return (
    <div className="documentation-shell">
      <a className="skip-link" href="#documentation-content">
        Skip to documentation
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
          <nav aria-label="Documentation navigation">
            <Link href="/">Workspace</Link>
            <Link
              href="/documentation"
              className="nav-active"
              aria-current="page"
            >
              Documentation
            </Link>
          </nav>
          <a
            className="repository-link"
            href="https://github.com/ChaoLabs/dtcc-multi-agent-audit"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub <Icon name="up" size={15} />
          </a>
        </div>
      </header>
      <main className="documentation-content" id="documentation-content">
        <Link className="guide-back" href="/">
          ← Return to workspace
        </Link>
        <div className="documentation-heading">
          <p className="eyebrow">DIGITAL ASSET SECURITY</p>
          <h1>Documentation</h1>
          <p>Understand the platform. Explore the method behind each review.</p>
        </div>
        <div className="documentation-grid">
          {documents.map((document) => (
            <article className="document-card" key={document.filename}>
              <div className="document-card-meta">
                <span>{document.kind}</span>
                <span>PDF · {document.pages} pages</span>
              </div>
              <h2>{document.title}</h2>
              <p className="document-card-description">
                {document.description}
              </p>
              <ul className="document-card-topics">
                {document.topics.map((topic) => (
                  <li key={topic}>{topic}</li>
                ))}
              </ul>
              <div className="document-card-actions">
                <a
                  className="document-open"
                  href={`/docs/${document.filename}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${document.title} PDF`}
                >
                  Open PDF <Icon name="up" size={15} />
                </a>
                <a
                  className="document-download"
                  href={`/docs/${document.filename}`}
                  download={document.filename}
                  aria-label={`Download ${document.title} PDF`}
                >
                  Download <Icon name="download" size={15} />
                </a>
              </div>
            </article>
          ))}
        </div>
        <div className="documentation-guide">
          <p>Set up a connection or walk through an analysis.</p>
          <Link href="/guide">
            Connection &amp; analysis guide <Icon name="arrow" size={16} />
          </Link>
        </div>
      </main>
    </div>
  );
}
