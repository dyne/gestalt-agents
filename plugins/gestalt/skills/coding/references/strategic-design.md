# Strategic design and shared language

Use this reference for domain discovery, context boundaries, service decomposition,
or deciding where deeper modeling pays off.

## Discover the model

1. Start with a concrete business scenario and its success and failure outcomes.
   Ask domain experts how they describe the actors, commands, decisions, and
   facts. If experts are unavailable, label the model as provisional rather than
   inventing requirements.
2. Use a short EventStorming session when a workflow is unclear: arrange past-tense
   events in time, add initiating commands and actors, then policies, external
   systems, and unanswered questions. Separate known behavior from proposals.
3. Maintain a small glossary per context: term, definition, examples, exclusions,
   and owner. Exercise it in code and acceptance examples. Naming difficulty
   can reveal two concepts mistakenly combined or a missing business concept.
4. Find boundaries where meanings, rules, ownership, or change cadence differ.
   Map the existing system before proposing the target. Validate boundaries with
   workflows that cross them, not only entity diagrams.

For example, a billing Customer may own payment terms while a shipping Recipient
owns delivery instructions. Share a stable identifier through a contract if
necessary; do not force both into a global mutable Customer model.

## Distill the core domain

| Subdomain | Decision |
|---|---|
| Core | Invest in explicit rules, expert collaboration, tests, and a model that captures the differentiator |
| Supporting | Build what the business needs with modest abstractions |
| Generic | Evaluate existing libraries/services; isolate vendor integration where useful |

Classify by the actual business. Authentication or payments can be a core domain
for some products. Do not assign work by assumed developer seniority. A short
domain vision can state the differentiator, key capabilities, and excluded
concerns. Distill implicit concepts out of legacy technical modules incrementally;
revisit the classification as the business changes.

## Context map

Record each context's model, responsible team, upstream/downstream relationships,
contract, translation, failure handling, and consistency requirement. Choose a
relationship deliberately:

| Relationship | Appropriate use and cost |
|---|---|
| Partnership | Teams coordinate delivery and contract changes; requires sustained collaboration |
| Shared Kernel | A small jointly owned model; changes require joint agreement and tests |
| Customer–Supplier | Downstream needs influence upstream planning and contracts |
| Conformist | Accept an upstream model when control and differentiation are low |
| Anti-Corruption Layer | Translate a foreign/legacy model to protect local meanings and invariants |
| Open Host Service | Provide a stable integration protocol for multiple consumers |
| Published Language | Define shared interchange schemas, vocabulary, and evolution rules |
| Separate Ways | Avoid integration when its cost exceeds its value |
| Big Ball of Mud | Describe an existing unclear boundary; contain it rather than treating it as the target |

An ACL is valuable when semantics differ, not a mandatory class around every SDK.
Translate both data and errors at the boundary; do not let an upstream status
code become a local business state without interpretation. Open Host Service
and Published Language often work together.

Start with modules in a monolith when independent deployment is not required.
A bounded context is a model boundary; a service is an operational boundary.
Consider team responsibility, data ownership, availability, deployment cadence,
and cross-boundary transactions before extraction. A context can encompass
multiple services and can evolve independently of directory names.

## Useful deliverable

Produce a glossary, current/target context map, subdomain classification, and the
few decisions that change implementation. Include unresolved business questions
and one realistic cross-context scenario. Avoid diagrams without ownership or
contracts, a universal enterprise model, and migrations justified only by a
preferred architecture label.
