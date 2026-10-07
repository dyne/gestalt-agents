"""Synthetic readiness fixtures, including deterministic root-safe failures."""
from concurrent.futures import ThreadPoolExecutor
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

HELPER = Path(sys.argv.pop(1)).resolve()
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('readiness', HELPER)
readiness = importlib.util.module_from_spec(spec)
spec.loader.exec_module(readiness)


class Readiness(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='readiness fixtures ')
        self.addCleanup(self.temp.cleanup)
        self.parent = Path(self.temp.name)
        self.foreign = self.parent / 'foreign evidence'
        self.foreign.write_text('preserve')

    def run_cli(self, *args, parent=None, expected=0):
        result = subprocess.run([sys.executable, str(HELPER), '--artifact-parent',
                                 str(parent or self.parent), *args],
                                capture_output=True, text=True, timeout=10)
        self.assertEqual(result.returncode, expected, result.stderr + result.stdout)
        self.assertEqual(result.stderr, '')
        self.assertLess(len(result.stdout), 2000)
        return json.loads(result.stdout)

    def test_creation_probe_cleanup_and_foreign_files(self):
        result = self.run_cli('--require', sys.executable)
        self.assertTrue(result['ready'])
        directory = Path(result['artifact_directory'])
        self.assertEqual(directory.parent.resolve(), self.parent.resolve())
        self.assertEqual(list(directory.iterdir()), [])
        self.assertEqual(directory.stat().st_mode & 0o777, 0o700)
        self.assertEqual(self.foreign.read_text(), 'preserve')
        directory.rmdir()
        self.assertEqual(list(self.parent.iterdir()), [self.foreign])

    def test_missing_binary_no_allocation(self):
        result = self.run_cli('--require', str(self.parent / 'absent'), expected=1)
        self.assertEqual(result['errors'][0]['code'], 'missing_executable')
        self.assertIsNone(result['artifact_directory'])
        self.assertEqual(list(self.parent.iterdir()), [self.foreign])

    def test_missing_browser_no_allocation(self):
        result = self.run_cli('--browser-executable', str(self.parent / 'absent'), expected=1)
        self.assertEqual(result['errors'][0]['code'], 'missing_browser')
        self.assertIsNone(result['artifact_directory'])

    def test_browser_and_required_path_with_spaces(self):
        browser = self.parent / 'browser executable'
        browser.write_text('#!/bin/sh\nexit 0\n')
        browser.chmod(0o700)
        result = self.run_cli('--require', str(browser), '--browser-executable', str(browser))
        self.assertTrue(result['ready'])
        self.assertEqual(Path(result['browser_executable']).resolve(), browser.resolve())

    def test_nonexecutable_browser(self):
        result = self.run_cli('--browser-executable', str(self.foreign), expected=1)
        self.assertEqual(result['errors'][0]['code'], 'missing_browser')

    def test_unusable_parent_even_as_root(self):
        for parent in [self.foreign, self.parent / 'missing directory']:
            with self.subTest(parent=parent):
                result = self.run_cli(parent=parent, expected=1)
                self.assertFalse(result['ready'])
                self.assertEqual(result['errors'][0]['code'], 'artifact_directory_unusable')
                self.assertIsNone(result['artifact_directory'])
        self.assertEqual(self.foreign.read_text(), 'preserve')

    def test_actual_write_failure_cleans_owned_directory(self):
        # Mode-bit tests are unreliable under root. Inject the actual probe failure.
        with patch.object(readiness.tempfile, 'NamedTemporaryFile',
                          side_effect=PermissionError('controlled write refusal')) as probe:
            result = readiness.check_readiness([], None, self.parent)
        probe.assert_called_once()
        self.assertFalse(result['ready'])
        self.assertEqual(result['errors'][0]['code'], 'artifact_directory_unusable')
        self.assertIsNone(result['artifact_directory'])
        self.assertEqual(list(self.parent.iterdir()), [self.foreign])

    def test_failed_remove_is_visible_and_preserves_foreign(self):
        real_unlink = Path.unlink

        def refuse_probe(path, *args, **kwargs):
            if path.name.startswith('.write-probe-'):
                raise PermissionError('controlled removal refusal')
            return real_unlink(path, *args, **kwargs)

        with patch.object(Path, 'unlink', refuse_probe):
            result = readiness.check_readiness([], None, self.parent)
        self.assertFalse(result['ready'])
        self.assertEqual([error['code'] for error in result['errors']],
                         ['artifact_directory_unusable', 'cleanup_incomplete'])
        self.assertTrue(Path(result['artifact_directory']).is_dir())
        self.assertEqual(self.foreign.read_text(), 'preserve')

    def test_concurrent_unique_runs(self):
        with ThreadPoolExecutor(max_workers=4) as pool:
            results = list(pool.map(lambda _: self.run_cli(), range(8)))
        directories = {result['artifact_directory'] for result in results}
        self.assertEqual(len(directories), 8)
        for directory in directories:
            self.assertEqual(list(Path(directory).iterdir()), [])
        self.assertEqual(self.foreign.read_text(), 'preserve')

    def test_bounded_errors(self):
        result = self.run_cli('--require', 'x' * 500, expected=1)
        self.assertLessEqual(len(result['errors'][0]['detail']), 300)


if __name__ == '__main__':
    unittest.main()
