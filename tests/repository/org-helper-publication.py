"""Exercise real setup/launcher publication in private, instrumented installations.

Only unrelated plugin/runtime setup is stubbed. Helper implementations retain
their production bodies; appended version exports and a probe CLI branch make
cross-process module selection observable. The late import is a synthetic
future-facing contract: production helper modules currently use static imports.
"""

import json
import os
from pathlib import Path
import select
import shutil
import signal
import socket
import stat
import subprocess
import sys
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = Path("plugins/gestalt/skills/org-plan/scripts")
MODULES = (
    "org-plan-cli", "org-plan-core", "org-plan-files", "org-plan-parser",
    "org-plan-model-policy", "org-plan-model-schema", "org-plan-executor-launch",
    "org-plan-effective-settings", "org-plan-model-comparison",
    "org-plan-publication", "org-plan-transitions",
)
TIMEOUT = 12

# Run as isolated PATH commands. Never replace a host executable or production
# source file. Socket events establish each injection before assertions run.
INTERPOSER = r'''#!PYTHON
import json, os, pathlib, socket, subprocess, sys

def event(name):
    with socket.socket(socket.AF_UNIX) as client:
        client.settimeout(12)
        client.connect(os.environ["PUBLICATION_SOCKET"])
        client.sendall((name + "\n").encode())
        if client.recv(1) != b"!":
            raise RuntimeError("publication gate was not released")

name = pathlib.Path(sys.argv[0]).name
if name == "codex":
    if sys.argv[1:] == ["plugin", "marketplace", "list"]:
        print("Marketplace  Path")
    elif sys.argv[1:3] == ["plugin", "list"]:
        print(json.dumps({"installed": [{"name": "context-mode", "installed": True, "version": "fixture"}]}))
    sys.exit(0)
args = sys.argv[1:]
source = pathlib.Path(args[-2]) if len(args) >= 2 else pathlib.Path("/")
is_module = source.name == "org-plan-cli.mjs"
if source.name == "org-plan-core.mjs" and os.environ.get("PUBLICATION_FAIL") == "copy":
    sys.exit(73)
result = subprocess.run([os.environ["PUBLICATION_REAL_INSTALL"], *args])
if result.returncode:
    sys.exit(result.returncode)
if source.name == "org-plan-parser.mjs":
    target = pathlib.Path(args[-1])
    tamper = os.environ.get("PUBLICATION_TAMPER")
    if tamper == "symlink":
        target.unlink()
        target.symlink_to(source)
    elif tamper == "mode":
        target.chmod(0o777)
    elif tamper == "inventory":
        (target.parent / "unexpected-file").write_text("must not activate")
if is_module and os.environ.get("PUBLICATION_COPY_GATE"):
    event("copied-cli")
sys.exit(0)
'''

PROBE = r'''
if (process.argv[2] === "publication-probe") {
  if (process.env.PUBLICATION_IMPORT_GATE) {
    const { createConnection } = await import("node:net");
    await new Promise((resolve, reject) => {
      const connection = createConnection(process.env.PUBLICATION_SOCKET);
      connection.setTimeout(12000, () => connection.destroy(new Error("probe gate timeout")));
      connection.on("error", reject);
      connection.on("connect", () => connection.write("imported-static\n"));
      connection.on("data", () => { connection.end(); resolve(); });
    });
  }
  const late = await import("./org-plan-model-comparison.mjs");
  console.log(JSON.stringify({ versions: [...publicationVersions, late.publicationVersion], args: process.argv.slice(3) }));
  process.exit(Number(process.env.PUBLICATION_EXIT || 0));
}
'''


