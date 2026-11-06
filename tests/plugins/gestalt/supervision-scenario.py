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


class CompactSupervisor:
    """Test-only client actor; no Mobile/runtime behaviour is inferred."""

    def __init__(self):
        self.revision = None
        self.state = None
        self.calls = []
        self.pending = None
        self.accepted = None
        self.admitted = False
        self.projected = True
        self.checkpointed = False

    def tool(self, name, **args):
        assert not self.checkpointed, "checkpoint must be the last tool call"
        self.calls.append((name, args))

    def observe(self, reply, recovery=None):
        self.tool("health", view="compact", **(
            {"sinceRevision": self.revision} if self.revision else {}))
        previous = self.state["executor"] if self.state else None
        if (reply["unchanged"] or "changes" in reply) and self.state is None:
            assert recovery is not None, "missing baseline requires compact recovery"
            self.revision = None
            self.observe(recovery)
            return
        if reply["unchanged"]:
            assert reply["revision"] == self.revision
        elif "snapshot" in reply:
            self.state = copy.deepcopy(reply["snapshot"])
        elif "changes" in reply:
            # The wire protocol replaces sections; recursive merge is wrong.
            self.state.update(copy.deepcopy(reply["changes"]))
        else:
            assert recovery is not None, "missing replacement requires compact recovery"
            self.revision = None
            self.observe(recovery)
            return
        if "snapshot" in reply or "admission" in reply.get("changes", {}):
            self.admitted = bool(self.state["admission"])
        if previous and previous != self.state["executor"]:
            self.admitted = False
        self.revision = reply["revision"]
        if self.accepted and self.accepted != self.state["control"]["owner"]:
            self.accepted = None

    def takeover(self, identity, outcome, explicit=False):
        assert explicit, "root continuation is not takeover authority"
        assert not self.accepted, "reuse accepted ownership"
        assert self.pending in (None, identity), "retry the same pending identity"
        self.tool("takeover", identity=identity)
        self.pending = identity
        if outcome == "accepted":
            self.accepted = self.state["control"]["owner"]
            self.pending = None

    def dispatch(self, writer):
        control = self.state["control"]
        assert control["enabled"] and not control["attention"]
        assert not control["conflict"] and self.admitted
        assert writer == self.state["executor"]["writer"], "no duplicate or replacement writer"
        assert self.pending is None, "pending takeover grants no dispatch"
        self.tool("followup", writer=writer)

    def transition(self, predecessor_closed):
        assert predecessor_closed, "L1 transition requires predecessor closure"
        self.tool("lifecycle-mutation")
        self.projected = False

    def project(self):
        self.tool("projection")
        self.tool("update_plan")
        self.projected = True

    def checkpoint(self):
        assert self.projected, "mandatory projection/update_plan cannot be skipped"
        self.tool("checkpoint")
        self.checkpointed = True


