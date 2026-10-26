"""Offline routing contract replay; never invokes providers or changes indexes.

Synthetic source/index facts exercise the guidance's decision boundaries, not
model adherence. Actual source reads check provenance and post-retrieval drift.
"""
import ast
import hashlib
import json
from pathlib import Path
import tempfile

FIXTURES = Path(__file__).with_name("fixtures")


def digest(data):
    return hashlib.sha256(data.encode()).hexdigest()


def replay(root, files, case):
    """A test-only actor with an immutable synthetic lexical index snapshot."""
    events = []
    state = case.get("catalog", "fresh")
    tool = "native" if case["intent"] == "precise" or state != "fresh" else "xerj"
    reason = state if case["intent"] == "broad" and tool == "native" else None
    # Group shared content as XERJ does; retain *all* source aliases.
    index = {}
    for path, content in files.items():
        hit = index.setdefault(digest(content), {"content": content, "aliases": []})
        hit["aliases"].append(path)
    targets = [path for path in files if path.split("/")[0] in case["repositories"]]
    hits = []
    for _ in range(case.get("repeat", 1)):
        events.append(tool)
        if tool == "xerj":
            hits = [{"sha256": sha, "aliases": sorted(hit["aliases"])}
                    for sha, hit in index.items() if case["query"] in hit["content"]
                    and any(p in targets for p in hit["aliases"])]
    if case.get("editAfterRetrieval"):
        (root / targets[0]).write_text("def checkout(): return 'changed'\n")
    # Index hits are locators, never authority to assert current behavior.
    inspected = {}
    paths = sorted({p for hit in hits for p in hit["aliases"] if p in targets})
    if tool == "native" or not hits:
        paths = targets
    for path in paths:
        events.append("current-file")
        current = (root / path).read_text()
        inspected[path] = {"repository": path.split("/")[0], "sha256": digest(current),
                           "matches": case["query"] in current, "current": current}
    return {"tool": tool, "reason": reason, "events": events, "hits": hits,
            "inspected": inspected}


def validate(case, result):
    assert result["tool"] == case["expected"], case["id"]
    assert result["reason"] == case.get("reason"), case["id"]
    assert result["events"].count(case["expected"]) == case.get("repeat", 1)
    assert result["inspected"], "current source was never inspected"
    assert result["events"].index("current-file") > 0
    if case.get("expectedAliases"):
        assert result["hits"][0]["aliases"] == case["expectedAliases"]
        assert {v["repository"] for v in result["inspected"].values()} == set(case["repositories"])
    if case.get("confirmNoMatch"):
        assert not result["hits"]
        assert not any(v["matches"] for v in result["inspected"].values())
    if case.get("editAfterRetrieval"):
        assert result["inspected"]["alpha/src/cart.py"]["sha256"] != result["hits"][0]["sha256"]
        assert "changed" in result["inspected"]["alpha/src/cart.py"]["current"]


