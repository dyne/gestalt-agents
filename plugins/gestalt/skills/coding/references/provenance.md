# Sources and consolidation decisions

This skill synthesizes the local source skills supplied in `skills-used`:

| Source | Preserved material | Consolidated destination |
|---|---|---|
| `clean-ddd-hexagonal` | Layer responsibilities, dependency rule, tactical/strategic DDD, ports, CQRS/outbox/sagas, testing and quick decisions | Entrypoint and all five topic references |
| `domain-driven-design` | Shared language, context maps, core/supporting/generic domains, entities/value objects/aggregates, events, repositories/factories/specifications | Strategic design, domain model, events |
| `hexagonal-architecture` | Inbound/outbound ports, composition, language mappings, adapter contracts, incremental migration | Structure and verification |
| `vertical-slice-architecture` | Operation cohesion, registration boundary, private helpers, shared platform/domain rules, language conventions, feature tests | Structure and verification |

The `domain-driven-design` source declares MIT, author `wondelai`, version
`1.4.0`. Its source package supplied no separate license text. The hexagonal
source records origin `ECC`; VSA records version `1.0.3`. Other architecture
sources supply no license declaration. Preserve these attributions; this merge
does not assert a new blanket license or establish redistribution rights absent
from the supplied sources.

Conflicts were resolved by distinguishing organization from dependency direction:
VSA owns feature cohesion; Clean/Hexagonal boundaries apply within a feature or
context when useful. Domain- and application-owned repository ports are both
valid. Rich models, ACLs, events, and separate services are conditional choices.
Arbitrary aggregate-size/team-size cutoffs and compulsory numerical scoring were
removed. Consistency requirements take precedence over a blanket prohibition on
cross-aggregate transactions. Payment/save examples were replaced with explicit
failure and recovery guidance.

Duplicated tutorials, class templates, generic checklists, and repeated
cheatsheets were synthesized into the topic references. The original package
snapshot is retained separately for provenance; runtime use needs only this
directory and does not load the old skills.
