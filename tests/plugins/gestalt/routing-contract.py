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
    """Execute lexical queries over immutable fixture bytes, then read live files."""
    index, cache, events, steps = {}, {}, [], []
    for path, content in files.items():
        hit = index.setdefault(digest(content), {"content": content, "aliases": []})
        hit["aliases"].append(path)
    runtime, config, agent, catalog = "runtime-1", "config-1", "executor-1", "catalog-1"
    repositories = case["repositories"]
    state = case.get("catalog", "fresh")
    for attempt in range(case.get("repeat", 1)):
        if attempt == 1:
            change = case.get("change")
            if change == "source":
                path = root / "alpha/src/cart.py"
                path.write_text(path.read_text() + "# dirty source\n")
                state = "stale"
            elif change == "untracked":
                (root / "alpha/src/new.py").write_text("def checkout(): return 'untracked'\n")
                state = "stale"
            elif change == "unrelated-source":
                (root / "beta/src/pay.py").write_text("def payment(): return 'unrelated change'\n")
            elif change == "runtime":
                runtime = "runtime-2"
            elif change == "config":
                config = "config-2"
            elif change == "executor":
                agent = "executor-2"
            elif change == "catalog":
                catalog = "catalog-2"
            elif change == "scope":
                repositories = ["fork"]
            elif change in ("unavailable", "available"):
                state = "unavailable" if change == "unavailable" else "fresh"
                cache.clear()  # An observed availability change invalidates bindings.
        targets = sorted(str(p.relative_to(root)) for repository in repositories
                         for p in (root / repository).rglob("*") if p.is_file())
        source = tuple((p, digest((root / p).read_text())) for p in targets)
        key = (tuple(repositories), source, config, catalog, runtime, agent)
        trace, queries, hits = [], [], []
        reason, readiness = None, None
        if case["intent"] == "precise":
            tool = "native"
        else:
            if key not in cache:
                trace.append("runtime-check" if state == "unavailable" else "map")
                cache[key] = {"reason": None if state == "fresh" else state,
                              "observedAt": f"2026-11-01T10:00:0{attempt}Z"}
                if cache[key]["reason"]:
                    trace.append("fallback-report")
            else:
                trace.append("cached-readiness")
            readiness = cache[key]
            reason = readiness["reason"]
            tool = "native" if reason else "xerj"
        trace.append(tool)
        if tool == "xerj":
            # The synthetic provider actually evaluates the lexical query,
            # scopes indexes and bounds results; an event label alone cannot pass.
            query = case.get("queries", [case["query"]] * case.get("repeat", 1))[attempt]
            request = {"indexes": [f"index-{repo}" for repo in repositories],
                       "query": query, "size": 5}
            hits = [{"sha256": sha, "aliases": sorted(hit["aliases"]),
                     "content": hit["content"]}
                    for sha, hit in index.items() if query in hit["content"]
                    and any(p in targets for p in hit["aliases"])][:request["size"]]
            queries.append({"request": request, "hits": hits})
        else:
            query = case["query"]
        if case.get("editAfterRetrieval"):
            (root / targets[0]).write_text("def checkout(): return 'changed'\n")
        paths = sorted({p for hit in hits for p in hit["aliases"] if p in targets})
        if tool == "native" or not hits:
            paths = targets
        inspected = {}
        for path in paths:
            trace.append("current-file")
            current = (root / path).read_text()
            inspected[path] = {"repository": path.split("/")[0], "sha256": digest(current),
                               "matches": query in current, "current": current}
        # Continue with concrete current findings, including a verified no-match.
        trace.append("continue")
        outcome = {"query": query, "matches": sorted(p for p, row in inspected.items() if row["matches"]),
                   "checked": sorted(inspected)}
        steps.append({"tool": tool, "reason": reason, "events": trace, "queries": queries,
                      "hits": hits, "inspected": inspected, "outcome": outcome,
                      "readiness": readiness})
        events.extend(trace)
    return {**steps[-1], "events": events, "steps": steps}