def revision_scenarios():
    # Top-level sections follow the wire contract; inner facts are synthetic.
    control = dict(owner="root-1", enabled=True, attention=False, conflict=False)
    facts = dict(control=control, executor=dict(writer="l1", runtime="runtime-1"),
                 admission=True, activity={"old": True}, wait={"lease": "old"})

    def snapshot(revision, state, reset=False):
        return dict(revision=revision, unchanged=False, reset=reset, snapshot=state)

    def delta(revision, **changes):
        return dict(revision=revision, unchanged=False, changes=changes)

    actor = CompactSupervisor()
    actor.observe(snapshot("r1", facts))
    assert actor.calls == [("health", {"view": "compact"})]
    before = len(actor.calls)
    actor.observe(dict(revision="r1", unchanged=True))
    assert actor.calls[before:] == [("health", {"view": "compact", "sinceRevision": "r1"})]
    assert actor.state == facts
    # Expiry replaces rather than merges: a stale conflict must disappear.
    actor.state["control"]["conflict"] = True
    actor.state["stale"] = True
    actor.observe(snapshot("r2", facts, reset=True))
    assert actor.state == facts and actor.revision == "r2"
    actor.observe(delta("r2a", activity={"new": True}, wait=None))
    assert actor.state["activity"] == {"new": True}  # old key removed
    assert actor.state["wait"] is None  # explicit null clears
    assert actor.state["executor"] == facts["executor"]  # omission retains

    negative = 0

    def denied(operation):
        nonlocal negative
        before = list(actor.calls)
        try:
            operation()
        except AssertionError:
            negative += 1
        else:
            raise AssertionError("forbidden client action accepted")
        assert actor.calls == before, "denial mutated control state"

    actor.observe(delta("r3", executor=dict(writer="l2", runtime="runtime-1")))
    denied(lambda: actor.dispatch("l1"))
    denied(lambda: actor.dispatch("l2"))
    actor.observe(delta("r4", admission=True))
    actor.dispatch("l2")
    # A runtime restart invalidates admission even with the same writer name.
    actor.observe(snapshot("r5", dict(facts, executor=dict(writer="l2", runtime="runtime-2")), reset=True))
    denied(lambda: actor.dispatch("l2"))
    actor.observe(delta("r6", admission=True))
    denied(lambda: actor.takeover("request-1", "pending"))
    actor.takeover("request-1", "pending", explicit=True)
    denied(lambda: actor.takeover("request-2", "pending", explicit=True))
    denied(lambda: actor.dispatch("l2"))
    actor.takeover("request-1", "accepted", explicit=True)
    denied(lambda: actor.takeover("request-1", "accepted", explicit=True))
    before = len(actor.calls)
    actor.observe(dict(revision="r6", unchanged=True))
    actor.dispatch("l2")
    assert [name for name, _ in actor.calls[before:]] == ["health", "followup"]
    assert [args["identity"] for name, args in actor.calls if name == "takeover"] == ["request-1", "request-1"]
    for revision, changed in [("r7", dict(control, enabled=False)),
                              ("r8", dict(control, attention=True)),
                              ("r9", dict(control, conflict=True))]:
        actor.observe(delta(revision, control=changed))
        denied(lambda: actor.dispatch("l2"))
    actor.observe(delta("r10", control=dict(control, owner="root-2")))
    assert actor.accepted is None
    denied(lambda: actor.transition(False))
    actor.transition(True)
    denied(actor.checkpoint)
    actor.project()
    actor.checkpoint()
    denied(lambda: actor.tool("health"))
    assert [name for name, _ in actor.calls[-4:]] == ["lifecycle-mutation", "projection", "update_plan", "checkpoint"]
    assert sum(name == "lifecycle-mutation" for name, _ in actor.calls) == 1
    # Boundary final is a response, with no intervening tool.
    final = "boundary-final"
    assert final and actor.calls[-1][0] == "checkpoint"
    for reply in [delta("r1", activity={}), dict(revision="r1", unchanged=False, reset=True),
                  dict(revision="r1", unchanged=True)]:
        empty = CompactSupervisor()
        empty.revision = "lost-cache"
        try:
            empty.observe(reply)
        except AssertionError:
            negative += 1
        else:
            raise AssertionError("missing baseline/replacement accepted")
        empty.observe(reply, recovery=snapshot("fresh", facts))
        assert empty.state == facts and empty.revision == "fresh"
        assert empty.calls[-1] == ("health", {"view": "compact"})
        assert not any(name in ("takeover", "projection", "roster", "full-health") for name, _ in empty.calls)
    return negative


class LeaseSupervisor(CompactSupervisor):
    """Execute contract actions against an owned synthetic result queue."""

    def __init__(self):
        super().__init__()
        self.yielded = False
        self.run = "assigned-run"
        self.results = []
        self.observe(dict(revision="lease-baseline", unchanged=False, reset=False, snapshot={
            "control": dict(owner="root", enabled=True, attention=False, conflict=False),
            "executor": dict(writer="l1", runtime="runtime-1"), "admission": True}))

    def tool(self, name, **args):
        assert not self.yielded, "accepted episode must end until modeled wake"
        super().tool(name, **args)

    def inspect_result(self, events):
        self.tool("inspect-owned-result", run=self.run)
        matching = [event for event in events if event["run"] == self.run]
        self.results.extend(event["result"] for event in matching)

    def lease(self, outcome, events):
        self.tool("lease", outcome=outcome)
        if outcome == "accepted:true":
            self.yielded = True
            return
        self.inspect_result(events)
        if outcome == "expired":
            self.tool("reassess", run=self.run)
        self.dispatch("l1")  # Concrete continuation of the assigned incomplete L1.

    def wake(self, events):
        assert self.yielded, "only a pending accepted episode can wake"
        self.yielded = False
        self.inspect_result(events)
        self.dispatch("l1")


