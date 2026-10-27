---
name: coding
metadata:
  adaptation_version: "1.0.0"
description: Write, change, review, or refactor application code and design software architecture. Use for feature implementation, APIs, backend services, domain modeling, DDD, bounded contexts, aggregates, Clean or Hexagonal Architecture, vertical slices, use cases, repositories, CQRS, events, and monolith decomposition. Start with the existing conventions and the requested behavior; use deeper architecture guidance only when relevant. Shell-only automation belongs to scripting.
---

# Gestalt Coding

Deliver the requested behavior with explicit business rules, cohesive features,
and boundaries that can be tested. This skill combines strategic and tactical
DDD, Clean/Onion dependency rules, Hexagonal ports and adapters, and Vertical
Slice Architecture. They answer different questions and can be used together;
none is a prerequisite for every feature. No other architecture skill is needed.

## Workflow

1. Inspect the requested behavior, current implementation, repository rules,
   tests, and framework conventions. Identify the use case, inputs, observable
   result, business invariants, side effects, and consistency requirements.
   Preserve the user's architecture choice and existing public contracts.
2. Choose the smallest useful design using the table below. For an existing
   system, extend its conventions unless a specific coupling problem justifies
   a local change. State consequential assumptions; ask for domain guidance
   only when an unresolved rule would change behavior.
3. Read the relevant reference in this skill. Model the business rule and use
   case before adding infrastructure abstractions. Implement one complete
   behavior, including validation, error mapping, persistence, and wiring.
4. Exercise the observable contract and relevant failure paths. For a refactor,
   establish existing behavior before extraction and compare it afterward.
5. Report the behavior delivered, design tradeoffs that matter, checks actually
   run, and remaining limitations. For a design-only request, provide the
   proposed boundaries and rationale without making unrequested code changes.

## Choose the design

| Need | Approach | Read when needed |
|---|---|---|
| Simple CRUD or one endpoint/job | A cohesive feature with direct, explicit orchestration; no invented aggregate, repository hierarchy, or event bus | [Feature structure](references/structure.md) |
| Feature-first/VSA codebase or changes scattered across technical layers | Group by business operation; keep validation, handler, DTOs, and tests together | [Feature structure](references/structure.md) |
| Conflicting meanings, service boundaries, legacy integration, build-versus-buy | Model language and bounded contexts; classify subdomains and integration relationships | [Strategic design](references/strategic-design.md) |
| Nontrivial business invariants or competing updates | Entities, value objects, aggregates, policies, repositories, and factories as needed | [Domain model](references/domain-model.md) |
| Framework coupling, multiple entry points, replaceable infrastructure | Use cases with consumer-owned ports, edge adapters, and explicit composition | [Feature structure](references/structure.md) |
| Reliable messages, read/write divergence, long workflows, temporal state | Choose events, outbox, CQRS, sagas, or event sourcing by requirement | [Events and consistency](references/events.md) |
| Testing, architectural review, or incremental extraction | Match tests to boundaries and migrate one behavior at a time | [Verification and migration](references/verification.md) |

## Shared design rules

- Use business language in operations and tests. A bounded context owns its
  meanings; it does not automatically require a separate deployed service.
- Feature organization and dependency direction are independent. A feature can
  contain domain, application, and adapter code when that separation is useful.
  Small slices may remain a few files. Avoid mandatory empty layers.
- In a domain-centered design, domain rules do not import HTTP frameworks,
  database clients, ORM models, or application services. Application code
  orchestrates business behavior through internal contracts; adapters translate
  protocols and persistence. Keep wiring at explicit composition boundaries.
- Put invariants in the model that owns them. Transport shape validation belongs
  at the edge; application authorization and workflow checks belong at the use
  case boundary. Domain policies include authorization only when the rule is
  itself a business concept. Do not confuse authenticated identity with access.
- A repository models an aggregate collection when using DDD, not every table.
  Place its contract beside its consumer: application ports by default, domain
  when it expresses a domain abstraction. Follow one convention consistently.
- Share real business invariants deliberately within a context. Keep feature
  helpers private and share platform plumbing independently. Do not duplicate
  an invariant merely to make slices appear isolated, or extract a generic
  service because two handlers look alike.
- Choose transactions from invariants. Prefer small aggregates and explicit
  coordination across them, but do not replace required atomic consistency with
  eventual consistency to satisfy a slogan. Explain exceptions and concurrency.
- Treat saving data and calling a broker or external API as separate failure
  domains. Use durable coordination, idempotency, and compensation where needed.
  An in-memory event dispatcher alone does not make delivery reliable.

## Review outcomes

For an architectural review, identify concrete violations with source paths,
their effect on behavior/change cost, and the smallest useful correction.
Check language, context boundaries, invariant ownership, dependency direction,
transaction behavior, and testability. Mark non-applicable patterns explicitly;
absence of CQRS, rich entities, or an ACL is not automatically a defect.
Do not assign an arbitrary architecture score unless the user asks for one.

Source attribution and merge decisions: [provenance](references/provenance.md).