class SemanticActor:
    """A synthetic provider boundary; no installed service, tool or cache use."""

    def __init__(self, root, case):
        self.root, self.case = root, case
        self.failures = {}
        self.events = []
        self.probes = self.warmups = 0
        self.overview_bytes = self.overview_budget = None
        self.runtime = "runtime-1"
        self.config = "config-1"
        self.definition = root / "alpha/definition.py"
        self.caller = root / "alpha/caller.py"
        self.definition.parent.mkdir()
        padding = "".join(f"def helper_{i}(): return {i}\n" for i in range(180)) \
            if case.get("overview") == "too-long" else ""
        self.definition.write_text("def target(): return 1\n" + padding)
        self.caller.write_text("from definition import target\ndef caller(): return target()\n")
        if case.get("callerAbsent"):
            self.caller.write_text("def caller(): return 2\n")
        self.compilation = root / "alpha/compile_commands.json"
        if case.get("compilation") != "missing":
            build = "other" if case.get("compilation") == "wrong-build" else "debug"
            self.compilation.write_text(json.dumps([{
                "directory": str(root / f"alpha/build/{build}"),
                "file": str(root / ("fork/target.cpp" if case.get("wrongCompilationFile") else "alpha/target.cpp")),
                "arguments": ["clang++", "-std=c++20", "-Iinclude", "target.cpp"]}]))
        (root / "alpha/target.cpp").write_text("int target() { return 1; }\nint caller() { return target(); }\n")
        if not case.get("missingGeneratedHeader"):
            (root / "alpha/generated.h").write_text("// synthetic generated input\n")

    def key(self):
        return (self.case.get("effectiveRepository", "alpha"), "debug",
                tuple((str(p.relative_to(self.root)), digest(p.read_text()))
                      for p in sorted((self.root / "alpha").iterdir()) if p.is_file()),
                self.config, self.runtime)

    def known_relation(self, references):
        self.events.extend(["definition", "references", "current-file"])
        if self.case.get("language") == "cpp":
            source = (self.root / "alpha/target.cpp").read_text()
            return references and "int target()" in source and "return target();" in source
        # Actual current synthetic Python ASTs independently establish the
        # definition/call relation against which provider observations are checked.
        definitions = ast.parse(self.definition.read_text())
        caller = ast.parse(self.caller.read_text())
        return references and any(isinstance(n, ast.FunctionDef) and n.name == "target"
                                  for n in ast.walk(definitions)) and any(
            isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "target"
            for n in ast.walk(caller))

    def probe(self):
        key = self.key()
        if key in self.failures:
            self.events.append("cached-failure")
            return self.failures[key]
        self.probes += 1
        c = self.case
        reason = None
        if not c.get("connected", True):
            reason = "connection"
        elif c.get("effectiveRepository", "alpha") != "alpha":
            reason = "repository"
        elif c.get("language", "python") not in ("python", "cpp"):
            reason = "language"
        elif c.get("language") == "cpp":
            entries = json.loads(self.compilation.read_text()) if self.compilation.exists() else []
            if not entries or entries[0]["directory"] != str(self.root / "alpha/build/debug") \
                    or entries[0]["file"] != str(self.root / "alpha/target.cpp") \
                    or "-std=c++20" not in entries[0]["arguments"] \
                    or not (self.root / "alpha/generated.h").exists():
                reason = "compilation"
        if reason is None:
            self.events.append("overview")
            names = [n.name for n in ast.walk(ast.parse(self.definition.read_text()))
                     if isinstance(n, ast.FunctionDef)]
            overview, budget = json.dumps(names), 1500
            if len(overview.encode()) > budget:
                # Sizing recovers in the same repository without warming caches.
                recovery = c.get("recovery", "narrow")
                assert recovery != "budget" or c.get("budgetReason")
                self.events.append(recovery)
                if recovery == "narrow":
                    overview = json.dumps([n for n in names if n == "target"])
                else:
                    budget = len(overview.encode()) + 100
                    assert budget <= 8192, "fixture's justified bound exceeded"
            self.overview_bytes, self.overview_budget = len(overview.encode()), budget
            assert self.overview_bytes <= budget
            relation = self.known_relation(c.get("references", True))
            if not relation and c.get("warmupUseful") and c.get("cacheWritable"):
                self.events.append("managed-index")
                self.warmups += 1
                relation = self.known_relation(c.get("warmupRestoresReferences", False))
            if not relation:
                reason = "references"
        result = {"ready": reason is None, "relation": reason is None,
                  "reason": reason, "editAllowed": reason is None and c.get("writeAuthorized", True)}
        if reason:
            self.events.append("native-fallback")
            self.failures[key] = result
        return result


def validate_semantics(case, result, actor):
    assert result["ready"] == case["expectedReady"], case["id"]
    assert result["reason"] == case.get("expectedReason"), case["id"]
    assert result["editAllowed"] == (case["expectedReady"] and case.get("writeAuthorized", True))
    assert result["relation"] == result["ready"]
    assert actor.probes == case.get("expectedProbes", 1)
    assert actor.warmups == case.get("expectedWarmups", 0)
    if case.get("expectedRecovery"):
        assert case["expectedRecovery"] in actor.events
        assert "managed-index" not in actor.events
        assert actor.overview_bytes <= actor.overview_budget
        assert actor.overview_budget == 1500 if case["expectedRecovery"] == "narrow" \
            else 1500 < actor.overview_budget <= 8192
    if result["ready"]:
        assert "definition" in actor.events and "references" in actor.events
        assert actor.events.index("overview") < actor.events.index("references")
    else:
        assert "native-fallback" in actor.events
    assert not set(actor.events) & {"install", "switch-project", "restart", "permission-bypass"}


