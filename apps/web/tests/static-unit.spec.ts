import { test, expect } from "@playwright/test";
import { analyzeStatic, maskNonCode, sha256 } from "../src/lib/static-analysis";
import { validateResponse } from "../src/lib/report";
import regressions from "../../../tests/static_regressions.json";
import cases from "../src/generated/cases.json";

for (const item of regressions) {
  test(`static lexical regression: ${item.name}`, async () => {
    const report = await analyzeStatic("Regression.sol", item.source);
    expect(
      report.candidates.map((finding) => [
        finding.rule_id,
        finding.proposed_severity,
        finding.evidence.line_start,
      ]),
    ).toEqual(item.expected);
    expect(report.input.source).toBe(item.source);
    await validateResponse(report, "Regression.sol", item.source, "browser");
  });
}

test("static scanner preserves the five recorded Python reference outcomes", async () => {
  for (const item of cases) {
    const report = await analyzeStatic(
      item.report.input.filename,
      item.report.input.source,
    );
    const select = (finding: {
      rule_id: string;
      proposed_severity: string;
      evidence: { line_start: number };
    }) => [
      finding.rule_id,
      finding.proposed_severity,
      finding.evidence.line_start,
    ];
    expect(report.candidates.map(select)).toEqual(
      item.report.candidates.map(select),
    );
    await validateResponse(
      report,
      report.input.filename,
      report.input.source,
      "browser",
    );
  }
});

test("lexical masking preserves UTF-16 offsets and CRLF without exposing literals", () => {
  const source = 'a/* 中文🙂 \r\n } */b; "http://x/\\\"}"; // tail\r\nc';
  const masked = maskNonCode(source);
  expect(masked.length).toBe(source.length);
  const endings = (value: string) =>
    [...value.matchAll(/[\r\n]/g)].map((match) => [match.index, match[0]]);
  expect(endings(masked)).toEqual(endings(source));
  expect(masked).not.toContain("}");
  expect(masked).not.toContain("tail");
  expect(masked[0]).toBe("a");
  expect(masked.at(-1)).toBe("c");
});

for (const version of ["0.1.0", "0.1.1"] as const) {
  test(`static report accepts ${version} and binds IDs to the declared engine`, async () => {
    const item = cases[0];
    const report = await analyzeStatic(
      item.report.input.filename,
      item.report.input.source,
    );
    expect(report.engine_version).toBe("0.1.1");
    const historical = structuredClone(report);
    historical.engine_version = version;
    for (const finding of historical.candidates) {
      finding.id = (
        await sha256(
          `${historical.engine}@${version}|${historical.source_sha256}|${finding.rule_id}|${finding.evidence.line_start}`,
        )
      ).slice(0, 24);
    }
    await validateResponse(
      historical,
      report.input.filename,
      report.input.source,
      "browser",
    );
    if (version === "0.1.0")
      expect(historical.candidates[0].id).not.toBe(report.candidates[0].id);
    historical.engine_version = version === "0.1.0" ? "0.1.1" : "0.1.0";
    await expect(
      validateResponse(
        historical,
        report.input.filename,
        report.input.source,
        "browser",
      ),
    ).rejects.toThrow("Report evidence does not match");
    await expect(
      validateResponse(
        { ...report, engine_version: "99.0.0" },
        report.input.filename,
        report.input.source,
        "browser",
      ),
    ).rejects.toThrow();
  });
}
