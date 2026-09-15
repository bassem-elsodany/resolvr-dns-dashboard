# Build context is the repo root (see docker-compose.yml) so this stage
# can reach backend/ without the standalone package needing its own
# .dockerignore duplication.
FROM node:24-alpine AS build
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/tsconfig.json ./
COPY backend/src ./src
RUN npm run build

FROM node:24-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY backend/package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
EXPOSE 8787
CMD ["node", "dist/server.js"]