def validate(case, result, root):
    assert result["tool"] == case["expected"], case["id"]
    assert result["reason"] == case.get("reason"), case["id"]
    assert result["inspected"], "current source was never inspected"
    repeats = case.get("repeat", 1)
    assert len(result["steps"]) == repeats
    tools = case.get("expectedTools", [case["expected"]] * repeats)
    assert [step["tool"] for step in result["steps"]] == tools
    broad = case["intent"] == "broad"
    default_maps = int(broad and case.get("catalog") != "unavailable")
    assert result["events"].count("map") == case.get("expectedMaps", default_maps)
    assert result["events"].count("runtime-check") == case.get(
        "expectedRuntimeChecks", int(broad and case.get("catalog") == "unavailable"))
    default_reports = int(broad and case.get("reason") is not None)
    assert result["events"].count("fallback-report") == case.get("expectedReports", default_reports)
    for number, step in enumerate(result["steps"]):
        assert step["inspected"], "current source was never inspected"
        assert step["events"][-1] == "continue", "readiness replaced useful work"
        assert step["events"].index("current-file") > step["events"].index(step["tool"])
        expected = sorted(p for p, row in step["inspected"].items()
                          if step["outcome"]["query"] in row["current"])
        assert step["outcome"]["matches"] == expected
        assert step["outcome"]["checked"] == sorted(step["inspected"])
        for path, row in step["inspected"].items():
            assert row["repository"] == path.split("/")[0]
            assert row["sha256"] == digest(row["current"])
        if step["tool"] == "xerj":
            assert len(step["queries"]) == 1, "map/route label without a useful query"
            request = step["queries"][0]["request"]
            assert request["query"] == step["outcome"]["query"] and request["query"]
            assert 0 < request["size"] <= 5
            repositories = ["fork"] if number and case.get("change") == "scope" else case["repositories"]
            assert request["indexes"] == [f"index-{repo}" for repo in repositories]
            assert len(step["hits"]) <= request["size"]
            assert step["queries"][0]["hits"] == step["hits"]
            assert all(request["query"] in hit["content"] for hit in step["hits"])
            assert all(hit["sha256"] == digest(hit["content"]) for hit in step["hits"])
        else:
            assert not step["queries"]
        if "cached-readiness" in step["events"]:
            assert step["readiness"] == result["steps"][number - 1]["readiness"]
    for path, row in result["inspected"].items():
        assert row["sha256"] == digest(row["current"])
        assert row["current"] == (root / path).read_text(), "findings differ from current source"
    if case.get("expectedAliases"):
        assert result["hits"][0]["aliases"] == case["expectedAliases"]
        assert {v["repository"] for v in result["inspected"].values()} == set(case["repositories"])
    if case.get("confirmNoMatch"):
        assert not result["hits"] and not result["outcome"]["matches"]
    if case.get("currentMatchAfterNoMatch"):
        assert not result["hits"] and result["outcome"]["matches"]
    if case.get("editAfterRetrieval") and result["hits"]:
        assert result["inspected"]["alpha/src/cart.py"]["sha256"] != result["hits"][0]["sha256"]
        assert "changed" in result["inspected"]["alpha/src/cart.py"]["current"]
    if case.get("change") == "untracked":
        assert "alpha/src/new.py" in result["inspected"]


