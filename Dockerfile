FROM oven/bun:1.3.9-alpine AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile

FROM dependencies AS build
COPY . .
ARG APP_VERSION=0.0.0
ARG GIT_SHA=unknown
ENV NODE_ENV=production APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA
RUN bun run build

FROM oven/bun:1.3.9-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
COPY --from=dependencies /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
USER bun
EXPOSE 3000
CMD ["bun", "build/index.js"]
