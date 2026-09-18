import { test, expect } from "@playwright/test";
import { analyzeStatic, validateInput } from "../src/lib/static-analysis";
import { validateResponse } from "../src/lib/report";
import cases from "../src/generated/cases.json";

test("browser scanner agrees with historical reference rule locations and severity", async () => {
  for (const item of cases) {
    const report = await analyzeStatic(
      item.report.input.filename,
      item.report.input.source,
    );
    const select = (r: {
      rule_id: string;
      proposed_severity: string;
      evidence: { line_start: number };
    }) => [r.rule_id, r.proposed_severity, r.evidence.line_start];
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
test("browser detects all 15 rules with real API parity", async ({
  request,
}) => {
  const source = `pragma solidity ^0.7.0;
contract C {
 address owner;
 mapping(address=>uint) balances;
 function withdraw() public {
  msg.sender.call{value: 1}("");
  balances[msg.sender]=0;
 }
 function pay() public {
  msg.sender.transfer(1);
 }
 function changeOwner() public {
  owner=msg.sender;
 }
 function gamble() public {
  require(tx.origin==owner);
  msg.sender.send(1);
  address(1).delegatecall("");
  selfdestruct(msg.sender);
  uint random=block.number;
  C(msg.sender).gamble();
  require(block.timestamp>0);
  while(true) {}
 }
 function play() public {
  uint n=players[0].number + players[1].number;
  players[n%2];
 }
}`;
  const found = new Set<string>();
  for (const text of [source, source.replace("pragma solidity ^0.7.0;", "")]) {
    const report = await analyzeStatic("Rules.sol", text);
    const response = await request.post("http://127.0.0.1:8000/api/audits", {
      data: { filename: "Rules.sol", source: text },
    });
    expect(response.ok()).toBe(true);
    const server = await response.json();
    const select = (r: {
      rule_id: string;
      proposed_severity: string;
      evidence: { line_start: number };
    }) => `${r.rule_id}|${r.proposed_severity}|${r.evidence.line_start}`;
    expect(report.candidates.map(select).sort()).toEqual(
      server.candidates.map(select).sort(),
    );
    report.candidates.forEach((item) => found.add(item.rule_id));
  }
  expect(found.size).toBe(15);
});
test("browser limits invalid input before analysis", () => {
  for (const source of [
    "",
    "\u0000",
    "x".repeat(2001),
    "x\n".repeat(1201),
    "\ud800",
    "a\u2028b",
    ("合".repeat(1000) + "\n").repeat(17),
  ])
    expect(() => validateInput("C.sol", source)).toThrow();
  expect(() => validateInput("../secret.sol", "contract C {}")).toThrow();
});
test("newline, unicode and evidence hashes are preserved", async () => {
  const source =
    "pragma solidity ^0.8.20;\r\n// 中文备注\r\ncontract C {function f() public {require(tx.origin == msg.sender);}}\r\n";
  const report = await analyzeStatic("C.sol", source);
  expect(report.input.source).toBe(source);
  expect(report.candidates[0].evidence.line_start).toBe(3);
  await validateResponse(report, "C.sol", source, "browser");
  const corrupted = structuredClone(report);
  corrupted.candidates[0].evidence.excerpt = "made up";
  await expect(
    validateResponse(corrupted, "C.sol", source, "browser"),
  ).rejects.toThrow();
});