class SemanticActor:
    """A synthetic provider boundary; no installed service, tool or cache use."""

    def __init__(self, root, case):
        self.root, self.case = root, case
        self.readiness = {}
        self.events = []
        self.probes = self.warmups = 0
        self.overview_bytes = self.overview_budget = None
        self.runtime = "runtime-1"
        self.config = "config-1"
        self.agent = "executor-1"
        self.steps = []
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
        (root / "alpha/build/debug").mkdir(parents=True)
        c_language = case.get("language") == "c"
        translation_unit = "target.c" if c_language else "target.cpp"
        if case.get("compilation") != "missing":
            build = "other" if case.get("compilation") == "wrong-build" else "debug"
            self.compilation.write_text(json.dumps([{
                "directory": str(root / f"alpha/build/{build}"),
                "file": str(root / (f"fork/{translation_unit}" if case.get("wrongCompilationFile") else f"alpha/{translation_unit}")),
                "arguments": ["clang" if c_language else "clang++", "-std=c++17" if case.get("wrongStandard") else "-std=c11" if c_language else "-std=c++20",
                              "-Imissing" if case.get("wrongInclude") else "-I../..",
                              "-DVARIANT_DEBUG=1", str(root / f"alpha/{translation_unit}")]}]))
        (root / "alpha/target.cpp").write_text('#include "generated.h"\nint target() { return 1; }\nint caller() { return target(); }\n')
        (root / "alpha/target.c").write_text('#include "generated.h"\nint target() { return 1; }\nint caller() { return target(); }\n')
        (root / "alpha/target.ts").write_text("export function target() { return 1; }\nfunction caller() { return target(); }\n")
        if not case.get("missingGeneratedHeader"):
            (root / "alpha/generated.h").write_text("// synthetic generated input\n")
        self.original_source = self.source().read_text()

    def key(self, operation):
        language = self.case.get("language", "python")
        paths = [self.definition]
        if language in ("c", "cpp", "typescript"):
            paths = [self.source()]
        elif operation == "callers" or self.case.get("interfaceChange"):
            paths.append(self.caller)
        if language in ("c", "cpp"):
            paths.extend([self.compilation, self.root / "alpha/generated.h"])
        return (self.case.get("effectiveRepository", "alpha"), self.case.get("build", "debug"),
                tuple((str(p.relative_to(self.root)), digest(p.read_text()) if p.exists() else None)
                      for p in paths), self.config, self.runtime, self.agent,
                language, "references" if operation == "callers" or self.case.get("interfaceChange") else "extraction",
                self.case.get("connected", True))

    def source(self):
        language = self.case.get("language", "python")
        return self.root / f"alpha/target.{language}" if language in ("c", "cpp") else \
            self.root / "alpha/target.ts" if language == "typescript" else self.definition

    def body(self):
        path = self.source()
        source = path.read_text()
        if self.case.get("language", "python") == "python":
            node = next(n for n in ast.parse(source).body
                        if isinstance(n, ast.FunctionDef) and n.name == "target")
            body = "".join(source.splitlines(keepends=True)[node.lineno - 1:node.end_lineno])
        else:
            body = next(line + "\n" for line in source.splitlines()
                        if "target()" in line and "return 1" in line)
        return {"path": str(path.relative_to(self.root)), "symbol": "target", "body": body}

    def known_relation(self, references):
        self.events.extend(["definition", "references", "current-file"])
        if self.case.get("language") in ("c", "cpp", "typescript"):
            source = self.source().read_text()
            return references and "target()" in source and "return target();" in source
        # Actual current synthetic Python ASTs independently establish the
        # definition/call relation against which provider observations are checked.
        definitions = ast.parse(self.definition.read_text())
        caller = ast.parse(self.caller.read_text())
        return references and any(isinstance(n, ast.FunctionDef) and n.name == "target"
                                  for n in ast.walk(definitions)) and any(
            isinstance(n, ast.ImportFrom) and n.module == "definition" and
            any(alias.name == "target" for alias in n.names) for n in ast.walk(caller)) and any(
            isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "target"
            for n in ast.walk(caller))

    def probe(self):
        operation = self.case.get("operation", "callers")
        if self.case.get("deniedOperation") == "read":
            self.events.append("read-denied")
            return self.finish(operation, {"ready": False, "relation": False,
                                          "reason": "denied", "editAllowed": False})
        if operation == "text":
            return self.finish(operation, {"ready": False, "relation": False,
                                          "reason": "text", "editAllowed": False})
        key = self.key(operation)
        if key in self.readiness:
            result = self.readiness[key]
            self.events.append("cached-ready" if result["ready"] else "cached-failure")
            return self.finish(operation, dict(result))
        self.probes += 1
        c = self.case
        reason = None
        if not c.get("connected", True):
            reason = "connection"
        elif c.get("effectiveRepository", "alpha") != "alpha":
            reason = "repository"
        elif c.get("language", "python") not in ("python", "c", "cpp", "typescript"):
            reason = "language"
        elif c.get("language") in ("c", "cpp"):
            entries = json.loads(self.compilation.read_text()) if self.compilation.exists() else []
            if not entries or entries[0]["directory"] != str(self.root / "alpha/build/debug") \
                    or c.get("build", "debug") != "debug" \
                    or entries[0]["file"] != str(self.source()) \
                    or ("-std=c11" if c["language"] == "c" else "-std=c++20") not in entries[0]["arguments"] \
                    or "-I../.." not in entries[0]["arguments"] \
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
            needs_relation = operation == "callers" or c.get("interfaceChange")
            relation = self.known_relation(c.get("references", True)) if needs_relation else False
            if needs_relation and not relation and c.get("warmupUseful") and c.get("cacheWritable"):
                if c.get("deniedOperation") == "warmup":
                    self.events.append("warmup-denied")
                    return self.finish(operation, {"ready": False, "relation": False,
                                                  "reason": "denied", "editAllowed": False})
                self.events.append("managed-index")
                self.warmups += 1
                relation = self.known_relation(c.get("warmupRestoresReferences", False))
            if needs_relation and not relation:
                reason = "references"
        result = {"ready": reason is None, "relation": reason is None and
                  (operation == "callers" or c.get("interfaceChange", False)),
                  "reason": reason, "editAllowed": reason is None and c.get("writeAuthorized", True),
                  "observedAt": f"2026-11-01T10:00:{self.probes:02d}Z"}
        if reason:
            self.events.append("native-fallback")
        self.readiness[key] = dict(result)
        return self.finish(operation, result)

    def finish(self, operation, result):
        """Execute the task on current fixture bytes; readiness alone is insufficient."""
        # Capability caches never cache current mutation authority.
        result["editAllowed"] = result["ready"] and self.case.get("writeAuthorized", True)
        if result["reason"] == "denied":
            outcome = {"operation": "denied", "changed": False}
        elif operation == "text":
            if not self.case.get("writeAuthorized", True):
                self.events.append("edit-denied")
                outcome = {"operation": "denied", "changed": False}
            else:
                before = self.definition.read_text()
                self.events.extend(["native-pre-edit", "native-text-edit"])
                self.definition.write_text(before + "# documented\n")
                outcome = {"operation": "native-text-edit", "changed": True,
                           "current": self.definition.read_text()}
        elif not result["ready"]:
            self.events.append("native-current-read")
            outcome = {"operation": "native-read", "current": self.source().read_text()}
        elif operation in ("body", "definition"):
            self.events.append("symbol-body" if operation == "body" else "symbol-definition")
            outcome = {"operation": operation, **self.body()}
        elif operation == "callers":
            self.events.append("caller-query")
            path = self.caller if self.case.get("language", "python") == "python" else self.source()
            # Return actual current caller locations, not a readiness label.
            lines = [(i + 1, line) for i, line in enumerate(path.read_text().splitlines())
                     if "return target()" in line]
            outcome = {"operation": "callers", "callers": [
                {"path": str(path.relative_to(self.root)), "line": line, "source": text}
                for line, text in lines]}
        elif operation == "edit":
            self.events.append("native-pre-edit")
            symbol = self.body()
            before = self.source().read_text()
            if not result["editAllowed"] or self.case.get("deniedOperation") == "edit":
                self.events.append("edit-denied")
                outcome = {"operation": "denied", "changed": False}
            else:
                self.events.append("structured-edit")
                self.source().write_text(before.replace(symbol["body"], symbol["body"].replace("return 1", "return 2"), 1))
                self.events.extend(["diff-inspection", "focused-check"])
                assert "return 2" in self.source().read_text()
                if self.case.get("language", "python") == "python":
                    namespace = {}
                    exec(compile(self.source().read_text(), "synthetic-definition", "exec"), namespace)
                    assert namespace["target"]() == 2
                outcome = {"operation": "structured-edit", "changed": True,
                           "before": before, "after": self.source().read_text()}
        else:
            raise AssertionError(f"Unknown task: {operation}")
        self.events.append("continue")
        result["outcome"] = outcome
        self.steps.append(json.loads(json.dumps(result)))
        return result


