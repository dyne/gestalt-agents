"""Test-only report/review examples; no runtime parsing or agent simulation.

Artifact JSON is synthetic evidence with explicit provenance, not private logs.
The oracle compares independently read artifact observations with report claims.
"""
import copy
import base64
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
    if case.get("longCause"):
        failures = ["oversized-case: " + "cause ✓\n" * 4000]
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
             "firstFailure": failures[0][:160] if failures else None,
             "failureCount": len(failures), "evidence": 0}
    if "summary" in case:
        check["summary"] = case["summary"]
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
    if case.get("displayTruncated"):
        # Bounded transport pages can split even a single huge Unicode cause.
        payload = encode(failures)
        pages = []
        for offset in range(0, len(payload), 900):
            chunk = payload[offset:offset + 900]
            page = {"offset": offset, "data": base64.b64encode(chunk).decode(),
                    "nextOffset": offset + len(chunk) if offset + len(chunk) < len(payload) else None}
            data = encode(page)
            assert len(data) <= BUDGET
            page_path = directory / f"page-{offset}.json"
            page_path.write_bytes(data)
            pages.append({"path": str(page_path), "digest": digest(data), "bytes": len(data)})
        manifest = directory / "continuation.json"
        manifest.write_bytes(encode({"pages": pages, "payloadDigest": digest(payload)}))
        report["overflow"] = {"omittedEntries": omitted, "reference": 0,
                              "followupBytes": BUDGET, "displayTruncated": True,
                              "omittedBytes": len(payload),
                              "continuation": {"path": str(manifest), "digest": digest(manifest.read_bytes()),
                                               "bytes": manifest.stat().st_size}}
        if case.get("continuation") == "missing":
            manifest.unlink()
        elif case.get("continuation") == "missing-page":
            Path(pages[-1]["path"]).unlink()
    return report, failures


def continuation_coverage(report, failures, retrieve, reader=Path.read_bytes):
    overflow = report["overflow"]
    if not overflow or not overflow.get("displayTruncated"):
        return "complete"
    if retrieve == "none":
        return "incomplete"
    ref = overflow["continuation"]
    path = Path(ref["path"])
    try:
        data = reader(path)
    except FileNotFoundError:
        return "incomplete"
    if digest(data) != ref["digest"] or len(data) != ref["bytes"]:
        return "incomplete"
    manifest = json.loads(data)
    recovered = b""
    pages = manifest["pages"] if retrieve == "all" else manifest["pages"][:1]
    for ref in pages:
        path = Path(ref["path"])
        try:
            data = reader(path)
        except FileNotFoundError:
            return "incomplete"
        if digest(data) != ref["digest"] or len(data) != ref["bytes"] or len(data) > BUDGET:
            return "incomplete"
        page = json.loads(data)
        if page["offset"] != len(recovered):
            return "incomplete"
        recovered += base64.b64decode(page["data"], validate=True)
        expected_next = len(recovered) if len(recovered) < len(encode(failures)) else None
        if page["nextOffset"] != expected_next:
            return "incomplete"
    return "complete" if recovered == encode(failures) and digest(recovered) == manifest["payloadDigest"] else "incomplete"


def review(report, current, observation=None, reader=Path.read_bytes):
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
    try:
        data = reader(path)
    except FileNotFoundError:
        return "needs-evidence"
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
            check["firstFailure"] != (failures[0][:160] if failures else None) or
            report["completeness"] != artifact["completeness"]):
        return "contradictory"
    if check["failureCount"] > 1:
        assert report["overflow"]["omittedEntries"] == len(failures) - 1
        assert report["overflow"]["followupBytes"] <= BUDGET
    coverage = continuation_coverage(report, failures, current.get("retrieveOverflow", "all"), reader)
    if artifact["completeness"] != "complete" or artifact["format"] == "unknown":
        coverage = "incomplete"
    if observation is not None:
        observation["failureCoverage"] = coverage
        observation["captureCompleteness"] = artifact["completeness"]
        observation["displayTruncated"] = bool(report["overflow"] and report["overflow"].get("displayTruncated"))
    # Known failure is never erased by incomplete diagnostics or optimistic prose.
    if check["counts"] is not None:
        counts = check["counts"]
        assert counts["total"] == counts["passed"] + counts["failed"] + counts["skipped"]
        assert all(value >= 0 for value in counts.values())
    if check["exit"] not in (None, 0) or failures or (check["counts"] and check["counts"]["failed"]):
        return "failed"
    if (artifact["completeness"] != "complete" or artifact["format"] == "unknown" or
            check["exit"] is None or check["counts"] is None):
        assert report["uncertainty"], "unknown evidence needs a reason"
        return "needs-evidence"
    counts = check["counts"]
    if coverage != "complete" or counts["passed"] + counts["failed"] == 0:
        return "needs-evidence"
    return "supported"


