"""Reproducible instruction counts and synthetic evidence baseline (stdlib only)."""
import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import tomllib

ROOT = Path(__file__).resolve().parents[3]
FIXTURES = Path(__file__).with_name("fixtures")
ORG = "plugins/gestalt/skills/org-plan/"
SOURCES = {
    "repository": "AGENTS.md",
    "org": ORG + "SKILL.md",
    "supervision": ORG + "references/supervised-execution.md",
    "evidence": ORG + "references/evidence-report.md",
    "routing": "plugins/gestalt/skills/context-mode/SKILL.md",
    "vendor-codex-guidance-inactive": "plugins/context-mode/configs/codex/AGENTS.md",
}


def counts(text):
    return {"words": len(text.split()), "bytes": len(text.encode("utf-8"))}


def inventory():
    sources = {key: {"path": path, **counts((ROOT / path).read_text())}
               for key, path in SOURCES.items()}
    with tempfile.TemporaryDirectory(prefix="instruction-delivery-") as tmp:
        subprocess.run([str(ROOT / ORG / "scripts/org-plan"), "prepare-supervision",
                        "--agents-dir", tmp], check=True, capture_output=True)
        for role in ("reviewer", "executor"):
            profile = tomllib.loads(Path(tmp, f"org-plan-{role}.toml").read_text())
            sources[f"profile-{role}"] = counts(profile["developer_instructions"])
    common = ["repository", "org", "supervision", "evidence", "routing"]
    paths = {"root": common + ["profile-reviewer"],
             "executor": common + ["profile-executor"], "terminal-reviewer": common}
    return {"sources": sources, "roles": {
        role: {"sources": keys, **{unit: sum(sources[key][unit] for key in keys)
                                 for unit in ("words", "bytes")}}
        for role, keys in paths.items()}}


def workflows():
    fixture = json.loads((FIXTURES / "context-evidence-workflows.json").read_text())
    assert fixture["schemaVersion"] == 1
    prefix = "\n".join(fixture["padding"]["template"].format(index=i)
                       for i in range(fixture["padding"]["lines"])) + "\n"
    results = {}
    for case in fixture["cases"]:
        log = prefix + "\n".join(case["tail"]) + "\n"
        assert len(log.encode()) > 20 * 1024
        for failure in case["expectedFailures"]:
            assert log.count(failure) == 1
        assert "token=" not in log and "/home/" not in log
        results[case["id"]] = {
            "rawBytes": len(log.encode()), "sha256": hashlib.sha256(log.encode()).hexdigest(),
            "exitCode": case["exitCode"], "expectedFailures": case["expectedFailures"],
            "complete": case["complete"],
        }
    repeated = fixture["repeatedQuery"]
    assert repeated["expectedFailureIds"] == results[repeated["case"]]["expectedFailures"]
    assert repeated["baselineFetches"] == repeated["baselineIndexes"] == len(repeated["questions"])
    return {"cases": results, "repeatedQuery": {
        "fetches": repeated["baselineFetches"], "indexes": repeated["baselineIndexes"],
        "returnedBytes": results[repeated["case"]]["rawBytes"] * len(repeated["questions"]),
    }}


if __name__ == "__main__":
    current = {"schemaVersion": 1, "instructions": inventory(), "workflows": workflows()}
    if "--json" in sys.argv:
        print(json.dumps(current, indent=2, sort_keys=True))
    else:
        baseline = json.loads((FIXTURES / "instruction-baseline.json").read_text())
        assert current["workflows"] == baseline["workflows"], "synthetic fixture drift"
        for role, data in current["instructions"]["roles"].items():
            before = baseline["instructions"]["roles"][role]
            print(f'{role}: {data["words"]} words/{data["bytes"]} bytes '
                  f'(baseline {before["words"]}/{before["bytes"]})')
        print("synthetic workflows: 4 deterministic logs; repeated-query baseline validated")
