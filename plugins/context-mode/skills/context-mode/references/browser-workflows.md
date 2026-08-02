# Browser output workflows

Use this reference when Playwright or another browser tool can return a large
snapshot, accessibility tree, console log, or network log.

## Rule

Save first, then process the file server-side. Never request the full browser
payload in the conversation and never pass it back as inline index content.

## Repeated queries

```text
browser_snapshot(filename: "/tmp/page.md")
ctx_index(path: "/tmp/page.md", source: "page:<label>")
ctx_search(source: "page:<label>", queries: ["login form", "error banner"])
```

## One extraction

```text
browser_console_messages(filename: "/tmp/console.md")
ctx_execute_file(path: "/tmp/console.md", language: "javascript", code: "...")
```

Use the same pattern for `browser_network_requests`. Playwright uses a shared
browser instance and may not be parallel-safe. Use a browser tool with isolated
sessions when concurrent browser work is required.
