---
name: security
metadata:
  adaptation_version: "1.0.0"
description: Review application security, implement secure defaults or requested security fixes, and analyze sensitive-code ownership and bus-factor risks from Git history. Use when the user requests security guidance, hardening, a vulnerability report, security maintainers, orphaned sensitive code, or a security ownership map. Includes Python, JavaScript/TypeScript, and Go guidance plus language-independent ownership tooling. Do not initiate a security audit for ordinary coding, debugging, or general maintainer questions.
---

# Gestalt Security

Select the requested security outcome and keep the work within its scope. This
single skill includes secure implementation, evidence-based review, remediation,
and Git-based ownership analysis. Its references and tools are local; no source
skill needs to be invoked.

## Workflow

1. Establish the repository, requested component and outcome. Identify relevant
   languages, frameworks, deployment assumptions, and existing protections.
   Distinguish observed configuration from assumptions about proxies or hosting.
2. Select the mode below. A review alone does not authorize unrelated fixes;
   an explicit request to fix or harden authorizes the necessary in-scope edits.
   Do not ask again for permission already supplied.
3. Load the matching references, including both frontend and backend when in
   scope. For ownership work, inspect Git history availability and use the
   bundled workflow instead of inferring maintainers from filenames.
4. Produce findings or changes with concrete evidence. Validate remediation
   against exploit conditions and intended behavior; qualify ownership results
   by the history window and attribution method.
5. Summarize the result, output paths, checks, and gaps. Do not claim a complete
   security assessment from a few searches or a passing test suite.

| Request | Action |
|---|---|
| Secure-by-default implementation | Apply relevant controls to the requested code; test its access and trust boundaries |
| Security review/report | Trace untrusted input to sensitive operations and verify applicable controls; write prioritized findings |
| Fix/harden | Correct the requested findings in coherent changes, preserving legitimate behavior and testing regression paths |
| Security ownership/bus factor | Read [ownership analysis](references/ownership.md), run bundled tools, and report evidence and limitations |

Passive detection applies only while this security task is active: report a
clearly material issue encountered in nearby code without silently widening the
task into a repository-wide audit.

## Select framework guidance

Read each applicable row, not the entire library. The browser baseline applies
alongside its framework guide. Next.js work may need both server and React/browser
guidance. Confirm installed versions before applying version-specific advice.

| Stack | Reference |
|---|---|
| Go backend | [Go](references/golang-general-backend-security.md) |
| Node/Express server | [Express](references/javascript-express-web-server-security.md) |
| Next.js server | [Next.js](references/javascript-typescript-nextjs-web-server-security.md) |
| Browser JS/TS; frontend unspecified | [Browser baseline](references/javascript-general-web-frontend-security.md) |
| React | [React](references/javascript-typescript-react-web-frontend-security.md) |
| Vue | [Vue](references/javascript-typescript-vue-web-frontend-security.md) |
| jQuery | [jQuery](references/javascript-jquery-web-frontend-security.md) |
| Django | [Django](references/python-django-web-server-security.md) |
| FastAPI | [FastAPI](references/python-fastapi-web-server-security.md) |
| Flask | [Flask](references/python-flask-web-server-security.md) |

These are supplied reference snapshots, not claims about current supported
versions. When a stack is missing or behavior has changed, state the coverage
gap and verify against primary documentation if available. Do not substitute a
different framework's defaults or invent vulnerabilities. Ownership analysis is
language-independent and does not require a matching framework guide.

## Common interpretation rules

- Treat IDs as identifiers, not authorization. Unpredictable public IDs can
  reduce enumeration but never replace object-level access checks.
- Determine where TLS terminates before reporting missing HTTPS. Production
  cookie settings must match the real deployment; explicitly separate local
  HTTP development settings. HSTS needs deployment/domain knowledge and a
  rollout decision, rather than automatic insertion.
- Follow explicit project constraints, document deliberate exceptions, and
  explain residual risk. Do not weaken unrelated protections to make a fix pass.
- Redact secret values from reports and logs; use paths and secret types as
  evidence. Prefer vetted platform controls over custom authentication/crypto.
- Reference instructions about generation, passive review, or audit are active
  only within the selected mode and scope above; they do not initiate extra work.

## Review and remediation deliverables

For a requested report, default to `security_best_practices_report.md` unless a
destination is supplied. Include scope, inspected revision/components, assumptions,
coverage gaps, and a short executive summary. Order findings by severity. Give
each a stable numeric ID, file and current line, evidence, attack preconditions,
impact, recommended correction, and a way to validate it. Separate confirmed
findings from controls that are not visible or need runtime verification.

For critical findings, include a one-sentence impact statement. Prioritize
reachable vulnerabilities over generic checklist deviations. An inconclusive
search is not evidence of absence. If there are no confirmed findings, say what
was examined and what remains unverified.

For authorized fixes, work on a coherent finding at a time, account for clients
that rely on old behavior, and test denial paths as well as legitimate requests.
Explain non-obvious controls in concise comments where useful; do not add a
comment to every line. Follow the repository's test and change workflow.
When review-only scope is complete, present the report and proposed next steps
without applying unrelated changes.

Attribution: [provenance](references/provenance.md).
