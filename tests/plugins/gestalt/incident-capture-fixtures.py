"""Synthetic exporter contract fixtures; no relay or real session data."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

HELPER = str(Path(sys.argv.pop(1)).resolve())
SUMMARY = str(Path(sys.argv.pop(1)).resolve())


class Capture(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='capture fixtures ')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.workspace = self.root / 'workspace with spaces'
        self.workspace.mkdir()
        self.fixture = self.root / 'fixture.json'
        self.mobile = self.root / 'mobile'
        self.mobile.write_text('''#!/usr/bin/env python3
import os, sys
from pathlib import Path
if sys.argv[1:] == ['--version']:
    print('1.2.3'); sys.exit(0)
Path(os.environ['ARGS']).write_text(str(sys.argv[1:]))
print(Path(os.environ['FIXTURE']).read_text())
if os.environ.get('FAIL'):
    print('secret stderr', file=sys.stderr); sys.exit(9)
''')
        self.mobile.chmod(0o700)
        self.env = dict(os.environ, GESTALT_MOBILE_BIN=str(self.mobile),
                        FIXTURE=str(self.fixture), ARGS=str(self.root / 'args'))
        self.trace = dict(schemaVersion=1, sessionId='synthetic', generatedAt='2026-01-01T00:00:10Z',
                          events=[dict(occurredAt='2026-01-01T00:00:00Z', payload='secret payload'),
                                  dict(occurredAt='2026-01-01T00:00:10Z')])

    def run_capture(self, trace=None, expected=0, env=None, raw=None):
        self.fixture.write_text(raw if raw is not None else json.dumps(trace or self.trace))
        result = subprocess.run([sys.executable, HELPER, '--session', 'synthetic',
                                 '--cwd', str(self.workspace), '--data-dir', str(self.workspace),
                                 '--output', str(self.root), '--start', '2026-01-01T00:00:02Z',
                                 '--end', '2026-01-01T00:00:08Z'],
                                capture_output=True, text=True, env=env or self.env)
        self.assertEqual(result.returncode, expected, result.stdout)
        self.assertNotIn('secret', result.stdout + result.stderr)
        self.assertLess(len(result.stdout), 1500)
        summary = json.loads(result.stdout)
        packet = Path(summary['artifact'])
        self.assertEqual(packet.stat().st_mode & 0o777, 0o700)
        for path in packet.iterdir():
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
        meta = json.loads((packet / 'capture.json').read_text())
        return summary, meta

    def test_valid_and_no_overwrite(self):
        first, meta = self.run_capture()
        second, _ = self.run_capture()
        self.assertNotEqual(first['artifact'], second['artifact'])
        self.assertEqual(meta['coverage'], 'covered')
        self.assertEqual(meta['exporterVersion'], '1.2.3')
        self.assertEqual(meta['workspace'], str(self.workspace))
        self.assertIn('--data-dir', (self.root / 'args').read_text())
        self.assertEqual(json.loads(Path(first['trace']).read_text()), self.trace)

    def test_ranges_and_unordered(self):
        self.trace['events'].reverse()
        _, meta = self.run_capture()
        self.assertEqual(meta['coverage'], 'covered')
        self.trace['events'] = self.trace['events'][:1]
        self.trace['events'][0]['occurredAt'] = '2026-01-01T00:00:05Z'
        self.assertEqual(self.run_capture()[1]['coverage'], 'partial')
        self.trace['events'][0]['occurredAt'] = '2025-12-31T23:59:00Z'
        self.assertEqual(self.run_capture()[1]['coverage'], 'missing')
        self.trace['events'] = []
        self.assertEqual(self.run_capture()[1]['coverage'], 'missing')

    def test_unknown(self):
        self.trace['schemaVersion'] = 2
        self.assertEqual(self.run_capture()[1]['coverage'], 'unknown')
        self.trace['schemaVersion'] = 1
        self.trace['events'][0]['occurredAt'] = 'invalid'
        self.assertEqual(self.run_capture()[1]['coverage'], 'unknown')

    def test_failure_exports_preserved(self):
        for kind in ['session', 'workspace', 'json', 'command']:
            with self.subTest(kind=kind):
                trace = dict(self.trace)
                env = dict(self.env)
                raw = None
                if kind == 'session':
                    trace['sessionId'] = 'absent'
                if kind == 'workspace':
                    trace['workspace'] = str(self.root)
                if kind == 'json':
                    raw = '{malformed secret'
                if kind == 'command':
                    env['FAIL'] = '1'
                summary, meta = self.run_capture(trace, expected=1, env=env, raw=raw)
                self.assertEqual(meta['coverage'], 'unknown')
                self.assertTrue(Path(summary['trace']).is_file())

    def test_discovery_order(self):
        manager = self.root / 'gestalt'
        manager.write_text('#!/bin/sh\nprintf "%s\\n" "$MOBILE_STUB"\n')
        manager.chmod(0o700)
        env = dict(self.env, PATH=str(self.root) + os.pathsep + os.environ['PATH'],
                   MOBILE_STUB=str(self.mobile))
        del env['GESTALT_MOBILE_BIN']
        self.assertEqual(self.run_capture(env=env)[1]['executableDiscovery'], 'gestalt path mobile')
        manager.write_text('#!/bin/sh\nexit 23\n')
        self.assertEqual(self.run_capture()[1]['executableDiscovery'], 'GESTALT_MOBILE_BIN')

    def test_no_implicit_workspace(self):
        result = subprocess.run([sys.executable, HELPER, '--session', 'synthetic'], capture_output=True)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.root.glob('incident-*')), [])

    def summarize(self, artifact, *options, expected=0):
        result = subprocess.run([sys.executable, SUMMARY, artifact, *options],
                                capture_output=True, text=True)
        self.assertEqual(result.returncode, expected, result.stdout)
        self.assertLess(len(result.stdout), 2000)
        self.assertNotIn('secret', result.stdout + result.stderr)
        return json.loads(result.stdout)

    def test_oversized_capture_to_summary(self):
        self.trace['events'] = [dict(occurredAt='2026-01-01T00:00:05Z',
                                     type='autopilot.turn-failed', payload='secret' * 1000)
                                for _ in range(500)] + self.trace['events']
        summary, _ = self.run_capture()
        trace_path = Path(summary['trace'])
        self.assertGreater(trace_path.stat().st_size, 2_000_000)
        self.assertEqual(len(trace_path.read_text().splitlines()), 1)
        result = self.summarize(summary['artifact'])
        self.assertEqual(result['coverage'], 'covered')
        self.assertEqual(result['matchingEvents'], 500)
        self.assertEqual(result['failureEvents'], 500)
        self.assertEqual(result['eventTypes'], [dict(type='autopilot.turn-failed', count=500)])
        self.assertEqual(self.summarize(summary['artifact'], '--event-type',
                                        'autopilot.turn-started')['matchingEvents'], 0)
        self.assertEqual(json.loads(trace_path.read_text()), self.trace)

    def test_summary_limits_unknown_and_failure(self):
        self.trace['events'] = [dict(occurredAt='2026-01-01T00:00:05Z',
                                     type='autopilot.event-' + chr(97 + i)) for i in range(20)]
        summary, _ = self.run_capture()
        result = self.summarize(summary['artifact'])
        self.assertEqual(len(result['eventTypes']), 10)
        self.assertEqual(result['omittedEventTypes'], 10)
        self.trace['schemaVersion'] = 2
        summary, _ = self.run_capture()
        self.assertEqual(self.summarize(summary['artifact'])['coverage'], 'unknown')
        summary, _ = self.run_capture(raw='not json', expected=1)
        self.assertEqual(self.summarize(summary['artifact'], expected=1)['coverage'], 'unknown')


if __name__ == '__main__':
    unittest.main()
