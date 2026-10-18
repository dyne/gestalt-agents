"""Test-only report/review examples; no runtime parsing or agent simulation.

Artifact JSON is synthetic evidence with explicit provenance, not private logs.
The oracle compares independently read artifact observations with report claims.
"""
import copy
import hashlib
import json
from pathlib import Path
import re
import tempfile

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).with_name("fixtures")
BUDGET = 2048
SHA = "a" * 40
TIME = "2026-10-18T10:00:00Z"


def encode(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode()


def digest(data):
    return hashlib.sha256(data).hexdigest()


def example(case, directory):
    failures = case.get("failures", [f"test-{n}: expected ✓, got ✗"
                                   for n in range(case.get("failureCount", 0))])
    counts = case.get("counts", {"passed": 12, "failed": len(failures),
                                 "skipped": 0, "total": 12 + len(failures)})
    source = {"kind": "github", "repository": "github.example/fixture/project",
              "run": 42, "attempt": 2, "jobs": [7], "artifact": "checks.json"}
    candidate = {"sha": SHA, "branch": "fixture", "base": "c" * 40,
                 "diffDigest": "fixture-diff-digest"}
    artifact = {"candidate": copy.deepcopy(candidate), "source": copy.deepcopy(source),
                "command": "bash tests/run.sh", "cwd": "/fixture/project",
                "exit": case.get("artifactExit", case.get("exit", 0)),
                "counts": counts, "failures": failures,
                "format": case.get("format", "known"),
                "observedAt": case.get("artifactTime", TIME),
                "completeness": case.get("completeness", "complete")}
    artifact["candidate"]["sha"] = case.get("artifactSha", SHA)
    artifact["candidate"]["diffDigest"] = case.get("artifactDiff", candidate["diffDigest"])
    artifact["source"]["attempt"] = case.get("artifactAttempt", 2)
    data = encode(artifact)
    path = directory / "evidence.json"
    if not case.get("missing"):
        path.write_bytes(data + (b" " if case.get("tamper") else b""))
    reference = {"path": str(path), "digest": digest(data), "locator": "/failures",
                 "access": "authorized fixture workspace", "retention": "test lifetime",
                 "bytes": len(data)}
    check = {"command": artifact["command"], "cwd": artifact["cwd"],
             "exit": case.get("exit", 0), "counts": counts,
             "firstFailure": failures[0] if failures else None,
             "failureCount": len(failures), "evidence": 0}
    omitted = max(0, len(failures) - 1)
    report = {"version": 1, "milestone": "L2.1/evidence-contract",
              "scope": {"paths": ["fixture.py"], "diff": "evidence.json#diff", "impact": "fixture only"},
              "candidate": candidate, "source": source, "checks": [check],
              "observedAt": TIME, "completeness": artifact["completeness"],
              "uncertainty": "unsupported format" if counts is None else
                  "exit unavailable" if check["exit"] is None else
                  "capture incomplete" if artifact["completeness"] != "complete" else None,
              "references": [reference],
              "overflow": {"omittedEntries": omitted, "reference": 0,
                           "followupBytes": BUDGET} if omitted else None}
    return report, failures


def review(report, current):
    """Bounded independent evidence decision, without lifecycle transitions."""
    required = {"version", "milestone", "scope", "candidate", "source", "checks",
                "observedAt", "completeness", "uncertainty", "references", "overflow"}
    assert set(report) == required
    assert len(encode(report)) <= BUDGET, "unbounded routine report"
    assert report["scope"]["paths"] == sorted(report["scope"]["paths"])
    assert len(report["candidate"]["sha"]) == 40
    if report["candidate"] != current["candidate"] or report["source"] != current["source"]:
        return "stale"
    reference = report["references"][0]
    path = Path(reference["path"])
    if not path.is_file():
        return "needs-evidence"
    data = path.read_bytes()
    if digest(data) != reference["digest"] or len(data) != reference["bytes"]:
        return "contradictory"
    artifact = json.loads(data)
    if (artifact["candidate"] != current["candidate"] or
            artifact["source"] != current["source"] or
            artifact["observedAt"] < current["changedAt"]):
        return "stale"
    check = report["checks"][0]
    for field in ("command", "cwd", "exit", "counts"):
        if check[field] != artifact[field]:
            return "contradictory"
    failures = artifact["failures"]
    if (check["failureCount"] != len(failures) or
            check["firstFailure"] != (failures[0] if failures else None) or
            report["completeness"] != artifact["completeness"]):
        return "contradictory"
    if check["failureCount"] > 1:
        assert report["overflow"]["omittedEntries"] == len(failures) - 1
        assert report["overflow"]["followupBytes"] <= BUDGET
    if (artifact["completeness"] != "complete" or artifact["format"] == "unknown" or
            check["exit"] is None or check["counts"] is None):
        assert report["uncertainty"], "unknown evidence needs a reason"
        return "needs-evidence"
    counts = check["counts"]
    assert counts["total"] == counts["passed"] + counts["failed"] + counts["skipped"]
    return "failed" if check["exit"] != 0 or failures or counts["failed"] else "supported"


def main():
    cases = json.loads((FIXTURES / "supervisor-evidence-cases.json").read_text())
    assert cases["version"] == 1
    contract = (ROOT / "plugins/gestalt/skills/org-plan/references/evidence-report.md").read_text()
    fields = {line.split("`", 2)[1] for line in contract.splitlines() if line.startswith("| `")}
    assert fields == {"milestone", "scope", "candidate", "source", "checks", "observedAt",
                      "completeness", "references", "overflow"}
    assert "2048 UTF-8 bytes (2 KiB)" in contract
    inputs = json.loads((FIXTURES / "supervisor-role-inputs.json").read_text())
    templates = re.findall(r"```text\n(.*?)\n```", contract, re.S)
    assert len(templates) == 2
    assignment, request = [text.format_map(inputs) for text in templates]
    for rendered in (assignment, request):
        assert len(rendered.encode()) <= BUDGET
        assert inputs["milestone"] in rendered and inputs["plan_section"] in rendered
        assert inputs["sha"] in rendered and inputs["base"] in rendered
        assert inputs["task_sections"] in rendered
        assert "supervised-execution.md" in rendered
    assert inputs["governing_reads"] in assignment and inputs["skills"] in assignment
    assert inputs["contract"] in assignment and "2048 UTF-8 bytes" in assignment
    assert inputs["evidence_location"] in assignment
    assert "Root verifies independently" in assignment
    assert inputs["report_reference"] in request and inputs["dirty_digest"] in request
    assert inputs["exact_commands_and_results"] in request and inputs["observed_at"] in request
    assert "ACCEPT or REJECT" in request and "missing/conflicting" in request
    sizes = []
    with tempfile.TemporaryDirectory(prefix="evidence-contract-") as temporary:
        for case in cases["cases"]:
            directory = Path(temporary) / case["id"]
            directory.mkdir()
            report, failures = example(case, directory)
            sizes.append(len(encode(report)))
            current = {"candidate": report["candidate"], "source": report["source"], "changedAt": TIME}
            assert review(report, current) == case["expected"], case["id"]
            if not case.get("missing") and not case.get("tamper"):
                artifact = json.loads(Path(report["references"][0]["path"]).read_bytes())
                assert artifact["failures"] == failures  # Every omitted identifier remains retrievable.
                # Bounded follow-ups recover every omitted failure, including Unicode causes.
                recovered, page = [], []
                for failure in artifact["failures"]:
                    if len(encode(page + [failure])) > BUDGET:
                        assert len(encode(page)) <= BUDGET
                        recovered.extend(page)
                        page = []
                    page.append(failure)
                recovered.extend(page)
                assert len(encode(page)) <= BUDGET and recovered == failures
            if case["id"] == "success":
                forged = copy.deepcopy(report)
                forged["candidate"]["sha"] = "d" * 40
                assert review(forged, current) == "stale"
                # Negative controls: a zero exit cannot hide artifact failures or unknown counts.
                forged = copy.deepcopy(report)
                forged["checks"][0]["counts"]["failed"] = 1
                assert review(forged, current) == "contradictory"
                forged = copy.deepcopy(report)
                forged["scope"]["impact"] = "界" * 2048
                try:
                    review(forged, current)
                except AssertionError as error:
                    assert "unbounded" in str(error)
                else:
                    raise AssertionError("UTF-8 byte budget ignored")
                # The same format supports a local source with explicit inapplicable IDs.
                local = copy.deepcopy(report)
                local["source"] = {"kind": "local", "repository": "/fixture/project",
                                   "run": None, "attempt": None, "jobs": None,
                                   "reason": "local command; CI identities inapplicable"}
                path = Path(local["references"][0]["path"])
                artifact = json.loads(path.read_bytes())
                artifact["source"] = local["source"]
                path.write_bytes(encode(artifact))
                local["references"][0].update(digest=digest(path.read_bytes()), bytes=path.stat().st_size)
                assert review(local, {**current, "source": local["source"]}) == "supported"
    print(f"evidence contracts: {len(cases['cases'])} synthetic decisions, local/GitHub identity, "
          f"retrievable failures, UTF-8 budget and contradiction controls; max report {max(sizes)} bytes")
    print(f"role forms: generated assignment {len(assignment.encode())} bytes and review "
          f"{len(request.encode())} bytes; reports exercised against all {len(cases['cases'])} root decisions")


if __name__ == "__main__":
    main()
