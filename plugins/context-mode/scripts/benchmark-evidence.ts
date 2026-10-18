/** Metrics-only offline replay; evidence and databases are removed before output. */
import { writeFileSync } from 'node:fs';
import { runEvidenceBenchmark } from '../tests/evidence/efficiency-benchmark.js';
const report=await runEvidenceBenchmark();
const output=JSON.stringify(report,null,2)+'\n';
if(process.argv[2])writeFileSync(process.argv[2],output,{mode:0o600});
else process.stdout.write(output);
if(Object.values(report.criteria).some(passed=>!passed))process.exitCode=1;