def semantic_scenarios():
    fixture = json.loads((FIXTURES / "context-evidence-workflows.json").read_text())["semanticRouting"]
    assert fixture["version"] == 1
    ids = set()
    for case in fixture["cases"]:
        assert case["id"] not in ids
        ids.add(case["id"])
        with tempfile.TemporaryDirectory(prefix="semantic-contract-") as directory:
            actor = SemanticActor(Path(directory), case)
            for attempt in range(case.get("attempts", 1)):
                if attempt and case.get("change") == "source":
                    actor.caller.write_text(actor.caller.read_text() + "# changed\n")
                elif attempt and case.get("change") == "config":
                    actor.config = "config-2"
                elif attempt and case.get("change") == "runtime":
                    actor.runtime = "runtime-2"
                result = actor.probe()
            validate_semantics(case, result, actor)
            broken = dict(result, ready=not result["ready"])
            try:
                validate_semantics(case, broken, actor)
            except AssertionError:
                pass
            else:
                raise AssertionError("semantic readiness regression accepted")
    print(f"semantic routing: {len(ids)} scenarios passed; 0 failed/0 skipped; synthetic provider only")


class DiscoveryActor:
    """Selective schema resolution model scoped by agent/runtime generation."""

    def __init__(self, root):
        self.root = root
        (root / "AGENTS.md").write_text("Synthetic mandatory instruction\n")
        self.agent, self.runtime, self.generation = "parent", 1, 1
        self.read_agents, self.bindings = set(), {}
        self.metadata, self.schemas, self.native_reads = [], [], []
        self.catalog = {"provider_relation": {
            "name": "provider_relation", "description": "Find symbol references",
            "schema": {"required": ["symbol"]}}}
        for i in range(200):
            self.catalog[f"unrelated_{i}"] = {
                "name": f"unrelated_{i}", "description": "Unrelated capability",
                "schema": {"required": [f"unused_{i}"], "padding": "x" * 1000}}

    def resolve(self, query):
        if self.agent not in self.read_agents:
            # These are disposable test instructions, not runtime instruction IO.
            assert (self.root / "AGENTS.md").read_text() == "Synthetic mandatory instruction\n"
            self.native_reads.append((self.agent, "native-governing-read"))
            self.read_agents.add(self.agent)
        key = (self.agent, self.runtime, self.generation, query)
        if key in self.bindings:
            return self.bindings[key]
        selected = [{k: t[k] for k in ("name", "description")}
                    for t in self.catalog.values()
                    if query in t["name"] or query in t["description"]]
        self.metadata.append(selected)
        if not selected:
            return None
        assert len(selected) == 1, "fixture selection must be precise"
        name = selected[0]["name"]
        self.schemas.append(name)
        schema = self.catalog[name]["schema"]
        if schema is None:
            return None  # Native fallback; no fabricated argument contract.
        self.bindings[key] = json.loads(json.dumps(schema))
        return self.bindings[key]


def validate_discovery(case, actor, result):
    assert len(actor.metadata) == case["expectedMetadata"], case["id"]
    assert len(actor.schemas) == case["expectedSchemas"], case["id"]
    assert len(actor.native_reads) == case["expectedNativeReads"], case["id"]
    assert (result is None) == case.get("expectedFallback", False), case["id"]
    for selected in actor.metadata:
        assert len(selected) <= 1, "whole catalog leaked"
        assert all(set(entry) == {"name", "description"} for entry in selected)
        assert all(entry["name"] == "provider_relation" for entry in selected), "unselected metadata"
    assert all(name == "provider_relation" for name in actor.schemas), "unchosen schema fetched"
    if result is not None:
        assert result["required"] == case.get("expectedFields", ["symbol"])


