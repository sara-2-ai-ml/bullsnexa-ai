import { runAgentEvaluations } from "./agent-evaluations.js";

const report = await runAgentEvaluations();

for (const row of report.rows) {
  console.log(`${row.passed ? "PASS" : "FAIL"}  ${row.id}`);
  console.log(`      expected: ${row.expected}`);
  console.log(`      observed: ${row.observed}`);
  for (const entry of row.checks.filter((item) => !item.passed)) {
    console.log(`      failed check: ${entry.name}`);
  }
}
console.log(
  `\n${report.passed}/${report.total} evaluation cases passed (dataset ${report.datasetVersion}, today ${report.today}). Offline; no model API was called.`,
);
process.exitCode = report.failed === 0 ? 0 : 1;