class Installation:
    def __init__(self, directory):
        self.root = directory
        self.home = directory / "home with spaces"
        self.codex = self.home / "custom codex"
        self.gestalt = self.home / "custom gestalt"
        self.bin = directory / "path"
        self.bin.mkdir()
        self.home.mkdir()
        self.gestalt.mkdir()
        cache = self.codex / "plugins/cache/dyne-gestalt-agents/context-mode/fixture"
        cache.mkdir(parents=True)
        (cache / "start.mjs").write_text("")
        self.processes = []
        self.connections = []
        self.server = socket.socket(socket.AF_UNIX)
        self.address = str(directory / "gate.sock")
        self.server.bind(self.address)
        self.server.listen(8)
        for name in ("install", "codex"):
            path = self.bin / name
            path.write_text(INTERPOSER.replace("#!PYTHON", "#!" + sys.executable))
            path.chmod(0o755)
        self.env = dict(os.environ)
        # These overrides are intentional *child* setup inputs, never shell
        # scratch variables or writes to an actual user profile.
        self.env.update(HOME=str(self.home), CODEX_HOME=str(self.codex),
                        GESTALT_HOME=str(self.gestalt),
                        PATH=str(self.bin) + os.pathsep + os.environ["PATH"],
                        PUBLICATION_SOCKET=self.address,
                        PUBLICATION_REAL_INSTALL=shutil.which("install"))
        for key in list(self.env):
            if key.startswith("GESTALT_MOBILE_ORG_PLAN_"):
                self.env.pop(key)

    def source(self, version, invalid=False):
        source = self.root / ("source " + version)
        (source / SCRIPTS).mkdir(parents=True)
        shutil.copy2(ROOT / "gestalt-setup.sh", source)
        manifest = source / ".agents/plugins/marketplace.json"
        manifest.parent.mkdir(parents=True)
        shutil.copy2(ROOT / ".agents/plugins/marketplace.json", manifest)
        shutil.copytree(ROOT / SCRIPTS, source / SCRIPTS, dirs_exist_ok=True)
        shutil.copy2(ROOT / "plugins/gestalt/LICENSE", source / "plugins/gestalt/LICENSE")
        (source / "scripts").mkdir()
        shutil.copy2(ROOT / "scripts/install-org-plan.mjs", source / "scripts/install-org-plan.mjs")
        lock = source / "plugins/context-mode/scripts/runtime-lock.mjs"
        lock.parent.mkdir(parents=True)
        shutil.copy2(ROOT / "plugins/context-mode/scripts/runtime-lock.mjs", lock)
        for module in MODULES:
            path = source / SCRIPTS / (module + ".mjs")
            with path.open("a") as stream:
                stream.write("\nexport const publicationVersion = " + json.dumps(version) + ";\n")
        cli = source / SCRIPTS / "org-plan-cli.mjs"
        imports, names = [], []
        for index, module in enumerate(MODULES):
            if module in ("org-plan-cli", "org-plan-model-comparison"):
                continue
            name = "publicationVersion" + str(index)
            imports.append('import { publicationVersion as ' + name + ' } from "./' + module + '.mjs";')
            names.append(name)
        prelude = "\n".join(imports) + "\nconst publicationVersions = [" + json.dumps(version) + "," + ",".join(names) + "];\n" + PROBE
        original = cli.read_text()
        cli.write_text(original.split("\n", 1)[0] + "\n" + prelude + original.split("\n", 1)[1])
        if invalid:
            (source / SCRIPTS / "org-plan-parser.mjs").write_text("invalid fixture syntax !!!\n")
        # Keep production publication and module resolution intact. Substitute
        # unrelated runtime/plugin/profile-adjacent setup, without network use.
        for relative in ("plugins/context-mode/scripts/install-runtime.mjs",
                         "plugins/context-mode/scripts/configure-codex.mjs",
                         "scripts/install-managed-commands.mjs"):
            path = source / relative
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("import { mkdirSync } from 'node:fs'; mkdirSync(process.env.GESTALT_HOME, { recursive: true });\n")
        verifier = source / "scripts/verify-gestalt-skill-catalog.mjs"
        verifier.write_text('''
if (process.env.PUBLICATION_READY_GATE) {
  const { createConnection } = await import("node:net");
  await new Promise((resolve, reject) => {
    const connection = createConnection(process.env.PUBLICATION_SOCKET);
    connection.setTimeout(12000, () => connection.destroy(new Error("setup gate timeout")));
    connection.on("error", reject);
    connection.on("connect", () => connection.write("setup-ready\\n"));
    connection.on("data", () => { connection.end(); resolve(); });
  });
}
''')
        return source

    def legacy(self, version="old"):
        source = self.source(version)
        bundle = self.codex / "lib/gestalt-org-plan"
        bundle.mkdir(parents=True)
        self.launcher.parent.mkdir(parents=True)
        shutil.copy2(source / SCRIPTS / "org-plan", self.launcher)
        self.launcher.chmod(0o755)
        for module in MODULES:
            shutil.copy2(source / SCRIPTS / (module + ".mjs"), bundle)
        return source

    def alias_codex_home(self):
        alias = self.home / "codex alias"
        alias.symlink_to(self.codex, target_is_directory=True)
        self.codex = alias
        self.env["CODEX_HOME"] = str(alias)
        if self.launcher == self.launcher.resolve():
            raise AssertionError("activation fixture requires a lexical home alias")

    def activation_env(self, action="failure"):
        # Instrument the existing fs rename boundary through Node's supported
        # preload mechanism; production publisher code has no test-only hooks.
        preload = self.root / "activation-failure.mjs"
        gate = self.root / "activation-gate.py"
        gate.write_text('''
import os, socket
with socket.socket(socket.AF_UNIX) as client:
    client.settimeout(12)
    client.connect(os.environ["PUBLICATION_SOCKET"])
    client.sendall(b"activation-ready\\n")
    if client.recv(1) != b"!":
        raise RuntimeError("activation gate not released")
''')
        preload.write_text('''
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { spawnSync } from "node:child_process";
const rename = fs.renameSync;
fs.renameSync = (source, target) => {
  if (String(target) === process.env.PUBLICATION_PUBLIC_PATH && String(source).includes(".org-plan-")) {
    if (process.env.PUBLICATION_ACTIVATION_ACTION === "failure") {
      const error = new Error("injected activation failure");
      error.code = "EACCES";
      throw error;
    }
    const result = spawnSync(process.env.PUBLICATION_GATE_PYTHON, [process.env.PUBLICATION_GATE_SCRIPT], { stdio: "inherit" });
    if (result.status !== 0) throw new Error("activation gate failed");
  }
  return rename(source, target);
};
syncBuiltinESMExports();
''')
        return {"NODE_OPTIONS": "--import=" + json.dumps(str(preload)),
                "PUBLICATION_PUBLIC_PATH": str(self.launcher.resolve()),
                "PUBLICATION_ACTIVATION_ACTION": action,
                "PUBLICATION_GATE_PYTHON": sys.executable,
                "PUBLICATION_GATE_SCRIPT": str(gate)}

    def start(self, command, *, child_umask=-1, **extra):
        env = {**self.env, **extra}
        process = subprocess.Popen(command, env=env, stdout=subprocess.PIPE,
                                   stderr=subprocess.PIPE, text=True,
                                   start_new_session=True, umask=child_umask)
        self.processes.append(process)
        return process

    def finish(self, process, expected=0):
        output, error = process.communicate(timeout=TIMEOUT)
        if expected is not None and process.returncode != expected:
            raise AssertionError(f"process exit {process.returncode}, expected {expected}: {error[-800:]}")
        return process.returncode, output

    def setup(self, source, **extra):
        return self.start(["bash", str(source / "gestalt-setup.sh")], **extra)

    @property
    def launcher(self):
        return self.codex / "bin/org-plan"

    def probe(self, **extra):
        return self.start([str(self.launcher), "publication-probe", "space argument", "--literal"], **extra)

    def coherent(self, process, allowed):
        _, output = self.finish(process)
        result = json.loads(output)
        versions = result["versions"]
        if len(versions) != len(MODULES) or len(set(versions)) != 1 or versions[0] not in allowed:
            raise AssertionError(f"invocation observed mixed/incomplete helper versions: {versions}")
        if result["args"] != ["space argument", "--literal"]:
            raise AssertionError("public launcher changed argv")
        return versions[0]

    def gate(self, expected):
        if not select.select([self.server], [], [], TIMEOUT)[0]:
            raise AssertionError(f"injection not reached: {expected}")
        connection, _ = self.server.accept()
        self.connections.append(connection)
        connection.settimeout(TIMEOUT)
        event = b""
        while not event.endswith(b"\n"):
            chunk = connection.recv(256)
            if not chunk:
                raise AssertionError("injection disconnected before event")
            event += chunk
        if event.decode().strip() != expected:
            raise AssertionError(f"unexpected injection: {event!r}, expected {expected}")
        return connection

    def release(self, connection):
        try:
            connection.sendall(b"!")
        except (BrokenPipeError, ConnectionResetError):
            pass  # An intentionally interrupted owner may have already exited.
        connection.close()
        self.connections.remove(connection)

    def stop(self, process):
        if process.poll() is None:
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.communicate(timeout=2)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL)
            process.communicate(timeout=TIMEOUT)

    def close(self):
        for connection in self.connections[:]:
            self.release(connection)
        for process in self.processes:
            self.stop(process)
        self.server.close()
        if self.connections or any(p.poll() is None for p in self.processes):
            raise AssertionError("publication fixture left held/in-flight operations")


