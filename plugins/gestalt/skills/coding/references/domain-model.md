# Tactical domain model

Use these patterns to enforce actual business rules. Plain data and straightforward
handlers are appropriate for simple CRUD and read models.

## Select the building block

| Building block | Selection and implementation |
|---|---|
| Entity | Identity persists as attributes change; compare by stable identity and expose business operations |
| Value object | Meaning comes from attributes; validate construction, compare structurally, replace rather than mutate |
| Aggregate | Small consistency boundary with one root controlling invariant-preserving changes |
| Domain service | A domain rule spans concepts and naturally belongs to neither entity nor value object |
| Application service/use case | Coordinates loading, policies, domain behavior, transactions, and external effects |
| Repository | Collection-like contract for aggregate retrieval/persistence; implementation maps storage |
| Factory | Creates a valid complex object/aggregate; use a constructor or named constructor for simple creation |
| Specification | Reusable business predicate/query criteria; introduce only when it clarifies recurring rules |

Money should include currency and a defined precision/rounding policy. Email,
address, date ranges, and quantities can be value objects where their rules matter;
wrapping every primitive adds noise. Identity generation, clocks, and random input
should be controllable at the boundary so rules remain deterministic in tests.

## Aggregate design

Write the invariants first: what must be true after every accepted operation?
For example, confirming an order requires at least one valid line and a computed
total matching its pricing policy. Let `order.confirm()` enforce that transition;
do not distribute `status = confirmed` assignments among controllers.

Only the root exposes mutations to its internals. Avoid returning mutable child
collections that bypass its rules. Refer to other aggregates by identity when
possible. Keep aggregates small to reduce loading cost and contention, but do
not split at an arbitrary entity count. Choose boundaries from invariants.

Use optimistic versions or appropriate locking for competing updates; a pure
entity test cannot prove database concurrency behavior. The repository/unit of
work should detect conflicts and leave a defined retry or rejection outcome.
Retry a whole use case only if its external effects are safe to repeat.

Prefer one aggregate per transaction when the business permits. If a rule truly
requires atomic changes across aggregates in one database, document that choice
or reconsider the boundary. For distributed invariants, negotiate reservations,
compensations, or eventual consistency explicitly; events do not erase the rule.

## Repository, factory, and persistence boundaries

- Name repository operations in the consumer's language. Avoid a generic CRUD
  base class that exposes every persistence capability to every aggregate.
- Put interfaces in application ports or in the domain when domain-owned;
  implementations and ORM mapping stay at the infrastructure edge in a
  domain-centered design. ORM records and rich domain objects need not coincide.
- Decide whether the repository tracks changes like a collection or requires
  explicit `save`; do not mix conventions silently. A unit of work coordinates
  commit/rollback for a use case.
- Distinguish creation from rehydration. Creation enforces current creation rules
  and may raise new events; rehydration restores persisted state without
  repeating creation side effects. Validate persisted data appropriately.
- Factories assemble valid objects; they should not become service locators.
  Keep I/O orchestration outside a pure factory unless its contract explicitly
  models that effect.
- Specifications represent meaningful recurring predicates. Keep SQL/ORM
  expressions in adapters and verify that translated predicates have the same
  semantics. Avoid inventing a universal query language.
- Read-only joins for screens can use a dedicated query/read model. They need
  not hydrate or traverse aggregates, and must still enforce access rules.

Domain events record meaningful transitions as immutable facts. Publish external
effects with the reliability rules in [events](events.md), rather than from
entity constructors or property setters.
