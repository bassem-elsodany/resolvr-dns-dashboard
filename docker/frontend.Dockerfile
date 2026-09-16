# Build context is the repo root (see docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /app

# Vite bakes VITE_-prefixed env vars into the build at build time (this
# is a static SPA — there is no server-side runtime to read env vars
# from later). Left unset by default: the app falls back to "whatever
# host served this page, port 8787" at runtime in the browser, which is
# correct for the common single-host deployment regardless of whether
# it's reached via localhost, a LAN IP, or a hostname — set this only
# for a split-host setup where the backend lives somewhere else.
ARG VITE_BACKEND_URL=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
