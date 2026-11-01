# Org helper publication contract

Source inventory at L4 start (`5d724544465c6c23bfecf5b06be0d33c7ed552ae`)
is the Bash `org-plan` launcher and these eleven modules, all under
`plugins/gestalt/skills/org-plan/scripts/`:

| File | Runtime responsibility / local dependencies |
| --- | --- |
| org-plan-cli.mjs | CLI dispatch; core |
| org-plan-core.mjs | Public facade; parser, publication, transitions |
| org-plan-files.mjs | Filesystem/process compatibility operations; Node builtins |
| org-plan-parser.mjs | Parsing/projection; files, model-schema |
| org-plan-model-policy.mjs | Model policy validation; no local imports |
| org-plan-model-schema.mjs | Policy parsing; model-policy, files |
| org-plan-executor-launch.mjs | Launch validation; model-policy |
| org-plan-effective-settings.mjs | Effective-settings receipts; model-policy |
| org-plan-model-comparison.mjs | Comparison records; model-policy |
| org-plan-publication.mjs | Status publication; parser, model-schema, files |
| org-plan-transitions.mjs | Plan mutations; files, parser, publication |

The helper has no npm dependencies or current dynamic imports. The source
launcher loads its colocated CLI. The installed public path is
`CODEX_HOME/bin/org-plan`; the baseline launcher falls back to
`CODEX_HOME/lib/gestalt-org-plan/org-plan-cli.mjs`. `prepare-executor` and
`prepare-supervision` remain implemented in the Bash launcher. Normal commands
use `exec node` and retain argv and Node's exit status. Setup defaults to
`$HOME/.codex-gestalt`, supports `CODEX_HOME` and `GESTALT_HOME`, and supports
dry-run without mutation. Public launcher mode is 0755; module modes are 0644.
`plugins/gestalt/LICENSE` is the enclosing MIT notice and must accompany the
distributed helper. Baseline setup currently copies no notice into its private
helper directory; L4.2 must preserve the notice with the complete new bundle.

`gestalt-setup.sh` currently installs the wrapper and modules sequentially into
their final paths. This establishes a source-derived failure window; it is not
evidence of a historical production incident. A correct upgrade stages and
validates a complete bundle, then atomically selects it. An invocation selects
one immutable bundle for both initial and later imports. Pre-activation failure
retains the working old helper. Two setups must serialize publication, and old
selected bundles must survive in-flight invocations. Interrupted staging must
permit retry. Existing flat installations must migrate through the same public
path. Atomic visibility alone does not claim power-loss durability.

The L4.1 baseline capture ran `bash tests/repository/test-org-helper-publication.sh`
from this repository. Its original eight unittest identities run through the actual setup script and public
Bash launcher in private temporary source trees and child homes. Their scope:

1. First install: complete module markers, public path, modes, argv, help,
   usage exit 2, and propagated exit 37.
2. Dry-run: unchanged private home tree.
3. Successful upgrade: coherent old before and new after.
4. Interrupted upgrade: hold after copying CLI, terminate the owned setup
   process group, invoke through the public path, require coherent old.
5. Copy failure: fail core installation after CLI copy, require nonzero setup
   and a coherent old public invocation.
6. Validation failure: invalid parser syntax must be rejected while old remains
   callable; invocation is checked even if setup mistakenly succeeds.
7. In-flight upgrade: hold after static module imports, complete an upgrade,
   resume a late import, require every observed marker to remain old.
8. Concurrent setup: hold first after CLI copy and second at the final catalog
   check, observe the public command while both installers are alive, release
   both, settle them, and observe a coherent final invocation.

Controls 1–3 passed against the baseline. Cases 4–8 failed at mixed-version or
invalid-module assertions against the baseline. They must pass after the
publication repair. Gates use bounded Unix sockets, never timing sleeps.
Every gate is released and each owned process group settled in cleanup, even
after an expected assertion failure. A missing gate is a harness failure, not
evidence of a product hang.

Fixture limits: runtime installation, Codex plugin calls, catalog verification,
context configuration, and managed-command setup are stubbed to avoid networks
and live profiles. Source helper modules retain their real bodies with appended
version exports; a probe-only CLI branch loads all module markers and forwards
arguments. Its late import of the otherwise unused comparison module is a
synthetic future-facing consistency check, not an assertion that production
currently performs dynamic imports. The test does not model a separate
publication algorithm. `install` is interposed only within fixture PATH for
copy failure/gates; actual files are copied by the host install executable.
These tests exercise Linux/macOS-style Unix processes and sockets on the
running host; a Linux pass does not establish a macOS pass. Existing setup and
Org integration suites retain coverage of normal uninstrumented Org behavior.

## Versioned publication and migration

`scripts/install-org-plan.mjs` copies the complete thirteen-file runtime bundle
(wrapper, eleven modules, MIT notice), plus a recorded inventory, into a private
UUID stage beneath `CODEX_HOME/lib/gestalt-org-plan/bundles`. Source and stage
inventories are exact. Source files must be regular files with no symlink
ancestry; staged file modes and SHA-256 values must match the source snapshot.
Validation checks Bash syntax, every Node module's syntax, and actual CLI help,
then rechecks all staged files and the publication record. Unexpected files,
symlinks, wrong modes, changed contents or validation errors stop publication.