def validate_semantics(case, result, actor):
    assert result["ready"] == case["expectedReady"], case["id"]
    assert result["reason"] == case.get("expectedReason"), case["id"]
    assert result["editAllowed"] == (case["expectedReady"] and case.get("writeAuthorized", True))
    operation = case.get("operation", "callers")
    assert result["relation"] == (result["ready"] and (operation == "callers" or case.get("interfaceChange", False)))
    assert actor.probes == case.get("expectedProbes", 1)
    assert actor.warmups == case.get("expectedWarmups", 0)
    if case.get("expectedRecovery"):
        assert case["expectedRecovery"] in actor.events
        assert "managed-index" not in actor.events
        assert actor.overview_bytes <= actor.overview_budget
        assert actor.overview_budget == 1500 if case["expectedRecovery"] == "narrow" \
            else 1500 < actor.overview_budget <= 8192
    if result["relation"]:
        assert "definition" in actor.events and "references" in actor.events
        assert actor.events.index("overview") < actor.events.index("references")
    if operation in ("body", "definition") and not case.get("interfaceChange"):
        assert "references" not in actor.events and actor.warmups == 0
    if not result["ready"] and result["reason"] not in ("text", "denied"):
        assert "native-fallback" in actor.events
        assert result["outcome"]["operation"] == "native-read"
        assert result["outcome"]["current"] == actor.source().read_text()
    if case.get("deniedOperation") or operation in ("edit", "text") and not case.get("writeAuthorized", True):
        assert result["outcome"] == {"operation": "denied", "changed": False}
        assert not set(actor.events) & {"structured-edit", "native-text-edit", "native-current-read"}
        assert actor.source().read_text() == actor.original_source
    elif result["ready"] and operation in ("body", "definition"):
        assert result["outcome"] == {"operation": operation, **actor.body()}
    elif result["ready"] and operation == "callers":
        assert result["outcome"]["operation"] == "callers" and result["outcome"]["callers"]
        for row in result["outcome"]["callers"]:
            assert (actor.root / row["path"]).read_text().splitlines()[row["line"] - 1] == row["source"]
            assert "return target()" in row["source"]
    elif operation == "edit" and result["ready"] and result["editAllowed"]:
        assert result["outcome"]["operation"] == "structured-edit"
        assert result["outcome"]["changed"] and "return 2" in result["outcome"]["after"]
        assert result["outcome"]["after"] == actor.source().read_text()
        assert actor.events.index("native-pre-edit") < actor.events.index("structured-edit")
        assert actor.events.index("structured-edit") < actor.events.index("diff-inspection") < actor.events.index("focused-check")
    elif operation == "text":
        assert result["outcome"]["operation"] == "native-text-edit" and result["outcome"]["changed"]
        assert result["outcome"]["current"].endswith("# documented\n")
        assert "overview" not in actor.events
    assert actor.events[-1] == "continue"
    if case.get("expectedCached"):
        assert actor.events.count("cached-ready") == case["expectedCached"]
        assert len({step["observedAt"] for step in actor.steps}) == 1
        assert actor.events.count("overview") == 1
    assert actor.events.count("native-fallback") == sum(
        not observation["ready"] for observation in actor.readiness.values())
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
                elif attempt and case.get("change") == "executor":
                    actor.agent = "executor-2"
                elif attempt and case.get("change") == "build":
                    actor.case = dict(actor.case, build="release")
                elif attempt and case.get("change") == "unrelated-source":
                    (actor.root / "unrelated.py").write_text("# unrelated\n")
                elif attempt and case.get("change") == "disconnect":
                    actor.runtime = "disconnected-runtime"
                    actor.case = dict(actor.case, connected=False)
                elif attempt and case.get("change") == "body":
                    actor.definition.write_text(actor.definition.read_text() + "# body changed\n")
                result = actor.probe()
            validate_semantics(case, result, actor)
            mutations = ["ready", "outcome", "continuation"]
            if result["outcome"]["operation"] == "structured-edit":
                mutations.append("pre-edit")
            if case.get("expectedCached"):
                mutations.extend(["reprobe", "observation-time"])
            if "native-fallback" in actor.events:
                mutations.append("fallback-repeat")
            for mutation in mutations:
                broken = json.loads(json.dumps(result))
                events = list(actor.events)
                steps = json.loads(json.dumps(actor.steps))
                if mutation == "ready":
                    broken["ready"] = not result["ready"]
                elif mutation == "outcome":
                    broken["outcome"] = {"operation": "invented"}
                elif mutation == "continuation":
                    actor.events.pop()
                elif mutation == "pre-edit":
                    actor.events.remove("native-pre-edit")
                elif mutation == "reprobe":
                    actor.events.insert(-1, "overview")
                elif mutation == "observation-time":
                    actor.steps[-1]["observedAt"] = "invented refresh"
                else:
                    actor.events.insert(-1, "native-fallback")
                try:
                    validate_semantics(case, broken, actor)
                except (AssertionError, KeyError, ValueError):
                    pass
                else:
                    raise AssertionError(f"semantic regression accepted: {case['id']}/{mutation}")
                finally:
                    actor.events = events
                    actor.steps = steps
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
        self.bounded_native = False
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
        action = "native-read" if self.bounded_native else "scoped-search" if repeated else "execute_file"
        if current["sha256"] != self.retained["sha256"]:
            action = "current-read"
            self.retained = current
            self.sources.clear()
        if repeated and not self.bounded_native:
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
            if case.get("small"):
                actor.bounded_native = True
                actor.path.write_text("FAIL payment: timeout\n")
                actor.retained = actor.identity()
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
            validate(case, result, root)
            mutations = ["route", "current-file", "continuation", "findings"]
            if result["tool"] == "xerj":
                mutations.extend(["query", "query-bound", "query-scope"])
            if case.get("repeat", 1) > 1:
                mutations.append("reprobe")
            if any("cached-readiness" in step["events"] for step in result["steps"]):
                mutations.append("observation-time")
            if result["events"].count("fallback-report"):
                mutations.append("repeat-report")
            if case.get("expectedAliases"):
                mutations.append("aliases")
            if case.get("editAfterRetrieval") and result["hits"]:
                mutations.append("stale-source")
            for mutation in mutations:
                broken = json.loads(json.dumps(result))
                if mutation == "route":
                    broken["tool"] = "native" if result["tool"] == "xerj" else "xerj"
                elif mutation == "current-file":
                    broken["inspected"] = {}
                elif mutation == "aliases":
                    broken["hits"][0]["aliases"].pop()
                elif mutation == "stale-source":
                    broken["inspected"]["alpha/src/cart.py"]["sha256"] = result["hits"][0]["sha256"]
                elif mutation == "query":
                    broken["steps"][-1]["queries"] = []
                elif mutation == "query-bound":
                    broken["steps"][-1]["queries"][0]["request"]["size"] = 0
                elif mutation == "query-scope":
                    broken["steps"][-1]["queries"][0]["request"]["indexes"] = ["index-other"]
                elif mutation == "continuation":
                    broken["steps"][-1]["events"].pop()
                elif mutation == "findings":
                    broken["steps"][-1]["outcome"]["matches"] = ["invented/path"]
                elif mutation == "reprobe":
                    broken["events"].append("map")
                elif mutation == "repeat-report":
                    broken["events"].append("fallback-report")
                elif mutation == "observation-time":
                    step = next(step for step in broken["steps"] if "cached-readiness" in step["events"])
                    step["readiness"]["observedAt"] = "invented refresh"
                try:
                    validate(case, broken, root)
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