class PublicationContract(unittest.TestCase):
    def setUp(self):
        # Short socket path also works on systems with a small sun_path limit.
        self.temp = tempfile.TemporaryDirectory(prefix="org-publish-", dir="/tmp")
        self.fixture = Installation(Path(self.temp.name))
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(self.fixture.close)

    def old(self):
        fixture = self.fixture
        fixture.finish(fixture.setup(fixture.source("old")))
        self.assertEqual(fixture.coherent(fixture.probe(), {"old"}), "old")

    def test_first_install_public_path_inventory_and_modes(self):
        fixture = self.fixture
        source = fixture.source("new")
        fixture.finish(fixture.setup(source))
        self.assertEqual(stat.S_IMODE(fixture.launcher.stat().st_mode), 0o755)
        self.assertEqual(fixture.coherent(fixture.probe(), {"new"}), "new")
        # Resolve through the actual running CLI's path indirectly via the
        # module marker count; inventory/modes are also checked on disk here.
        installed = list((fixture.codex / "lib/gestalt-org-plan").rglob("org-plan-cli.mjs"))
        self.assertTrue(installed)
        bundle = installed[-1].parent
        self.assertEqual({p.stem for p in bundle.glob("*.mjs")}, set(MODULES))
        for path in bundle.glob("*.mjs"):
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o644)
        self.assertEqual((bundle / "LICENSE").read_bytes(), (ROOT / "plugins/gestalt/LICENSE").read_bytes())
        self.assertEqual(stat.S_IMODE((bundle / "LICENSE").stat().st_mode), 0o644)
        process = fixture.start([str(fixture.launcher), "--help"])
        self.assertIn("usage: org-plan", fixture.finish(process)[1])
        self.assertEqual(fixture.finish(fixture.start([str(fixture.launcher), "unknown-command"]), expected=None)[0], 2)
        self.assertEqual(fixture.finish(fixture.probe(PUBLICATION_EXIT="37"), expected=None)[0], 37)

    def test_dry_run_creates_no_public_helper(self):
        fixture = self.fixture
        source = fixture.source("new")
        before = sorted(str(p.relative_to(fixture.home)) for p in fixture.home.rglob("*"))
        process = fixture.start(["bash", str(source / "gestalt-setup.sh"), "--dry-run"])
        self.assertIn("bin/org-plan", fixture.finish(process)[1])
        self.assertEqual(before, sorted(str(p.relative_to(fixture.home)) for p in fixture.home.rglob("*")))

    def test_valid_upgrade_observes_complete_new_bundle(self):
        self.old()
        fixture = self.fixture
        fixture.finish(fixture.setup(fixture.source("new")))
        self.assertEqual(fixture.coherent(fixture.probe(), {"new"}), "new")

    def test_interrupted_upgrade_keeps_old_invocation_coherent(self):
        self.old()
        fixture = self.fixture
        upgrade = fixture.setup(fixture.source("new"), PUBLICATION_COPY_GATE="1")
        fixture.gate("copied-cli")
        fixture.stop(upgrade)
        fixture.coherent(fixture.probe(), {"old"})

    def test_copy_failure_keeps_old_invocation_coherent(self):
        self.old()
        fixture = self.fixture
        upgrade = fixture.setup(fixture.source("new"), PUBLICATION_FAIL="copy")
        self.assertNotEqual(fixture.finish(upgrade, expected=None)[0], 0)
        fixture.coherent(fixture.probe(), {"old"})

    def test_invalid_module_is_rejected_before_activation(self):
        self.old()
        fixture = self.fixture
        upgrade = fixture.setup(fixture.source("invalid", invalid=True))
        code, _ = fixture.finish(upgrade, expected=None)
        # Even when setup reports success, exercise the still-public helper
        # before reporting the rejection assertion so corruption is observable.
        fixture.coherent(fixture.probe(), {"old"})
        self.assertNotEqual(code, 0, "setup accepted invalid helper syntax")

    def test_inflight_late_import_uses_the_selected_bundle(self):
        self.old()
        fixture = self.fixture
        invocation = fixture.probe(PUBLICATION_IMPORT_GATE="1")
        gate = fixture.gate("imported-static")
        fixture.finish(fixture.setup(fixture.source("new")))
        fixture.release(gate)
        fixture.coherent(invocation, {"old"})
        fixture.coherent(fixture.probe(), {"new"})

    def test_concurrent_setups_never_expose_mixed_modules(self):
        self.old()
        fixture = self.fixture
        first = fixture.setup(fixture.source("first"), PUBLICATION_COPY_GATE="1")
        first_gate = fixture.gate("copied-cli")
        second = fixture.setup(fixture.source("second"), PUBLICATION_READY_GATE="1")
        second_gate = fixture.gate("setup-ready")
        # Observe while the first installer is definitely held. A serialized
        # publisher may keep second waiting; do not await it before release.
        try:
            fixture.coherent(fixture.probe(), {"old", "first", "second"})
        finally:
            fixture.release(second_gate)
            fixture.release(first_gate)
            fixture.finish(first)
            fixture.finish(second)
        fixture.coherent(fixture.probe(), {"first", "second"})

    def test_legacy_flat_upgrade_retains_inflight_modules(self):
        fixture = self.fixture
        fixture.legacy()
        invocation = fixture.probe(PUBLICATION_IMPORT_GATE="1")
        gate = fixture.gate("imported-static")
        fixture.finish(fixture.setup(fixture.source("new")))
        fixture.release(gate)
        fixture.coherent(invocation, {"old"})
        fixture.coherent(fixture.probe(), {"new"})
        self.assertTrue((fixture.codex / "lib/gestalt-org-plan/org-plan-cli.mjs").is_file())

    def test_interrupted_first_install_can_retry(self):
        fixture = self.fixture
        source = fixture.source("new")
        install = fixture.setup(source, PUBLICATION_COPY_GATE="1")
        fixture.gate("copied-cli")
        self.assertFalse(fixture.launcher.exists(), "partial first bundle became public")
        fixture.stop(install)
        fixture.finish(fixture.setup(source))
        fixture.coherent(fixture.probe(), {"new"})
        self.assertEqual(list((fixture.codex / "lib/gestalt-org-plan/bundles").glob(".stage-*")), [])

    def test_interrupted_upgrade_retry_cleans_private_stage(self):
        self.old()
        fixture = self.fixture
        source = fixture.source("new")
        upgrade = fixture.setup(source, PUBLICATION_COPY_GATE="1")
        fixture.gate("copied-cli")
        fixture.stop(upgrade)
        fixture.coherent(fixture.probe(), {"old"})
        fixture.finish(fixture.setup(source))
        fixture.coherent(fixture.probe(), {"new"})
        self.assertEqual(list((fixture.codex / "lib/gestalt-org-plan/bundles").glob(".stage-*")), [])

    def test_source_symlink_is_rejected(self):
        self.old()
        fixture = self.fixture
        source = fixture.source("bad")
        module = source / SCRIPTS / "org-plan-parser.mjs"
        outside = fixture.root / "outside-parser.mjs"
        module.rename(outside)
        module.symlink_to(outside)
        self.assertNotEqual(fixture.finish(fixture.setup(source), expected=None)[0], 0)
        fixture.coherent(fixture.probe(), {"old"})
        self.assertTrue(outside.is_file())

    def test_stage_inventory_modes_and_symlinks_are_validated(self):
        self.old()
        fixture = self.fixture
        source = fixture.source("bad")
        for tamper in ("symlink", "mode", "inventory"):
            with self.subTest(tamper=tamper):
                code, _ = fixture.finish(fixture.setup(source, PUBLICATION_TAMPER=tamper), expected=None)
                self.assertNotEqual(code, 0)
                fixture.coherent(fixture.probe(), {"old"})

    def test_activation_failure_preserves_public_inode_and_old_bundle(self):
        self.old()
        fixture = self.fixture
        fixture.alias_codex_home()
        before = fixture.launcher.stat().st_ino
        text = fixture.launcher.read_bytes()
        code, _ = fixture.finish(fixture.setup(fixture.source("new"), **fixture.activation_env()), expected=None)
        self.assertNotEqual(code, 0)
        self.assertEqual(fixture.launcher.stat().st_ino, before)
        self.assertEqual(fixture.launcher.read_bytes(), text)
        fixture.coherent(fixture.probe(), {"old"})
        self.assertEqual(list(fixture.launcher.parent.glob(".org-plan-*.tmp")), [])

    def test_symlink_public_and_bundle_directory_are_rejected(self):
        self.old()
        fixture = self.fixture
        source = fixture.source("new")
        for path in (fixture.launcher, fixture.codex / "lib/gestalt-org-plan"):
            with self.subTest(path=path.name):
                moved = path.with_name(path.name + "-retained")
                path.rename(moved)
                path.symlink_to(moved, target_is_directory=moved.is_dir())
                try:
                    self.assertNotEqual(fixture.finish(fixture.setup(source), expected=None)[0], 0)
                    self.assertTrue(path.is_symlink())
                    self.assertTrue(moved.exists())
                finally:
                    path.unlink()
                    moved.rename(path)
                fixture.coherent(fixture.probe(), {"old"})

    def test_two_first_installers_publish_coherent_bundles(self):
        fixture = self.fixture
        first = fixture.setup(fixture.source("first"), PUBLICATION_READY_GATE="1")
        first_gate = fixture.gate("setup-ready")
        second = fixture.setup(fixture.source("second"), PUBLICATION_READY_GATE="1")
        second_gate = fixture.gate("setup-ready")
        fixture.release(first_gate)
        fixture.release(second_gate)
        fixture.finish(first)
        fixture.finish(second)
        fixture.coherent(fixture.probe(), {"first", "second"})

    def test_interrupted_activation_keeps_old_and_retry_retains_bundles(self):
        self.old()
        fixture = self.fixture
        fixture.alias_codex_home()
        source = fixture.source("new")
        upgrade = fixture.setup(source, **fixture.activation_env("gate"))
        fixture.gate("activation-ready")
        fixture.coherent(fixture.probe(), {"old"})
        fixture.stop(upgrade)
        fixture.coherent(fixture.probe(), {"old"})
        fixture.finish(fixture.setup(source))
        fixture.coherent(fixture.probe(), {"new"})
        bundles = fixture.codex / "lib/gestalt-org-plan/bundles"
        self.assertEqual(len([p for p in bundles.iterdir() if not p.name.startswith(".")]), 3)
        self.assertEqual(list(fixture.launcher.parent.glob(".org-plan-*.tmp")), [])

    def test_restrictive_umask_preserves_public_file_modes(self):
        fixture = self.fixture
        fixture.finish(fixture.setup(fixture.source("new"), child_umask=0o077))
        self.assertEqual(stat.S_IMODE(fixture.launcher.stat().st_mode), 0o755)
        bundle = next((fixture.codex / "lib/gestalt-org-plan/bundles").iterdir())
        for path in bundle.iterdir():
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o755 if path.name == "org-plan" else 0o644)
        fixture.coherent(fixture.probe(), {"new"})

    def test_relocated_home_keeps_public_command_usable(self):
        self.old()
        fixture = self.fixture
        relocated = fixture.home / "relocated codex"
        fixture.codex.rename(relocated)
        fixture.codex = relocated
        fixture.coherent(fixture.probe(), {"old"})


if __name__ == "__main__":
    unittest.main(verbosity=2)
