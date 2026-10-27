"""Validate self-contained engineering packages and executable shell behavior."""

import hashlib
import csv
import importlib.util
import io
import json
import os
from pathlib import Path
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(sys.argv.pop(1)).resolve()
PLUGIN = ROOT / "plugins/gestalt"
NAMES = ("coding", "security", "scripting")
EXAMPLE = PLUGIN / "skills/scripting/examples/atomic-copy.sh"


class EngineeringSkills(unittest.TestCase):
    def test_package_integrity_and_source_preservation(self):
        fixture = ROOT / "tests/plugins/gestalt/fixtures/engineering-skills.sha256"
        actual = set()
        for name in NAMES:
            for path in (PLUGIN / "skills" / name).rglob("*"):
                self.assertFalse(path.is_symlink(), str(path))
                if path.is_file():
                    actual.add(str(path.relative_to(PLUGIN)))
        recorded = set()
        for line in fixture.read_text().splitlines():
            mode, digest, relative = line.split(maxsplit=2)
            path = PLUGIN / relative
            recorded.add(relative)
            self.assertTrue(path.is_file(), relative)
            git_mode = "0755" if path.stat().st_mode & 0o111 else "0644"
            self.assertEqual(git_mode, mode, relative)
            self.assertEqual(hashlib.sha256(path.read_bytes()).hexdigest(), digest, relative)
        self.assertEqual(actual, recorded)

        sources = json.loads((fixture.parent / "engineering-sources.json").read_text())
        self.assertEqual(len(sources["skills"]), 8)
        for source_name, destination in (
            ("security-best-practices", "references"),
            ("security-ownership-map", "scripts"),
        ):
            for relative, item in sources["skills"][source_name]["files"].items():
                if relative.startswith(destination + "/"):
                    target = PLUGIN / "skills/security" / relative
                    self.assertEqual(hashlib.sha256(target.read_bytes()).hexdigest(),
                                     item.get("adapted_sha256", item["sha256"]))
                    self.assertEqual(bool(target.stat().st_mode & 0o111),
                                     bool(int(item["mode"], 8) & 0o111))

    def test_self_contained_links_and_default_discovery(self):
        for name in NAMES:
            skill = PLUGIN / "skills" / name
            self.assertEqual(list(skill.rglob("SKILL.md")), [skill / "SKILL.md"])
            source = (skill / "SKILL.md").read_text()
            self.assertIn(f"\nname: {name}\n", source)
            # Use the repository's Ruby YAML dependency instead of requiring PyYAML.
            metadata = subprocess.check_output([
                "ruby", "-ryaml", "-rjson", "-e",
                "puts JSON.generate(YAML.safe_load_file(ARGV[0]))",
                str(skill / "agents/openai.yaml"),
            ], text=True)
            self.assertIs(json.loads(metadata)["policy"]["allow_implicit_invocation"], True)
            for path in skill.rglob("*.md"):
                for link in re.findall(r"\]\(([^)]+)\)", path.read_text()):
                    if re.match(r"[a-z]+:", link) or link.startswith("#"):
                        continue
                    target = (path.parent / link.split("#", 1)[0]).resolve()
                    self.assertTrue(target.is_relative_to(skill.resolve()), (path, link))
                    self.assertTrue(target.is_file(), (path, link))

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="engineering-skills-")
        self.work = Path(self.temporary.name)
        self.input = self.work / "-input with spaces"
        self.input.write_bytes(b"hello\nworld\n")
        self.output = self.work / "-output with spaces"

    def tearDown(self):
        self.temporary.cleanup()

    def invoke(self, *args, env=None):
        return subprocess.run(["bash", str(EXAMPLE), *map(str, args)], cwd=self.work,
                              env=env, capture_output=True, text=True)

    def test_success_repeat_and_private_permissions(self):
        for _ in range(2):
            result = self.invoke("--output", self.output.name, "--", self.input.name)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertEqual(self.output.read_bytes(), self.input.read_bytes())
            self.assertEqual(stat.S_IMODE(self.output.stat().st_mode), 0o600)
            self.assertEqual(list(self.work.glob(".atomic-copy.*")), [])

    def test_dry_run_makes_no_changes(self):
        before = sorted(p.name for p in self.work.iterdir())
        result = self.invoke("--dry-run", "--output", self.output, "--", self.input)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Would replace", result.stdout)
        self.assertEqual(sorted(p.name for p in self.work.iterdir()), before)

    def test_invalid_inputs_and_symlink(self):
        for args in [("--output",), ("--unknown",), ("--output", "", self.input),
                     ("--output", self.output, self.work / "missing")]:
            result = self.invoke(*args)
            self.assertNotEqual(result.returncode, 0, args)
        self.output.symlink_to(self.input)
        result = self.invoke("--output", self.output, self.input)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.input.read_bytes(), b"hello\nworld\n")

    def test_failed_write_preserves_destination_and_cleans_up(self):
        self.output.write_text("original")
        binary = self.work / "bin"
        binary.mkdir()
        stub = binary / "cat"
        stub.write_text("#!/bin/sh\nprintf partial\nexit 23\n")
        stub.chmod(0o755)
        env = dict(os.environ, PATH=f"{binary}:{os.environ['PATH']}")
        result = self.invoke("--output", self.output, self.input, env=env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(self.output.read_text(), "original")
        self.assertEqual(list(self.work.glob(".atomic-copy.*")), [])

    def test_syntax_and_shellcheck(self):
        subprocess.run(["bash", "-n", str(EXAMPLE)], check=True)
        if shutil.which("shellcheck"):
            subprocess.run(["shellcheck", str(EXAMPLE)], check=True)

    def test_termination_cleans_up_without_replacing_output(self):
        self.output.write_text("original")
        binary = self.work / "bin"
        binary.mkdir()
        stub = binary / "cat"
        stub.write_text('#!/bin/sh\nprintf partial\nkill -TERM "$PPID"\nexit 0\n')
        stub.chmod(0o755)
        env = dict(os.environ, PATH=f"{binary}:{os.environ['PATH']}")
        result = self.invoke("--output", self.output, self.input, env=env)
        self.assertEqual(result.returncode, 143, result.stderr)
        self.assertEqual(self.output.read_text(), "original")
        self.assertEqual(list(self.work.glob(".atomic-copy.*")), [])

    @unittest.skipUnless(importlib.util.find_spec("networkx"),
                         "ownership integration requires optional networkx")
    def test_ownership_build_queries_and_maintainer_history(self):
        repository = self.work / "repository"
        repository.mkdir()
        output = self.work / "ownership"
        scripts = PLUGIN / "skills/security/scripts"

        def git(*args, **kwargs):
            return subprocess.run(["git", "-C", str(repository), *args],
                                  check=True, capture_output=True, text=True, **kwargs)

        git("init", "-q")
        for index, author in enumerate(("Alice", "Bob")):
            for name in ("src/auth/login.py", "src/auth/session.py"):
                path = repository / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(f"revision {index}\n")
            git("add", ".")
            env = dict(os.environ, GIT_AUTHOR_NAME=author,
                       GIT_AUTHOR_EMAIL=f"{author.lower()}@example.test",
                       GIT_COMMITTER_NAME=author,
                       GIT_COMMITTER_EMAIL=f"{author.lower()}@example.test",
                       GIT_AUTHOR_DATE=f"2026-01-0{index+1}T12:00:00+00:00",
                       GIT_COMMITTER_DATE=f"2026-01-0{index+1}T12:00:00+00:00")
            git("-c", "commit.gpgsign=false", "commit", "-qm", "fixture", env=env)

        def tool(script, *args):
            result = subprocess.run([sys.executable, str(scripts / script), *map(str, args)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            return result.stdout

        tool("run_ownership_map.py", "--repo", repository, "--out", output, "--emit-commits")
        with (output / "files.csv").open() as handle:
            rows = list(csv.DictReader(handle))
        self.assertEqual({r["path"] for r in rows}, {"src/auth/login.py", "src/auth/session.py"})
        self.assertTrue(all(int(r["bus_factor"]) == 2 for r in rows))
        self.assertTrue(all("auth" in r["sensitivity_tags"] for r in rows))
        people = json.loads(tool("query_ownership.py", "--data-dir", output, "people", "--limit", "1"))
        self.assertEqual(len(people), 1)
        json.loads(tool("query_ownership.py", "--data-dir", output,
                        "cochange", "--file", "src/auth/login.py"))
        json.loads(tool("query_ownership.py", "--data-dir", output,
                        "summary", "--section", "bus_factor_hotspots"))
        history = list(csv.DictReader(io.StringIO(tool(
            "community_maintainers.py", "--data-dir", output,
            "--file", "src/auth/login.py", "--since", "2026-01-01"))))
        self.assertEqual({row["email"] for row in history},
                         {"alice@example.test", "bob@example.test"})


if __name__ == "__main__":
    unittest.main()
