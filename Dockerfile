FROM oven/bun:1.3.14-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ENV NODE_ENV=production APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
# The SvelteKit post-build analysis imports every server chunk, and Better Auth validates its
# configuration when the module is constructed. These placeholders exist only in this build
# stage: `$env/dynamic/private` is read at runtime, so nothing here reaches the runtime image.
RUN BETTER_AUTH_SECRET=build-stage-placeholder-not-used-at-runtime \
	ORIGIN=http://localhost:3000 \
	bun run build

FROM oven/bun:1.3.14-alpine AS runtime
WORKDIR /app
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
# Version metadata is read from the environment at runtime by /api/health and the logger.
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000 APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
# Migrations run from this same image (the compose `migrate` service), so the Drizzle
# configuration and the generated SQL must ship with the runtime layer.
COPY drizzle.config.ts ./
COPY drizzle ./drizzle
USER bun
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
	CMD wget -qO- "http://127.0.0.1:${PORT}/api/health" >/dev/null 2>&1 || exit 1
CMD ["bun", "build/index.js"]
