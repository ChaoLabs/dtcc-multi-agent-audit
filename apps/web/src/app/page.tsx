import Workspace from "@/components/workspace";
import cases from "@/generated/cases.json";
import supplementalCases from "@/generated/supplemental-cases.json";
import type { AuditReport } from "@/generated/report";

export default function Page() {
  // Validated by Python before generation; checked for drift in CI.
  return (
    <Workspace
      cases={
        [...cases, ...supplementalCases] as {
          id: string;
          title: string;
          summary: string;
          caveat: string;
          report: AuditReport;
        }[]
      }
    />
  );
}
