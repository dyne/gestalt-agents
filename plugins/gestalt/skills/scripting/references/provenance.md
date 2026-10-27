# Sources and consolidation decisions

Adapted from supplied `bash-linux` and `bash-defensive-patterns`, including the
latter's `references/details.md`. The supplied packages do not declare a license;
upstream source identity and snapshot hashes are recorded in the plugin's
`UPSTREAM.md`. This adaptation does not assert a new license for those sources.

Terminal operators, files, text processing, processes, environment, networking,
and Bash/PowerShell distinctions were merged into shell behavior. Strict mode,
argument parsing, arrays, functions, logging, temporary files, signals, safe
writes, command substitution, named options, dependency checks, idempotency,
and dry-run were merged into reliable automation and the executable example.

Changed unsafe or overbroad instructions: strict mode is conditional on dialect
and caller contract; explicit error checks replace claims that `set -e` catches
everything; cleanup no longer reuses `TMPDIR` or a fixed path; process termination
is scoped and graceful; individual child failures are collected; option arity is
checked; atomic replacement uses the destination filesystem; logging avoids
environment/secret dumps. Broad OS-based triggering was narrowed to shell work.
