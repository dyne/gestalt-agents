# Sources and consolidation decisions

Adapted from supplied `security-best-practices` and `security-ownership-map`
packages. Both include the Apache 2.0 license, retained in [LICENSE.txt](../LICENSE.txt).
The ten language/framework security references and four ownership Python tools
are retained with trailing whitespace normalized in four framework guides
(Express, browser baseline, React, and Django). The Neo4j guide is retained with an import-scope note.
Upstream repositories, snapshot identity, and downstream checksums are recorded
in the plugin's `UPSTREAM.md` and checksum fixture.

The entrypoint replaces two separate skills with explicit implementation, review,
remediation, and ownership modes. All framework references remain directly
discoverable. The ownership workflow uses paths relative to this skill instead
of the original hard-coded `skills/skills/security-ownership-map` paths.

Mode routing now controls inherited "always-on" passive-review language. Existing
authorization for fixes is respected rather than requesting approval twice.
Unsupported frameworks and stale version assumptions are stated explicitly.
Unpredictable IDs are distinguished from access control. TLS/HSTS advice is tied
to the actual deployment. Git metrics and timestamp offsets are described as
proxies with limitations, and global dependency installation is no longer implicit.
