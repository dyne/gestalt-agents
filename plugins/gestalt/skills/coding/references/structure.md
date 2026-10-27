# Feature structure, ports, and adapters

Choose feature cohesion first when a project uses VSA or needs operation-focused
organization. Add internal boundaries where they make dependencies explicit.
Keep an established layered layout unless changing it solves a demonstrated problem.

## Two compatible levels

A simple slice can contain a handler, input/output types, validation, and tests:

```text
features/orders/create/
  handler
  test
platform/
  database
  middleware
main
```

A richer context can share its invariant-owning model while keeping operations
separate:

```text
orders/
  domain/                 # Order, Money, business policies
  features/
    place/                # use case, DTOs, validation, tests
    cancel/
  ports/                  # contracts consumed by application/domain
  adapters/               # HTTP, database, external services
  composition/            # wiring for this context
platform/                 # pools, logging, generic middleware
main                      # application composition
```

These are examples, not file-count requirements. In an existing layered project,
`domain/`, `application/`, `infrastructure/`, and optionally `presentation/` can
remain top-level. Put controllers in one agreed location. Do not maintain both
layouts for the same behavior.

## Entry points and dependencies

Each feature has one primary registration or discovery boundary that receives
its framework/router handle and dependencies. Its internal helper types stay
private where the language allows. The role matters more than the name:

| Ecosystem | Idiomatic boundary |
|---|---|
| Go | `Setup`/`RegisterRoute` with explicit parameters; small consumer-owned interfaces; wiring in `cmd/.../main.go` |
| TypeScript/JavaScript | `setup(router, deps)` or framework module; functions/classes with explicit injection; TS interfaces or documented JS contracts |
| .NET/C# | `Map(IEndpointRouteBuilder)` or endpoint group; DI may resolve handler dependencies |
| Java/Kotlin | Controller/module discovered by the framework; constructor-injected use cases and ports; explicit configuration |
| Python | Router registration/`setup`, framework dependencies or explicit constructor arguments; protocols where useful |
| Rust | Modules with controlled visibility, traits at needed boundaries, explicit construction in the binary |

Version wrappers and framework auto-discovery are valid exceptions to a single
exported registration function. Multiple transports may call the same use case;
do not route CLI execution through HTTP merely to preserve one entry point.

In a domain-centered slice:

```text
inbound adapter -> application/use case -> domain
                          |
                     outbound port <- outbound adapter -> DB/API/broker
```

The arrows to a port describe source dependencies. Runtime calls pass through
the injected implementation. Inbound/driver adapters initiate use cases;
outbound/driven adapters implement capabilities the core needs. A port may be
a function or small interface; name the capability, not the vendor. Avoid
interfaces added solely to mirror every class.

Keep HTTP request objects, ORM sessions, vendor exceptions, and queue envelopes
out of domain/use-case contracts. Map input, output, and errors at adapters.
The application owns transaction intent; the infrastructure implements it.
Use a composition root or context-level factories to wire concrete implementations;
avoid hidden global clients and service locators.

For a simple VSA CRUD slice, direct database access inside the handler is a
reasonable local design. Once a use-case/domain boundary is chosen, route business
operations through it consistently. This resolves the apparent conflict between
"no repository layer by default" and "controllers call use cases."

## Shared code

Keep transport plumbing, connection pools, observability, and generic middleware
in platform infrastructure. Keep business authorization rules and invariants in
their owning context. Extract repeated invariants as a domain concept before
they diverge; do not wait for a fixed number of copies. Similar boilerplate alone
does not justify a shared service or repository.

Slices should not import each other's private handlers or persistence internals.
Coordinate through an explicit application contract or an event when appropriate.
Sharing a domain model within one bounded context is compatible with VSA; sharing
mutable entities across contexts usually erases their independence.
