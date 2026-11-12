import { writeFileSync } from "node:fs";
import path from "node:path";

import { DEFAULT_PROJECT_ROOT } from "../agent/index.js";
import { expectedPath, readJson, runAllExamples } from "./examples.js";

const write = process.argv.includes("--write");
const all = await runAllExamples();
let mismatches = 0;

const targets: [string, unknown][] = [
  ...Object.entries(all.briefs).map(([name, runs]) => [name, runs.mock] as [string, unknown]),
  ...Object.entries(all.freeText).map(([name, output]) => [`free-text-${name}`, output] as [string, unknown]),
];

for (const [name, actual] of targets) {
  const file = expectedPath(DEFAULT_PROJECT_ROOT, name);
  if (write) {
    writeFileSync(file, `${JSON.stringify(actual, null, 2)}\n`);
    console.log(`WROTE ${path.relative(DEFAULT_PROJECT_ROOT, file)}`);
    continue;
  }
  let expected: unknown;
  try {
    expected = readJson(file);
  } catch {
    expected = undefined;
  }
  const same = JSON.stringify(expected) === JSON.stringify(actual);
  console.log(`${same ? "MATCH   " : "MISMATCH"} ${name}`);
  if (!same) mismatches += 1;
}

for (const [name, runs] of Object.entries(all.briefs)) {
  const same =
    runs.mock.businessStatus === runs.simulatedClaude.businessStatus &&
    runs.mock.score === runs.simulatedClaude.score &&
    runs.mock.executionStatus === runs.simulatedClaude.executionStatus;
  if (!write) console.log(`${same ? "SAME    " : "DIFFERS "} ${name} (mock vs simulated Claude)`);
  if (!same) mismatches += 1;
}

if (!write) {
  console.log(mismatches === 0 ? "\nAll examples match their expected outputs." : `\n${mismatches} mismatch(es).`);
  process.exitCode = mismatches === 0 ? 0 : 1;
}
