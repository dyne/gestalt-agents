"""Executable scenarios use Node's JUnit report, not a generic terminal parser."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import xml.etree.ElementTree as ET

ROOT = Path(sys.argv.pop(1)).resolve()
FIXTURE = ROOT / 'tests/plugins/gestalt/test-execution-fixture.mjs'
IDENTITY = 'selected concurrency regression'


class ExecutionEvidence(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='execution scenarios ')
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name)

    def run_scenario(self, scenario, pattern=IDENTITY, expected_exit=0):
        evidence = self.path / f'{scenario}.json'
        result = subprocess.run(['node', '--test', '--test-reporter=junit',
                                 f'--test-name-pattern={pattern}', str(FIXTURE)],
                                env=dict(os.environ, EXECUTION_SCENARIO=scenario,
                                         EXECUTION_EVIDENCE=str(evidence)),
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, expected_exit, result.stderr)
        report = ET.fromstring(result.stdout)
        cases = report.findall('.//testcase')
        # Some Node versions report the file wrapper as one pass when no named
        # tests match. Count our known identities, not that wrapper case.
        identities = {IDENTITY, 'unrelated smoke'}
        executed = [case for case in cases if case.find('skipped') is None
                    and case.attrib['name'] in identities]
        failures = [case for case in executed if case.find('failure') is not None]
        summary = dict(identities=[case.attrib['name'] for case in executed],
                       executed=len(executed), failed=len(failures),
                       skipped=sum(case.find('skipped') is not None for case in cases),
                       runner_cases=len(cases))
        self.assertEqual(summary['failed'], expected_exit)
        if evidence.exists():
            artifact = json.loads(evidence.read_text())
            self.assertEqual(artifact['identity'], IDENTITY)
            self.assertEqual(artifact['preconditions'], ['first', 'second'])
            self.assertEqual(artifact['released'], ['first', 'second'])
            self.assertEqual(artifact['completed'], 2)
            self.assertEqual(artifact['pendingAfterCleanup'], 0)
        else:
            artifact = None
        return summary, artifact, failures

    def test_intended_test_executes_and_cleanup_finishes(self):
        summary, artifact, _ = self.run_scenario('passing')
        self.assertEqual(summary['identities'], [IDENTITY])
        self.assertEqual(summary['executed'], 1)
        self.assertEqual(artifact['productResult'], 2)

    def test_wrong_suite_is_unverified_even_with_exit_zero(self):
        summary, artifact, _ = self.run_scenario('wrong-suite', pattern='unrelated smoke')
        self.assertEqual(summary['identities'], ['unrelated smoke'])
        self.assertNotIn(IDENTITY, summary['identities'])
        self.assertIsNone(artifact)

    def test_zero_matches_is_unverified(self):
        summary, artifact, _ = self.run_scenario('zero-matches', pattern='no such identity')
        self.assertEqual(summary['executed'], 0)
        self.assertIsNone(artifact)

    def test_all_skipped_is_unverified(self):
        summary, artifact, _ = self.run_scenario('all-skipped', pattern='.*')
        self.assertEqual(summary['executed'], 0)
        self.assertGreater(summary['skipped'], 0)
        self.assertIsNone(artifact)

    def test_expected_before_fix_regression_failure(self):
        summary, artifact, failures = self.run_scenario('expected-regression', expected_exit=1)
        self.assertEqual(summary['identities'], [IDENTITY])
        self.assertEqual(artifact['pendingAtFailure'], 0)
        self.assertEqual(artifact['productResult'], 1)
        self.assertIn('observable product result', ET.tostring(failures[0], encoding='unicode'))

    def test_product_failure_after_prerequisites_and_cleanup(self):
        summary, artifact, _ = self.run_scenario('product-failure', expected_exit=1)
        self.assertEqual(summary['executed'], 1)
        self.assertEqual(artifact['pendingAtFailure'], 0)
        self.assertEqual(artifact['productResult'], 1)

    def test_harness_timeout_releases_and_settles_every_operation(self):
        summary, artifact, failures = self.run_scenario('harness-only-hang', expected_exit=1)
        self.assertEqual(summary['identities'], [IDENTITY])
        self.assertEqual(artifact['pendingAtFailure'], 2)
        self.assertIsNone(artifact['productResult'])
        self.assertIn('harness still holds', ET.tostring(failures[0], encoding='unicode'))

    def test_environment_failure_prevents_runner_start(self):
        helper = ROOT / 'plugins/gestalt/skills/development-testing/scripts/test-readiness.py'
        result = subprocess.run([sys.executable, str(helper), '--require',
                                 str(self.path/'missing-runner'), '--artifact-parent', str(self.path)],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, 1)
        readiness = json.loads(result.stdout)
        self.assertFalse(readiness['ready'])
        self.assertEqual(readiness['errors'][0]['code'], 'missing_executable')
        self.assertEqual(list(self.path.iterdir()), [])


if __name__ == '__main__':
    unittest.main()
