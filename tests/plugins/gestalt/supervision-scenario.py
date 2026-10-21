"""Scripted role contract with real disposable Org helper transitions.

Lease/checkpoint/role actions are test actors, not live agents or Mobile. The
evidence oracle reads independent fixture bytes; no runtime behaviour or model
efficiency is inferred from this test.
"""
import copy
import json
import os
from pathlib import Path
import runpy
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[3]
HERE = Path(__file__).resolve().parent
HELPER = ROOT / "plugins/gestalt/skills/org-plan/scripts/org-plan"
evidence = runpy.run_path(str(HERE / "evidence-contract.py"))
instructions = runpy.run_path(str(HERE / "instruction-contract.py"))
environment = dict(os.environ)
for name in ("GESTALT_MOBILE_ORG_PLAN_STATUS_DIRECTORY", "GESTALT_MOBILE_ORG_PLAN_STATUS_FILE"):
    environment.pop(name, None)


def main():
    trace, snapshots, negative = [], {}, 0
    with tempfile.TemporaryDirectory(prefix="supervision-scenario-") as directory:
        work = Path(directory)
        plan = work / ".gestalt" / "fixture.org"
        plan.parent.mkdir()
        shutil.copyfile(HERE / "fixtures/valid-minimal.org", plan)
        profiles = work / "profiles"

        def call(*args, success=True):
            result = subprocess.run([str(HELPER), *map(str, args)], env=environment,
                                    capture_output=True, text=True)
            assert (result.returncode == 0) == success, (args, result.stderr)
            return result.stdout

        def snapshot(wake):
            assert wake not in snapshots, "repeated authoritative read in the same wake"
            snapshots[wake] = json.loads(call("projection", plan))
            trace.append((wake, "snapshot"))

        def action(wake, name):
            assert wake in snapshots
            trace.append((wake, name))

        def require_full_suite(passed):
            if not passed:
                raise ValueError("full-suite evidence required before parent completion")

        def require_commit_authority(verdict, staged):
            if verdict != "ACCEPT" or any(".gestalt" in Path(path).parts and path.endswith(".org") for path in staged):
                raise ValueError("acceptance and staged-scope postconditions required")

        def reject_without_mutation(operation):
            nonlocal negative
            previous = plan.read_bytes()
            try:
                operation()
            except ValueError:
                negative += 1
            else:
                raise AssertionError("fixture actor accepted forbidden authority")
            assert plan.read_bytes() == previous

        call("prepare-supervision", "--agents-dir", profiles)
        instructions["check_profiles"](profiles)
        call("validate", plan)
        call("signal", plan, "supervision-start")
        before = plan.read_bytes()
        call("review", plan, "first-outcome", "REVIEWED", success=False)
        assert plan.read_bytes() == before
        negative += 1
        call("set", plan, "first-outcome", "WIP")
        call("l2", plan, "first-task", "WIP")
        before = plan.read_bytes()
        call("set", plan, "first-outcome", "DONE", success=False)
        assert plan.read_bytes() == before
        negative += 1

        # Fixture actor wakes exercise one snapshot and a legal disposition;
        # existing instruction scenarios check the matching canonical clauses.
        for wake, actions in [
                ("running", ["accepted-executorChanged-lease", "yield-one-episode"]),
                ("rejected-lease", ["inspect-current-result", "same-turn-followup-l1"]),
                ("partial-idle", ["same-turn-followup-l1"]),
                ("status-question", ["answer-status", "same-turn-followup-l1"]),
                ("recoverable-error", ["investigate-error", "same-writer-correction"])]:
            snapshot(wake)
            for item in actions:
                action(wake, item)
        assert not any("health" in item or "list" in item or "attention" in item for _, item in trace)

        report_dir = work / "evidence"
        report_dir.mkdir()
        report, _ = evidence["example"]({"id": "scenario"}, report_dir)
        report["milestone"] = "L1.1/first-task"
        current = {
            "candidate": {"sha": "a" * 40, "branch": "fixture", "base": "c" * 40,
                          "diffDigest": "fixture-diff-digest"},
            "source": {"kind": "github", "repository": "github.example/fixture/project",
                       "run": 42, "attempt": 2, "jobs": [7], "artifact": "checks.json"},
            "changedAt": evidence["TIME"],
        }
        assert evidence["review"](report, current) == "supported"
        forged = copy.deepcopy(report)
        forged["candidate"]["diffDigest"] = "stale-dirty-scope"
        assert evidence["review"](forged, current) == "stale"
        forged = copy.deepcopy(report)
        forged["checks"][0]["exit"] = 1
        assert evidence["review"](forged, current) == "contradictory"
        negative += 2
        call("l2", plan, "first-task", "DONE")
        snapshot("done-l2")
        assert evidence["review"](report, current) == "supported"
        action("done-l2", "verify-scope-focused-evidence")
        action("done-l2", "checkpoint-recorded")
        action("done-l2", "boundary-final")
        assert trace[-2:] == [("done-l2", "checkpoint-recorded"), ("done-l2", "boundary-final")]
        snapshot("already-recorded")
        action("already-recorded", "reconcile-without-final")
        snapshot("failed-checkpoint")
        action("failed-checkpoint", "continue-same-turn")

        # New turn, same executor. Fixture full-suite evidence is required before
        # parent DONE; repository-wide gates run outside this test, avoiding recursion.
        snapshot("next-turn")
        action("next-turn", "followup-l1")
        reject_without_mutation(lambda: require_full_suite(False))
        full_suite = evidence["review"](report, current) == "supported"
        require_full_suite(full_suite)
        call("set", plan, "first-outcome", "DONE")
        assert "first-outcome" in call("next", plan, "review")
        executor_identity = "l1"
        action("next-turn", "same-writer-uncommitted-correction")
        reject_without_mutation(lambda: require_commit_authority("REJECT", ["source.txt"]))
        assert executor_identity == "l1"
        # Forbidden staged input is rejected before any Git staging/commit call.
        reject_without_mutation(lambda: require_commit_authority("ACCEPT", [".gestalt/forbidden.org", "source.txt"]))
        require_commit_authority("ACCEPT", ["source.txt"])
        action("next-turn", "fixture-commit-postconditions-checked")
        call("review", plan, "first-outcome", "REVIEWED")
        assert call("next", plan, "review", success=False) == ""
        snapshot("accepted-l1")
        action("accepted-l1", "mandatory-final-even-without-checkpoint")
        executor_alive = False
        assert not executor_alive
        snapshot("terminal")
        action("terminal", "fresh-terminal-review-and-final-gates-required")
        assert len(evidence["encode"](report)) <= 2048
        assert all(sum(event == wake and step == "snapshot" for event, step in trace) == 1 for wake in snapshots)
    print(f"scripted supervision: {len(snapshots)} wakes; {negative} negative authority/evidence controls; "
          f"bounded report {len(evidence['encode'](report))} bytes; disposable helper lifecycle passed")


if __name__ == "__main__":
    main()
