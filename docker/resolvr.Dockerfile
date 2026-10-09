# Single-container image: the API and the built web app in one process.
# This is what the Home Assistant add-on runs, and it is the simplest way to
# run Resolvr anywhere else too. Build context is the repo root:
#   docker build -f docker/resolvr.Dockerfile -t resolvr .

FROM node:24-alpine AS web
WORKDIR /web
COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM node:24-alpine AS api
WORKDIR /app
# better-sqlite3 is a native module and needs a compiler toolchain to
# build on Alpine — only needed in this stage, never in the final image.
RUN apk add --no-cache python3 make g++
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build
RUN npm prune --omit=dev

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8787 \
    STATIC_DIR=/app/public \
    DB_PATH=/app/data/resolvr.db
COPY --from=api /app/node_modules ./node_modules
COPY --from=api /app/package*.json ./
COPY --from=api /app/dist ./dist
COPY --from=web /web/dist ./public
VOLUME ["/app/data"]
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8787/healthz >/dev/null || exit 1
CMD ["node", "dist/server.js"]
