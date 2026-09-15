# Build context is the repo root (see docker-compose.yml).
FROM node:24-alpine AS build
WORKDIR /app

# Vite bakes VITE_-prefixed env vars into the build at build time (this
# is a static SPA — there is no server-side runtime to read env vars
# from later), so the backend's reachable URL has to be known now.
ARG VITE_BACKEND_URL=http://localhost:8787
ENV VITE_BACKEND_URL=$VITE_BACKEND_URL

COPY frontend/package*.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM nginx:alpine
COPY --from=build /app/dist /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
