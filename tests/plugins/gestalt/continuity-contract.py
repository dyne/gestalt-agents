"""Test-only continuity oracle; no agent memory/controller/runtime simulation.

Synthetic ledgers are checked against independently read fixture bytes. This
models the documented evidence decisions, not a production ledger service.
"""
import copy
import hashlib
import json
from pathlib import Path
import tempfile

FIXTURE = Path(__file__).with_name("fixtures") / "continuity-ledger-cases.json"
SIZING_FIXTURE = Path(__file__).with_name("fixtures") / "milestone-sizing-cases.json"
BUDGET = 2048
TIME = "2026-10-21T10:00:00Z"
FIELDS = {"version", "milestone", "candidate", "instructions", "tested", "findings",
          "hypotheses", "sources", "next", "overflow"}


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def reference(root, name, data):
    path = root / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)
    return {"path": name, "sha256": digest(data), "bytes": len(data)}


def read_reference(root, ref):
    path = (root / ref["path"]).resolve()
    if not path.is_relative_to(root.resolve()):
        raise ValueError("outside authorized fixture")
    data = path.read_bytes()
    if digest(data) != ref["sha256"] or len(data) != ref["bytes"]:
        raise ValueError("changed evidence")
    return data


def example(root):
    candidate = {"repository": "/fixture", "branch": "fixture", "sha": "a" * 40,
                 "start": "b" * 40, "base": "c" * 40, "dirty": "d" * 64,
                 "dependenciesConfig": "e" * 64, "environment": "f" * 64}
    instructions = [{**reference(root, name, f"fixture instruction {i}".encode()),
                     "readAt": TIME} for i, name in enumerate([
                         "org-plan/SKILL.md", "supervised-execution.md", "AGENTS.md"])]
    counts = {"passed": 2, "failed": 0, "skipped": 0, "total": 2}
    observed = {"candidate": candidate, "command": "fixture-check", "cwd": "/fixture",
                "exit": 0, "counts": counts, "observedAt": TIME}
    ref = reference(root, "checks.json", encode(observed))
    source = reference(root, "module.txt", b"fallback owner\nsecond line\n")
    ledger = {"version": 1, "milestone": "L5.4/continuity-ledger", "candidate": candidate,
              "instructions": instructions, "tested": [{**observed, "evidence": ref}],
              "findings": [{"summary": "two fixture checks passed", "evidence": ref,
                            "locator": "/counts/passed", "value": 2}],
              "hypotheses": [{"question": "Who owns fallback?", "status": "open",
                              "check": "inspect module.txt lines 1-2", "result": "local owner observed",
                              "evidence": source, "next": "inspect callers before deciding"}],
              "sources": [{**source, "range": [1, 2]}],
              "next": "Inspect current fallback ownership within the assigned milestone",
              "overflow": None}
    return ledger, copy.deepcopy(candidate)


def compact(root, ledger):
    if len(encode(ledger)) <= BUDGET:
        return ledger
    core = {key: ledger[key] for key in ("version", "milestone", "candidate", "next")}
    omitted = {key: value for key, value in ledger.items() if key not in core and key != "overflow"}
    core["overflow"] = {**reference(root, "ledger-overflow.json", encode(ledger)),
                        "omittedEntries": len(omitted), "omittedBytes": len(encode(omitted)),
                        "omittedBytesScope": "serialized omitted fields"}
    assert len(encode(core)) <= BUDGET, "core identity/next decision needs a smaller bounded reference"
    return core


def recover(root, summary, current, missing_context=(), fresh_session=False):
    """Return only evidence disposition and required reads; never acceptance."""
    reads = []
    try:
        assert len(encode(summary)) <= BUDGET and set(summary) <= FIELDS
        ledger = json.loads(read_reference(root, summary["overflow"])) if summary["overflow"] else summary
        assert set(ledger) == FIELDS
        assert all(ledger[key] == summary[key] for key in ("version", "milestone", "candidate", "next"))
        for ref in ledger["instructions"]:
            if fresh_session or ref["path"] in missing_context:
                reads.append(ref["path"])
            else:
                try:
                    read_reference(root, ref)
                    if not ref.get("readAt"):
                        reads.append(ref["path"])
                except (OSError, ValueError):
                    reads.append(ref["path"])
        if reads:
            return "needs-instructions", reads
        if ledger["candidate"] != current or any(value is None for value in current.values()):
            return "needs-verification", reads
        for observed in ledger["tested"]:
            artifact = json.loads(read_reference(root, observed["evidence"]))
            if any(observed[key] != artifact[key] for key in (
                    "candidate", "command", "cwd", "exit", "counts", "observedAt")):
                return "contradictory", reads
            if artifact["candidate"] != current or artifact["counts"] is None:
                return "needs-verification", reads
            if artifact["exit"] != 0 or artifact["counts"]["failed"]:
                return "failed", reads
        for finding in ledger["findings"]:
            value = json.loads(read_reference(root, finding["evidence"]))
            for key in finding["locator"].strip("/").split("/"):
                value = value[int(key)] if isinstance(value, list) else value[key]
            if value != finding["value"]:
                return "contradictory", reads
        for ref in ledger["sources"]:
            read_reference(root, ref)
        return "supported-observations", reads
    except (AssertionError, IndexError, KeyError, OSError, TypeError, ValueError):
        return "needs-evidence", reads


