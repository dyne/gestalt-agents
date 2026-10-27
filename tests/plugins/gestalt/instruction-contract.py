"""Static delivery/decision contracts; human equivalence review uses the ledger.

These checks exercise generated delivery and canonical scenario branches. They
do not claim to simulate an agent or the Mobile runtime.
"""
import json
import hashlib
from pathlib import Path
import re
import runpy
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).with_name("fixtures")
ORG = ROOT / "plugins/gestalt/skills/org-plan"
SOURCES = {
    "org": ORG / "SKILL.md",
    "supervision": ORG / "references/supervised-execution.md",
    "evidence": ORG / "references/evidence-report.md",
    "routing": ROOT / "plugins/gestalt/skills/context-mode/SKILL.md",
    "retrieval": ROOT / "plugins/gestalt/skills/context-mode/references/bounded-retrieval.md",
    "continuity": ORG / "references/continuity-ledger.md",
    "format": ORG / "references/plan-format.md",
    "policy": ORG / "references/model-policy-workflow.md",
    "selection": ORG / "references/model-selection.md",
    "xerj": ROOT / "plugins/gestalt/skills/xerj/SKILL.md",
    "serena": ROOT / "plugins/gestalt/skills/serena/SKILL.md",
}


def sections(text):
    return {part.split("\n", 1)[0].strip(): part.split("\n", 1)[1]
            for part in text.split("\n## ")[1:]}


def scenario_text(documents, case):
    text = sections(documents[case["source"]])[case["section"]]
    if "outcome" in case:
        rows = [line.split("|")[1:3] for line in text.splitlines()
                if line.startswith("|")]
        rows = [action for key, action in rows
                if re.search(r"(?<![\w])" + re.escape(case["outcome"]) + r"(?![\w])", key)]
        assert len(rows) == 1, (case["id"], "missing/ambiguous decision row")
        text = rows[0]
    return re.sub(r"\s+", " ", text.replace("`", ""))


def check_scenarios(documents):
    fixture = json.loads((FIXTURES / "org-plan-instruction-scenarios.json").read_text())
    assert fixture["schemaVersion"] == 1
    ids = set()
    for case in fixture["scenarios"]:
        assert case["id"] not in ids
        ids.add(case["id"])
        text = scenario_text(documents, case)
        for pattern in case["requires"]:
            assert re.search(pattern, text, re.I), (case["id"], pattern)
    return len(ids)


def check_links(paths=None):
    for path in paths if paths is not None else [*SOURCES.values(), ROOT / "AGENTS.md"]:
        for target in re.findall(r"\]\(([^)]+)\)", path.read_text()):
            if "://" in target:
                continue
            relative, _, anchor = target.partition("#")
            destination = path.parent / relative if relative else path
            assert destination.is_file(), (path, target)
            if anchor:
                anchors = {re.sub(r"[^\w\- ]", "", line.lstrip("# ").lower()).replace(" ", "-")
                           for line in destination.read_text().splitlines() if line.startswith("#")}
                assert anchor in anchors, (path, target)


def check_profiles(directory):
    for role in ("reviewer", "executor"):
        profile = tomllib.loads((directory / f"org-plan-{role}.toml").read_text())
        text = profile["developer_instructions"]
        assert "Follow the org-plan skill and supervised-execution reference" in text
        assert "First tool call: read the org-plan skill completely and do nothing else" in text
        assert "Then read its supervised-execution reference and governing AGENTS.md before inspecting the plan or repository" in text
        assert "Gestalt skills may be declared in L1 Skills or loaded on demand when relevant" in text
        assert "Conditional capabilities require runtime readiness" in text
        assert "direct state edits are forbidden" in text
        assert "inspect git diff --cached --name-only" in text and ".gestalt/*.org" in text
        assert "Context-mode never mutates Org state" in text
        assert text.count("gestalt_org_plan_attention") == 1
        if role == "reviewer":
            assert profile["sandbox_mode"] == "read-only"
            assert "model=gpt-6.1-sol, reasoning_effort=medium; never inherit Astra" in text
            for rule in ("Your roster name is l0", "durable Mobile replacement authorization",
                         "before milestone or roster recovery", "preserves explicit manual Off",
                         "failed/result-less calls require same-turn supervision",
                         "End that turn even without checkpoint support", "only P0/P1 corrections"):
                assert rule.lower() in text.lower(), rule
        else:
            assert "sandbox_mode" not in profile
            for rule in ("only code writer", "Own the entire assigned L1", "report only to the root",
                         "load the declared L1 Skills", "stop without edits",
                         "Additional relevant skills may be loaded without a plan revision",
                         "At each DONE L2", "remain assigned", "Keep changes uncommitted through L1 review",
                         "On REJECT, correct the same diff", "After ACCEPT"):
                assert rule in text, rule