def discovery_scenarios():
    fixture = json.loads((FIXTURES / "context-evidence-workflows.json").read_text())["schemaDiscovery"]
    assert fixture["version"] == 1
    ids = set()
    for case in fixture["cases"]:
        assert case["id"] not in ids
        ids.add(case["id"])
        with tempfile.TemporaryDirectory(prefix="discovery-contract-") as directory:
            actor = DiscoveryActor(Path(directory))
            for action in case["actions"]:
                query = "symbol references" if action == "description" else "provider_relation"
                if action == "tool-set":
                    actor.generation += 1
                    actor.catalog["provider_relation"]["schema"] = {"required": ["symbol", "repository"]}
                elif action == "reconnect":
                    actor.runtime += 1
                elif action in ("missing", "unavailable"):
                    actor.catalog["provider_relation"]["schema"] = None
                    if action == "unavailable":
                        # An observed unavailable-tool error invalidates bindings
                        # even when the tool generation itself did not change.
                        actor.bindings.clear()
                elif action == "child":
                    actor.agent = "fresh-child"
                elif action == "no-match":
                    query = "absent_alias"
                result = actor.resolve(query)
            validate_discovery(case, actor, result)
            # Exercise the oracle against whole-catalog output and guessed schema.
            actor.metadata[-1].append({"name": "unrelated", "description": "not selected"})
            try:
                validate_discovery(case, actor, result)
            except AssertionError:
                pass
            else:
                raise AssertionError("whole catalog accepted")
            actor.metadata[-1].pop()
            if case.get("expectedFallback"):
                try:
                    validate_discovery(case, actor, {"required": ["guessed"]})
                except AssertionError:
                    pass
                else:
                    raise AssertionError("fabricated schema accepted")
    print(f"schema discovery: {len(ids)} scenarios passed; 0 failed/0 skipped; synthetic catalog only")


class ArtifactActor:
    """Test-only retained source, with actual bytes and candidate fingerprints.

    This models contract decisions, not an implementation of context-mode.
    """

    def __init__(self, root):
        self.root = root
        self.repository = "fixture/alpha"
        self.head = "a" * 40
        self.known = True
        self.candidate = root / "candidate"
        self.candidate.mkdir()
        (self.candidate / "tracked.py").write_text("def checkout(): return 1\n")
        (self.candidate / "config.json").write_text('{"variant":"debug"}\n')
        self.path = root / "run.log"
        self.path.write_text("setup\n" * 5000 + "FAIL checkout: empty cart\nFAIL payment: timeout\n")
        self.indexes = 0
        self.sources = {}
        self.corpus = True
        self.expired = False
        self.now = "2026-10-18T10:00:00Z"
        self.capture = {"observedAt": "2026-10-18T10:00:00Z", "command": "fixture-check",
                        "exit": 1, "completeness": "complete"}
        self.retained = self.identity()

    def candidate_identity(self):
        if not self.known:
            return None
        # Includes tracked, config and untracked bytes: matching HEAD is weaker.
        return {"repository": self.repository, "head": self.head,
                "content": [(str(p.relative_to(self.candidate)), digest(p.read_text()))
                            for p in sorted(self.candidate.rglob("*")) if p.is_file()]}

    def identity(self):
        return {"path": str(self.path), "sha256": digest(self.path.read_text()),
                "candidate": self.candidate_identity(), **self.capture}

    def index(self):
        self.indexes += 1
        self.corpus = True
        self.source = f"source-{self.indexes}"
        self.sources[self.source] = self.path.read_text()

    def query(self, question, repeated):
        if self.expired or not self.path.is_file() or not self.known:
            return {"action": "needs-evidence", "findings": [], "reference": self.retained}
        current = self.identity()
        if current["candidate"] != self.retained["candidate"]:
            return {"action": "stale", "findings": [], "reference": self.retained}
        action = "scoped-search" if repeated else "execute_file"
        if current["sha256"] != self.retained["sha256"]:
            action = "current-read"
            self.retained = current
            self.sources.clear()
        if repeated:
            if not self.corpus or getattr(self, "source", None) not in self.sources:
                if action != "current-read":
                    action = "reindex" if self.indexes else "scoped-search"
                self.index()
            data = self.sources[self.source]
        else:
            data = self.path.read_text()
        findings = [line for line in data.splitlines() if question in line]
        reference = dict(self.retained, source=getattr(self, "source", None))
        return {"action": action, "findings": findings, "reference": reference}


