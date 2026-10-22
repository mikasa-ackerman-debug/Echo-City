# syntax=docker/dockerfile:1.7
# Echo City · 残响城 — one image, two targets: `api` and `web`.
#   docker compose up -d --build          (see docs/DEPLOY.md)

FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY packages/agents/package.json packages/agents/
COPY packages/engine/package.json packages/engine/
COPY packages/exam/package.json packages/exam/
COPY packages/protocol/package.json packages/protocol/
COPY packages/runner/package.json packages/runner/
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY examples/webhook-ts/package.json examples/webhook-ts/
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund

FROM deps AS source
COPY tsconfig.base.json tsconfig.json ./
COPY packages packages
COPY apps apps
COPY examples examples

# ---------- API: TypeScript sources run directly with tsx ----------
FROM source AS api
ENV NODE_ENV=production PORT=8787 ECHO_DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
USER node
EXPOSE 8787
VOLUME ["/data"]
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD wget -qO- http://127.0.0.1:8787/api/exam/library >/dev/null || exit 1
CMD ["node", "--import", "tsx", "apps/api/src/main.ts"]

# ---------- Web: Next.js production build ----------
FROM source AS web-build
# Empty = same origin (the reverse proxy routes /api/* to the API). Set a full URL to split hosts.
ARG NEXT_PUBLIC_API_URL=""
ENV NEXT_PUBLIC_API_URL=${NEXT_PUBLIC_API_URL} NEXT_TELEMETRY_DISABLED=1
RUN npm run build -w @echo/web

FROM web-build AS web
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
USER node
EXPOSE 3000
CMD ["npm", "run", "start", "-w", "@echo/web"]
