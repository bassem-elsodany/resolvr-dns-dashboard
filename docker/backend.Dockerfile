# Build context is the repo root (see docker-compose.yml) so this stage
# can reach backend/ without the standalone package needing its own
# .dockerignore duplication.
FROM node:24-alpine AS build
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
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package*.json ./
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/server.js"]
