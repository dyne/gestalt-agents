# Avoid losing evidence during analysis

Keep the original artifact and derive findings from it. The index is a retrieval
surface, not the sole evidence store. Filtering a saved file does not destroy
the file; later questions can analyze it again.

## Large single-line JSON

Do not print the entire object or index one enormous line expecting precise
event retrieval. Use `ctx_execute_file` on the saved path, parse the schema,
select the requested time range and event type, then print bounded structural
rows and the total match count. Keep payloads out of the returned findings.

For example, with a saved schema-version-1 Gestalt trace:

```python
# ctx_execute_file provides file_content; no workspace writes occur here.
import json
trace = json.loads(file_content)
if trace.get("schemaVersion") != 1 or not isinstance(trace.get("events"), list):
    raise ValueError("unsupported trace schema")
matches = [event for event in trace["events"]
           if event.get("type") == "autopilot.turn-failed"]
print("match count:", len(matches))
for event in matches[:20]:
    print(json.dumps({key: event.get(key)
                      for key in ("sequence", "occurredAt", "type")}))
```

This example filters by exact event type, not time. For incident-window coverage
and UTC summary use the
[capture and summary helpers](../../self-debug/references/incident-capture.md).
An event count is not a causal explanation. Query indexed structural rows by
exact event name and time; if short output was not indexed, analyze the retained
file for the next question rather than claiming it disappeared.

## Search returns nothing

Check the search root, ignored paths, and symlink targets before concluding a
file is absent. Use explicit paths when authoritative metadata supplies them;
avoid broad listings or guessed state-directory hashes. Empty search output
can describe search scope rather than the filesystem.

## Tool and output mismatches

- Use native tools for small bounded reads, instructions, edits, and mutations.
- Use only parameters exposed by the actual host. Do not copy obsolete
  `summary_prompt` or `timeout_ms` arguments into tools that expose other fields.
- Print counts, paths, exit status, and the smallest useful diagnostic. Serialize
  only selected structures; `JSON.stringify` is not permission to dump a dataset.
- Allow realistic time for a test or build. A tool timeout is not a passing test
  or proof of a product hang; inspect the process result and harness cleanup.