def validate_artifact(case, actor, result):
    assert result["action"] == case["expectedAction"], case["id"]
    assert actor.indexes == case["expectedIndexes"], case["id"]
    reference = result["reference"]
    assert all(reference[k] == v for k, v in actor.capture.items())
    if result["action"] in ("stale", "needs-evidence"):
        assert not result["findings"], "invalidated artifact supplied current findings"
        if result["action"] == "stale":
            assert reference["candidate"] != actor.candidate_identity()
    else:
        assert reference["candidate"] == actor.candidate_identity()
        assert reference["sha256"] == digest(actor.path.read_text())
        # Independent current file inspection checks the scoped synthetic index.
        assert result["findings"] == [line for line in actor.path.read_text().splitlines()
                                      if "payment" in line]
        assert result["findings"]
        if actor.indexes:
            assert reference["source"] in actor.sources


def artifact_scenarios():
    fixture = json.loads((FIXTURES / "context-evidence-workflows.json").read_text())["artifactReuse"]
    assert fixture["version"] == 1
    ids = set()
    for case in fixture["cases"]:
        assert case["id"] not in ids
        ids.add(case["id"])
        with tempfile.TemporaryDirectory(prefix="artifact-contract-") as directory:
            actor = ArtifactActor(Path(directory))
            for n in range(case["questions"]):
                if n == 1:
                    change = case.get("change")
                    if change == "artifact":
                        actor.path.write_text(actor.path.read_text().replace("payment: timeout", "payment: declined"))
                    elif change in ("tracked", "untracked", "config"):
                        name = {"tracked": "tracked.py", "untracked": "new.py", "config": "config.json"}[change]
                        (actor.candidate / name).write_text("changed\n")
                    elif change == "repository":
                        actor.repository = "fixture/fork"
                    elif change == "unknown":
                        actor.known = False
                    elif change == "corpus":
                        actor.corpus = False
                    elif change == "source":
                        actor.sources.clear()
                    elif change == "expiry":
                        actor.expired = True
                    elif change == "missing":
                        actor.path.unlink()
                    elif change == "age":
                        actor.now = "2026-10-26T10:00:00Z"
                        # Age changes neither identity nor explicit retention.
                result = actor.query("payment", repeated=case["questions"] > 1)
            validate_artifact(case, actor, result)
            if case.get("change") == "age":
                assert result["reference"]["observedAt"] != actor.now
            broken = dict(result, action="scoped-search" if result["action"] != "scoped-search" else "stale")
            try:
                validate_artifact(case, actor, broken)
            except AssertionError:
                pass
            else:
                raise AssertionError("artifact invalidation regression accepted")
    print(f"artifact reuse: {len(ids)} scenarios passed; 0 failed/0 skipped; synthetic index only")


def main():
    fixture = json.loads((FIXTURES / "context-evidence-workflows.json").read_text())["sourceRouting"]
    assert fixture["version"] == 1
    ids = set()
    for case in fixture["cases"]:
        assert case["id"] not in ids
        ids.add(case["id"])
        with tempfile.TemporaryDirectory(prefix="routing-contract-") as directory:
            root = Path(directory)
            for path, content in fixture["files"].items():
                target = root / path
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(content)
            result = replay(root, fixture["files"], case)
            validate(case, result)
            mutations = ["route", "current-file"]
            if case.get("expectedAliases"):
                mutations.append("aliases")
            if case.get("editAfterRetrieval"):
                mutations.append("stale-source")
            for mutation in mutations:
                broken = json.loads(json.dumps(result))
                if mutation == "route":
                    broken["tool"] = "native" if result["tool"] == "xerj" else "xerj"
                elif mutation == "current-file":
                    broken["inspected"] = {}
                elif mutation == "aliases":
                    broken["hits"][0]["aliases"].pop()
                else:
                    broken["inspected"]["alpha/src/cart.py"]["sha256"] = result["hits"][0]["sha256"]
                try:
                    validate(case, broken)
                except AssertionError:
                    pass
                else:
                    raise AssertionError(f"{mutation} regression accepted")
    print(f"source routing: {len(ids)} scenarios passed; 0 failed/0 skipped; synthetic providers only")
    semantic_scenarios()
    discovery_scenarios()
    artifact_scenarios()


if __name__ == "__main__":
    main()
