# Supervised Org Plan attention protocol (schema v1)

`gestalt-agents` consumes the mobile-managed
`gestalt_org_plan_attention` dynamic-tool contract; it does not define mobile
server policy. The current compatible schema is version 1.

The closed reason vocabulary is `planChange`, `hardBlock`,
`missingDependency`, `permissionRequired`, `externalState`, and
`materialAmbiguity`. Calls contain only a bounded summary, concrete requested
action, and the mapped resume condition from the decision table in the Org Plan
skill. Unknown future reason codes fail closed: do not infer a meaning or emit
them; use the current table or report the ordinary blocker when the tool is
absent.

The dynamic tool is optional. When mobile does not expose it, supervised roles
keep all existing helper, review, measurement, single-writer, projection, and
continuation rules, and report genuine blockers normally. A mobile checkpoint
is synthetic control input, never authorization to change scope or review
state.