class FreshReceiver:
    """Test-only authorization boundary; no runtime permissions are changed."""

    def __init__(self, allowed, denied=()):
        self.allowed = [path.resolve() for path in allowed]
        self.denied = {path.resolve() for path in denied}
        self.session = "fresh-receiver"
        self.reads, self.rejected = [], []
        self.sources = {}

    def read(self, path):
        canonical = path.resolve()
        if canonical in self.denied or not any(canonical.is_relative_to(root) for root in self.allowed):
            self.rejected.append(str(canonical))
            raise PermissionError("fixture receiver denied path")
        data = canonical.read_bytes()
        self.reads.append(str(canonical))
        return data

    def receive(self, packet, current):
        if "manifest" not in packet:
            return "needs-evidence"  # No inherited private source/report lookup.
        try:
            reference = packet["manifest"]
            data = self.read(Path(reference["path"]))
            if digest(data) != reference["sha256"]:
                return "contradictory"
            manifest = json.loads(data)
            # Reading current source observations is required, even when the
            # sender's manifest and optimistic findings are internally intact.
            result = review(manifest["report"], current, reader=self.read)
            if result in ("supported", "failed"):
                self.sources[f"{self.session}/source-1"] = manifest["report"]["observedAt"]
            return result
        except PermissionError:
            return "denied"
        except FileNotFoundError:
            return "needs-evidence"


def handoff_scenarios(cases):
    ids = set()
    for case in cases:
        assert case["id"] not in ids
        ids.add(case["id"])
        with tempfile.TemporaryDirectory(prefix="handoff-contract-") as temporary:
            root = Path(temporary)
            shared, other, private = [root / name for name in ("shared", "other", "sender-private")]
            for path in (shared, other, private):
                path.mkdir()
            report, _ = example(case.get("evidence", {}), shared)
            current = {"candidate": copy.deepcopy(report["candidate"]),
                       "source": copy.deepcopy(report["source"]), "changedAt": TIME}
            artifact = Path(report["references"][0]["path"])
            denied = []
            change = case.get("change")
            if change == "private-session":
                target = private / "private.json"
                artifact.rename(target)
                report["references"][0]["path"] = str(target)
            elif change == "symlink":
                target = other / "outside.json"
                artifact.rename(target)
                artifact.symlink_to(target)
            elif change == "artifact-hash":
                artifact.write_bytes(artifact.read_bytes() + b" ")
            elif change == "inaccessible":
                denied.append(artifact)
            elif change == "continuation-denied":
                denied.append(Path(report["overflow"]["continuation"]["path"]))
            elif change == "page-denied":
                continuation = json.loads(Path(report["overflow"]["continuation"]["path"]).read_bytes())
                denied.append(Path(continuation["pages"][-1]["path"]))
            elif change == "stale-candidate":
                current["candidate"]["diffDigest"] = "current-independent-dirty-digest"
            elif change == "wrong-attempt":
                current["source"]["attempt"] = 3
            manifest = shared / "handoff.json"
            manifest.write_bytes(encode({"version": 1, "senderSession": "sender-private",
                                         "sourceId": "sender/source-7", "report": report}))
            packet = {"findings": "Sender claims success", "manifest": {
                "path": str(manifest), "sha256": digest(manifest.read_bytes())}}
            if change == "manifest-hash":
                manifest.write_bytes(manifest.read_bytes() + b" ")
            elif change == "id-only":
                packet = {"report": "sender/report-7", "sourceId": "sender/source-7"}
            receiver = FreshReceiver([other if change == "wrong-workspace" else shared], denied)
            assert receiver.receive(packet, current) == case["expected"], case["id"]
            assert len(encode(packet)) <= BUDGET
            if case["expected"] == "denied":
                assert receiver.rejected
                assert not set(receiver.reads) & set(receiver.rejected), "denied bytes read"
            if case["expected"] in ("supported", "failed"):
                assert str(artifact.resolve()) in receiver.reads, "sender summary trusted without inspection"
                assert receiver.sources == {"fresh-receiver/source-1": TIME}
            else:
                assert not receiver.sources, "invalid evidence imported as current"
            if change == "id-only":
                assert not receiver.reads
    print(f"fresh handoffs: {len(ids)} decisions passed; 0 failed/0 skipped; synthetic authorization only")


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
    baseline = json.loads((FIXTURES / "instruction-l5-baseline.json").read_text())
    assert len(assignment.encode()) < baseline["forms"]["assignmentBytes"]
    assert len(request.encode()) < baseline["forms"]["reviewBytes"]
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
            current["retrieveOverflow"] = case.get("retrieve", "all")
            observation = {}
            assert review(report, current, observation) == case["expected"], case["id"]
            if "expectedCoverage" in case:
                assert observation["failureCoverage"] == case["expectedCoverage"], case["id"]
                assert observation["displayTruncated"] is True
                assert observation["captureCompleteness"] == "complete"
                if case["expectedCoverage"] == "incomplete":
                    assert review(report, current) != "supported"
            if not case.get("missing") and not case.get("tamper"):
                artifact = json.loads(Path(report["references"][0]["path"]).read_bytes())
                assert artifact["failures"] == failures  # Every omitted identifier remains retrievable.
                # Bounded follow-ups recover every omitted failure, including Unicode causes.
                if not case.get("displayTruncated"):
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
    handoff_scenarios(cases["handoffs"])


if __name__ == "__main__":
    main()