Publication uses the unchanged L2 unique-owner lock implementation. Stage names
include owner PID and unique token. Cleanup removes only exact private stages
whose matching ownership record is readable and whose PID is proven absent;
it never uses age to establish ownership or death. Unknown stages are retained.
Completed UUID bundles are never automatically deleted, including orphaned
bundles left by interruption after validation. This deliberately trades disk
space for safe in-flight invocation retention.

After validation, the stage is renamed to its immutable UUID name. A small
POSIX shell dispatcher is written beside the public command with that bundle's
literal UUID. It resolves the physical bundle directory once relative to its
public command location, preserving Codex home relocation. Its final rename over
`CODEX_HOME/bin/org-plan` is the only activation point. The dispatcher itself
contains no changing version pointer. An open old dispatcher inode continues
reading its old literal UUID; a new open sees the new UUID. The selected wrapper
resolves its colocated CLI in the immutable directory, so static and late
relative imports remain within that directory. The bundled wrapper and its
profile-installation commands are unchanged.

Migration keeps the previous flat modules untouched. A legacy Bash invocation
opened before public replacement can still compute its original `bin` directory
and load those flat modules, including later imports. No directory moves or
symlink-to-directory transitions are required. Existing public-command symlinks
or symlinks in the private destination directory chain are refused without
replacing their targets. A failed public rename leaves the old public inode and
all old bundles intact. A first install interrupted before activation leaves no
public helper; retry can recover a proven-dead owner and remove its owned stage
or public scratch file.

Run the same command for the current nineteen named tests (all expected to
pass), preserving all eight initial contracts and adding:

- Legacy flat migration with an invocation held across a late import.
- Interrupted first install and retry without publishing a partial helper.
- Interrupted upgrade retry and cleanup of the proven-dead private stage.
- Rejection of symlinked source modules.
- Three staged tamper cases: symlink, mode and unexpected inventory entry.
- Injected atomic-activation rename failure preserving the old public inode.
- Rejection of public-command and private-directory symlink destinations.
- Two simultaneous fresh installers producing coherent public invocations.
- Interruption immediately before public rename, retry, scratch cleanup and
  retention of both old and orphaned complete bundles.
- Correct public/bundle file modes under a restrictive child umask.
- Continued public-command operation after moving the Codex home.

Additional injection limits: activation failure and its pre-rename interruption
gate use Node's supported preload mechanism to interpose the real filesystem
rename boundary; the production installer has no test-only environment hooks.
The tests continue using the actual installer body, setup and public launcher.

Boundaries: this is atomic visibility within a trusted user-owned Codex home,
not a power-loss/fsync durability guarantee or protection against a hostile
same-user process rewriting directories. PID reuse/unprobeable owners and the
lock's interrupted unpublished-owner window fail closed. A five-minute lock
deadline reports the unresolved owner; manual inspection may be required.
Unknown ownership is never reclaimed automatically. A filesystem that refuses
the final same-directory rename leaves the previous public helper intact.

## Uninstrumented compatibility and Mobile integration

`bash tests/repository/test-gestalt-setup.sh` executes the exact publisher
command emitted by setup's dry-run, first into a fresh private home and then
over a legacy flat fixture. It compares every installed wrapper/module/license
byte and mode, checks help/usage exits, and invokes `prepare-supervision`,
validation, describe/projection and suspend/reopen/resume through the installed
public dispatcher. HOME and CODEX_HOME are separate disposable directories.
`bash tests/repository/test-release-artifacts.sh` additionally checks that the
archive includes the publisher, its lock dependency and the complete helper,
then installs and invokes those delivered bytes through their public command.
Existing marketplace, checksum, skill metadata/discovery and full CI checks
remain required. The release workflow assigns synchronized package versions;
this change leaves plugin content, dependency locks and vendor fixtures intact.

Mobile's current `npm run test:org-plan-integration` wrapper deliberately
requires clean Agents revision `3a7d87be1eb61c1ae7e9157292e2f13988b7dc29`.
It cannot verify this uncommitted candidate. Mobile's documented
`GESTALT_TEST_ORG_PLAN_HELPER` override supports directly running the actual
helper with Vitest. The Agents-owned test harness uses that override, a private
child home and a JSON reporter to assert the selected test identities/counts:

```sh
node tests/helpers/run-org-helper-integration.mjs /path/to/gestalt-mobile source handoff
node tests/helpers/run-org-helper-integration.mjs /path/to/gestalt-mobile installed handoff
node tests/helpers/run-org-helper-integration.mjs /path/to/gestalt-mobile installed policy
```

The first two commands each require the two real accepted-L10/L9 handoff cases
to pass; the third requires the actual Agents policy publication/negotiation
case to pass. The documented selector's `model policy` alternative currently
matches no policy-file identity, so its two-case run alone does not establish
policy publication coverage. Installed mode publishes the current unmodified
helper into a temporary home, uses its public dispatcher, and removes only the
harness-owned temporary tree afterward. No Mobile source or pinned wrapper is
changed, and these runs do not claim that the immutable-wrapper command passed.
