# Platform architecture

The platform uses SvelteKit with Svelte 5 runes, Bun, Tailwind, Paraglide, Better Auth with RBAC, Drizzle/PostgreSQL, OpenTelemetry, JSON logging, Docker Compose, Traefik-compatible production labels, and Bun test. Domain modules belong under src/lib/server/modules/<context>.