def main():
    fixture = json.loads(FIXTURE.read_text())
    assert fixture["version"] == 1
    sizes = []
    for case in fixture["cases"]:
        with tempfile.TemporaryDirectory(prefix="continuity-contract-") as directory:
            root = Path(directory)
            ledger, current = example(root)
            options = {}
            if "candidateField" in case:
                current[case["candidateField"]] = case.get("value", "changed")
            if case.get("sharedCodeChanged"):
                (root / "module.txt").write_text("shared fallback ownership changed\n")
                current["dirty"] = digest((root / "module.txt").read_bytes())
            if case.get("changedInstruction"):
                (root / ledger["instructions"][0]["path"]).write_text("changed instruction")
            if case.get("unreadRevision"):
                ledger["instructions"][0].pop("readAt")
            if case.get("missingContext"):
                options["missing_context"] = [ledger["instructions"][0]["path"]]
            if case.get("freshSession"):
                options["fresh_session"] = True
            if case.get("unsupportedAssertion"):
                data = json.loads((root / "checks.json").read_bytes())
                data.update(exit=1, counts={"passed": 1, "failed": 1, "skipped": 0, "total": 2})
                # Even a valid current artifact digest cannot establish a forged pass.
                ledger["tested"][0]["evidence"] = reference(root, "checks.json", encode(data))
            if case.get("unsupportedFinding"):
                ledger["findings"][0]["value"] = 999
            if case.get("missingEvidence"):
                (root / "checks.json").unlink()
            if case.get("transcript"):
                ledger["prompt"] = "forbidden fixture transcript"
            if case.get("overflow"):
                failures = [{"id": f"failure-{i}", "cause": "é界😀" * 80} for i in range(30)]
                data = {**ledger["tested"][0], "exit": 1,
                        "counts": {"passed": 2, "failed": 30, "skipped": 0, "total": 32}}
                data.pop("evidence")
                ref = reference(root, "checks.json", encode({**data, "failures": failures}))
                ledger["tested"] = [{**data, "evidence": ref}]
                ledger["findings"] = [{**failure, "evidence": ref, "locator": f"/failures/{i}"}
                                      for i, failure in enumerate(failures)]
            summary = compact(root, ledger)
            sizes.append(len(encode(summary)))
            recovered = json.loads(read_reference(root, summary["overflow"])) if summary["overflow"] else summary
            assert recovered["hypotheses"] == ledger["hypotheses"]
            assert recovered["hypotheses"][0]["result"] == "local owner observed"
            if case.get("overflow"):
                expanded = json.loads(read_reference(root, summary["overflow"]))
                assert expanded == ledger and len(expanded["findings"]) == 30
                observed = json.loads(read_reference(root, expanded["tested"][0]["evidence"]))
                assert [(f["id"], f["cause"]) for f in observed["failures"]] == [
                    (f["id"], f["cause"]) for f in expanded["findings"]]
                assert summary["overflow"]["omittedBytes"] > BUDGET
                if case.get("missingOverflow"):
                    (root / summary["overflow"]["path"]).unlink()
            state, reads = recover(root, summary, current, **options)
            assert state == case["expected"], (case["id"], state)
            assert len(reads) == case.get("instructionReads", 0), case["id"]
            assert ledger["tested"][0]["observedAt"] == TIME
            assert "ACCEPT" not in state and "REVIEWED" not in state
    sizing = json.loads(SIZING_FIXTURE.read_text())
    assert sizing["version"] == 1
    for case in sizing["plans"]:
        if case["phase"] != "authoring":
            assert case["expected"] == "retain-approved-scope"
            continue
        # Fixture-declared inseparability models the author's domain judgement;
        # this is not a runtime detector or an automatic plan mutation.
        groups = [{outcome} for outcome in case["outcomes"]]
        for edge in case["inseparable"]:
            joined = set().union(*(group for group in groups if group.intersection(edge)))
            groups = [group for group in groups if not group.intersection(edge)] + [joined]
        assert sorted(sorted(group) for group in groups) == sorted(sorted(group) for group in case["expected"])
    for case in sizing["diagnostics"]:
        choice = "reuse-existing" if case["existingHelperFits"] else (
            "consider-scoped-helper" if case["repeatedStructureProven"] else "bounded-command")
        assert choice == case["expected"], case["id"]
    print(f"continuity contracts: {len(fixture['cases'])} cases; candidate/instruction invalidation, "
          f"independent evidence and complete overflow; max summary {max(sizes)} UTF-8 bytes")
    print(f"milestone guidance: {len(sizing['plans'])} authoring/active-plan examples; "
          f"{len(sizing['diagnostics'])} repeated/one-off diagnostic decisions")


if __name__ == "__main__":
    main()