def main():
    documents = {key: path.read_text() for key, path in SOURCES.items()}
    assert "Plans may declare `$gestalt:context-mode` when relevant" in documents["routing"]
    assert "Org Plans may declare `$gestalt:xerj` when relevant" in documents["xerj"]
    count = check_scenarios(documents)
    check_links()
    # Required references fail closed; a plausible link label is insufficient.
    with tempfile.TemporaryDirectory(prefix="instruction-missing-reference-") as directory:
        entrypoint = Path(directory) / "SKILL.md"
        entrypoint.write_text("Read [required lifecycle](references/supervised-execution.md).\n")
        try:
            check_links([entrypoint])
        except AssertionError:
            pass
        else:
            raise AssertionError("missing required reference accepted")
    # A lost critical action must fail even if its outcome key survives.
    damaged = dict(documents)
    damaged["supervision"] = documents["supervision"].replace("Do not retry the lease", "Retry the lease")
    try:
        check_scenarios(damaged)
    except AssertionError:
        pass
    else:
        raise AssertionError("scenario contract accepted reversed lease action")
    damaged = dict(documents)
    damaged["supervision"] = documents["supervision"].replace(
        "No repeated\nhealth/list/status loops", "Create repeated\nhealth/list/status loops")
    try:
        check_scenarios(damaged)
    except AssertionError:
        pass
    else:
        raise AssertionError("scenario contract accepted a running-worker polling loop")
    damaged = dict(documents)
    damaged["policy"] = documents["policy"].replace("Never inherit Astra", "Inherit Astra")
    try:
        check_scenarios(damaged)
    except AssertionError:
        pass
    else:
        raise AssertionError("scenario contract accepted inherited Astra")
    for replacement in ("Use a tool-call quota and blanket grep ban", "Always use native grep"):
        damaged = dict(documents)
        damaged["routing"] = re.sub(r"For broad or repeated source discovery.*?every command\.",
                                      replacement, documents["routing"], flags=re.S)
        try:
            check_scenarios(damaged)
        except AssertionError:
            pass
        else:
            raise AssertionError("scenario contract accepted routing regression")
    damaged = dict(documents)
    damaged["retrieval"] = documents["retrieval"].replace(
        "Changed bytes or candidate inputs invalidate current claims",
        "Changed bytes or candidate inputs preserve current claims")
    try:
        check_scenarios(damaged)
    except AssertionError:
        pass
    else:
        raise AssertionError("scenario contract accepted stale artifact reuse")
    if "--profiles" in sys.argv:
        check_profiles(Path(sys.argv[sys.argv.index("--profiles") + 1]))
    else:
        with tempfile.TemporaryDirectory(prefix="instruction-contract-") as directory:
            subprocess.run([str(ORG / "scripts/org-plan"), "prepare-supervision", "--agents-dir", directory],
                           check=True, capture_output=True)
            check_profiles(Path(directory))
    baseline = runpy.run_path(str(Path(__file__).with_name("instruction-baseline.py")))
    current = baseline["inventory"]()
    l5 = json.loads((FIXTURES / "instruction-l5-baseline.json").read_text())
    assert l5["version"] == 1
    assert hashlib.sha256((FIXTURES / "supervisor-role-inputs.json").read_bytes()).hexdigest() == l5["roleInputsSha256"]
    # Historical reduction experiments remain evidence, not permanent release limits.
    budgets = json.loads((ROOT / "plugins/context-mode/benchmark/fixtures/overhead-budgets.json").read_text())
    for role, data in current["roles"].items():
        for unit in ("words", "bytes"):
            assert data[unit] <= budgets["roles"][role][unit], (role, unit, "instruction ceiling exceeded")
    for name, limits in budgets["profiles"].items():
        for unit in ("words", "bytes"):
            assert current["sources"][name][unit] <= limits[unit], (name, unit, "profile ceiling exceeded")
    delivery = current["delivery"]
    assert delivery["hostInstructions"] is None and delivery["toolSchemas"] is None
    assert delivery["discoveryCatalog"]["count"] == 20
    categories = delivery["categories"]
    assert categories["required-references"]["sources"] == ["supervision", "evidence"]
    assert categories["inactive-vendor-example"]["sources"] == ["vendor-codex-guidance-inactive"]
    # Inactive vendor guidance cannot be counted as delivered savings.
    for data in current["roles"].values():
        assert "vendor-codex-guidance-inactive" not in data["sources"]
    for role, data in current["roles"].items():
        assert "evidence" in data["sources"], (role, "mandatory evidence read omitted")
        assert current["sources"]["evidence"]["path"] == "plugins/gestalt/skills/org-plan/references/evidence-report.md"
    print(f"instruction contracts: {count} scenarios, bootstrap delivery, links, negative control, shared instruction ceilings")


if __name__ == "__main__":
    main()