def lease_scenarios():
    events = [dict(run="other-run", result="unrelated"),
              dict(run="assigned-run", result="owned-complete")]

    def validate(actor, outcome, awakened=False):
        calls = actor.calls[1:]  # Initial compact observation is checked elsewhere.
        assert calls[0] == ("lease", {"outcome": outcome})
        names = [name for name, _ in calls]
        if outcome == "accepted:true" and not awakened:
            assert names == ["lease"] and actor.yielded
            assert actor.results == []
        else:
            assert not actor.yielded
            assert names == (["lease", "inspect-owned-result", "reassess", "followup"]
                             if outcome == "expired" else ["lease", "inspect-owned-result", "followup"])
            assert calls[1][1] == {"run": "assigned-run"}
            assert calls[-1] == ("followup", {"writer": "l1"})
            assert actor.results == ["owned-complete"]
        assert not any(name in ("spawn", "takeover", "lifecycle-mutation", "failure") for name in names)

    negatives = 0

    def reject(actor, outcome, mutate):
        nonlocal negatives
        broken = copy.deepcopy(actor)
        mutate(broken)
        try:
            validate(broken, outcome)
        except AssertionError:
            negatives += 1
        else:
            raise AssertionError("lease duty oracle accepted a forbidden action trace")

    for outcome in ("accepted:true", "accepted:false", "unavailable", "wakeAlreadySatisfied", "expired"):
        actor = LeaseSupervisor()
        actor.lease(outcome, events)
        validate(actor, outcome)
        if outcome == "accepted:true":
            reject(actor, outcome, lambda broken: broken.calls.append(("followup", {"writer": "l1"})))
            before = list(actor.calls)
            try:
                actor.dispatch("l1")
            except AssertionError:
                negatives += 1
            else:
                raise AssertionError("accepted lease dispatched before wake")
            assert actor.calls == before
            actor.wake(events)
            validate(actor, outcome, awakened=True)
        else:
            reject(actor, outcome, lambda broken: broken.calls.pop())
            reject(actor, outcome, lambda broken: setattr(broken, "yielded", True))
            reject(actor, outcome, lambda broken: broken.calls.__setitem__(-1, ("followup", {"writer": "l2"})))
    return negatives


def main():
    # Available wait adapters deliver only matching owned results; this is a
    # synthetic event source, with no clocks, live processes or polling loop.
    def await_owned(kind, run, events, calls):
        calls.append((kind + "-wait", run))
        for event in events:
            if event["kind"] == kind and event["run"] == run:
                calls.append((kind + "-result", run))
                return event["result"]
        return None

    for owned in ("process", "test-run"):
        calls = []
        events = [dict(kind=owned, run="other", result="unrelated"),
                  dict(kind=owned, run="assigned", result="complete")]
        assert await_owned(owned, "assigned", events, calls) == "complete"
        assert calls == [(owned + "-wait", "assigned"), (owned + "-result", "assigned")]
        assert await_owned(owned, "missing", events, []) is None

    lease_negatives = lease_scenarios()
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
    revisions = revision_scenarios()
    print(f"wait economy: 5 executed lease outcomes, {lease_negatives} negative controls and 2 owned event waits; "
          "0 failed/0 skipped; synthetic action traces only")
    print(f"revision supervision: 10 control states; {revisions} negative controls; "
          "unchanged/expiry/executor/restart/takeover/Off/attention/conflict/transition passed")
    print(f"scripted supervision: {len(snapshots)} wakes; {negative} negative authority/evidence controls; "
          f"bounded report {len(evidence['encode'](report))} bytes; disposable helper lifecycle passed")


if __name__ == "__main__":
    main()
