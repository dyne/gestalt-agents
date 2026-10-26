"""Synthetic routing front half of the executable composed evidence workflow.

No provider calls, service mutations or model-adherence claims. JSON output is
consumed by the existing context-mode evidence/overhead test harness.
"""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile

sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location("routing", Path(__file__).with_name("routing-contract.py"))
routing = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routing)


def run():
    fixture = json.loads((routing.FIXTURES / "context-evidence-workflows.json").read_text())
    results = []
    for case in fixture["composedHarmony"]["cases"]:
        with tempfile.TemporaryDirectory(prefix="composed-routing-") as directory:
            root = Path(directory)
            files = fixture["sourceRouting"]["files"]
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content)
            before = {p.relative_to(root).as_posix(): routing.digest(p.read_text())
                      for p in root.rglob("*") if p.is_file()}
            source_case = dict(case, intent=case.get("intent", "broad"),
                               repositories=["alpha", "fork"], query="checkout")
            source_case["expected"] = "native" if source_case["intent"] == "precise" or case.get("catalog") else "xerj"
            if case.get("catalog"):
                source_case["reason"] = case["catalog"]
            else:
                if source_case["expected"] == "xerj":
                    source_case["expectedAliases"] = ["alpha/src/cart.py", "fork/src/cart.py"]
            source = routing.replay(root, files, source_case)
            routing.validate(source_case, source)
            semantic_root = root / "semantic"
            semantic_root.mkdir()
            semantic = routing.SemanticActor(semantic_root, case)
            ready = semantic.probe()
            routing.validate_semantics(dict(case, expectedReady=case.get("connected", True)
                                            and case.get("language") != "unsupported",
                                            **({"expectedReason": "connection"} if not case.get("connected", True)
                                               else {"expectedReason": "language"} if case.get("language") == "unsupported"
                                               else {})), ready, semantic)
            assert before == {name: routing.digest((root / name).read_text()) for name in before}
            assert all(p.relative_to(root).as_posix() in before or "semantic" in p.relative_to(root).parts[:1]
                       for p in root.rglob("*") if p.is_file()), "forbidden fixture write"
            events = source["events"] + ["semantic-probe"] + semantic.events
            assert events.index("current-file") < events.index("semantic-probe")
            results.append({"id": case["id"], "events": events, "route": source["tool"],
                            "aliases": [p for hit in source["hits"] for p in hit["aliases"]],
                            "provenance": source["inspected"], "semantic": ready})
        assert not root.exists(), "routing fixture cleanup failed"
    return results


if __name__ == "__main__":
    print(json.dumps(run()))
