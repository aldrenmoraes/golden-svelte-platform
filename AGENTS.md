# Golden Svelte Platform Contract

- Use Bun for package installation, scripts, tests, and production execution.
- Use Svelte 5 runes; do not introduce legacy stores without an approved platform change.
- Use Tailwind CSS semantic tokens. Do not hard-code palette values in feature components.
- Use Paraglide message functions for every user-facing string. Update all four locales in one change.
- Use Better Auth and server-side RBAC checks for every mutable route.
- Use Drizzle repositories for PostgreSQL access. Never access the database directly from a page component.
- Use bun test; Vitest is not part of this platform.
- Preserve traceId, spanId, correlationId, appVersion, and user context in structured logs.
- Read project.manifest.yaml and docs/product-brief.md before changing domain code.
- Do not change platform contracts unless the task is labeled platform-change.
