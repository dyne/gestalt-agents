"""Reproducible instruction counts and synthetic evidence baseline (stdlib only)."""
import hashlib
import json
from pathlib import Path
import re
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
    "retrieval-conditional": "plugins/gestalt/skills/context-mode/references/bounded-retrieval.md",
    "vendor-codex-guidance-inactive": "plugins/context-mode/configs/codex/AGENTS.md",
}


def counts(text):
    return {"words": len(text.split()), "bytes": len(text.encode("utf-8"))}


def delivery_inventory(sources):
    """Count repository-owned delivery separately from unobserved host inputs.

    Catalog measures the discoverable name/description values, not hypothetical
    host formatting. Deferred references are available bytes, never startup cost.
    """
    groups = {
        "repository-bootstrap": ["repository"],
        "skill-entrypoints": ["org", "routing"],
        "generated-profiles": ["profile-reviewer", "profile-executor"],
        "required-references": ["supervision", "evidence"],
        "conditional-retrieval-reference": ["retrieval-conditional"],
        "inactive-vendor-example": ["vendor-codex-guidance-inactive"],
    }
    categories = {group: {"sources": keys, **{
        unit: sum(sources[key][unit] for key in keys) for unit in ("words", "bytes")}}
        for group, keys in groups.items()}
    catalog = []
    for path in sorted((ROOT / "plugins/gestalt/skills").glob("*/SKILL.md")):
        frontmatter = path.read_text().split("---", 2)[1]
        fields = dict(re.findall(r"^(name|description): (.+)$", frontmatter, re.M))
        assert set(fields) == {"name", "description"}, path
        catalog.append({"path": str(path.relative_to(ROOT)), **counts(
            fields["name"] + "\n" + fields["description"])})
    required = {sources[key]["path"] for key in ("supervision", "evidence")}
    deferred = [path for path in sorted((ROOT / ORG / "references").glob("*.md"))
                if str(path.relative_to(ROOT)) not in required]
    return {
        "categories": categories,
        "discoveryCatalog": {"entries": catalog, "count": len(catalog), **{
            unit: sum(entry[unit] for entry in catalog) for unit in ("words", "bytes")}},
        "deferredOrgReferences": {"paths": [str(p.relative_to(ROOT)) for p in deferred],
                                  **counts("".join(p.read_text() for p in deferred))},
        "hostInstructions": None, "toolSchemas": None,
        "unmeasuredReason": "Host-owned inputs and schema framing are outside this repository inventory.",
    }


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
    return {"sources": sources, "delivery": delivery_inventory(sources), "roles": {
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
        delivery = current["instructions"]["delivery"]
        print("delivery bytes: " + ", ".join(
            f"{key}={value['bytes']}" for key, value in delivery["categories"].items()))
        print(f"discovery metadata: {delivery['discoveryCatalog']['count']} entries/"
              f"{delivery['discoveryCatalog']['bytes']} bytes; "
              f"deferred Org references: {delivery['deferredOrgReferences']['bytes']} available bytes")
        print(delivery["unmeasuredReason"])
        print("synthetic workflows: 4 deterministic logs; repeated-query baseline validated")
