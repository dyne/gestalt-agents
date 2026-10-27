# Events, consistency, CQRS, and long workflows

Start with the business's consistency and recovery requirements. Commands request
an action and may fail; events state facts that already occurred. Queries return
data without intentional business-state changes.

## Domain and integration events

Raise past-tense domain facts (`OrderPlaced`) where the invariant-owning model
accepts the transition. Keep them immutable. Domain handlers can be synchronous
within a transaction or deferred; a domain event does not inherently mean async
delivery. Integration events are explicit, versioned contracts crossing context
boundaries, often translated from internal facts.

Choose payloads deliberately: event ID, type/version, aggregate ID, occurrence
time, correlation/causation where useful, and enough data for the consumer's
contract. Avoid exposing private object graphs or unnecessary personal data.
Event notification may carry only an ID but creates a lookup dependency;
event-carried state reduces lookups but increases schema and data obligations.

## Durable publication and consumption

Saving an aggregate followed by broker publication is a dual write. For reliable
delivery, persist the state change and outbox entry in the same database
transaction. A dispatcher publishes committed entries and records delivery.
A crash after publish and before marking delivered causes duplicates: design for
at-least-once delivery, not assumed exactly-once execution.

Consumers should deduplicate by stable event/message identity and commit their
deduplication record with their local state change. An in-memory set is not
durable deduplication. Use bounded retries for transient failures, backoff, and
dead-letter handling with visible remediation/replay. Define ordering needs
per aggregate/partition, version handling, and how late or duplicate events act.
Do not assume global ordering from a broker.

External payment authorization followed by a failed local save can leave an
orphan authorization. Use a durable workflow/reservation, provider idempotency
key, and recovery or compensation. Database rollback cannot undo the external
call. Keep these failure paths in the use-case contract and tests.

## CQRS

Separate command and query code first, often using the same database. Adopt
separate read models/projections when read shape, access patterns, scale, or
write invariants justify them. Queries can join tables directly through a read
adapter; they need not load aggregates. Read models still enforce authorization.

If projections update asynchronously, define acceptable lag, user-facing
read-after-write behavior, rebuild strategy, idempotent updates, and monitoring.
CQRS does not require event sourcing, separate services, or a message broker.

## Event sourcing

Choose event sourcing only when history-as-state, temporal queries, or replayable
business decisions justify its operational cost. Persist the event stream as the
source of truth; ordinary integration events and audit logs are not automatically
an event-sourced model.

Plan expected-version concurrency, deterministic rehydration without replayed
side effects, event schema evolution/upcasting, snapshots, projection rebuilds,
retention/privacy obligations, and repair procedures. Past events remain facts;
new compensating facts correct business outcomes. A snapshot is an optimization,
not an independent truth. Prove migration and replay on representative history
before depending on them.

## Sagas/process managers

Use a saga for a multi-step workflow spanning independent transactions. Decide
between explicit orchestration (central workflow state) and choreography (event
reactions) based on visibility and coupling. Record progress durably, use stable
operation IDs, handle timeouts and duplicate responses, and specify compensation
for each completed step. Compensation is a business action that can itself fail;
provide retry/escalation/manual recovery rather than claiming atomic rollback.
