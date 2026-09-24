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
# For a deployment behind a reverse proxy (a different backend address
# per environment, decided after this image is already built), set the
# BACKEND_URL *container* environment variable instead — see
# docker-entrypoint.sh — rather than rebuilding with this build arg.
ARG VITE_BACKEND_URL=
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh
EXPOSE 80
ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
