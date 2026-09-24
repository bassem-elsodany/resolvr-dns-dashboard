// Placeholder for local dev / a static-file-host deploy. In the Docker
// image, docker/docker-entrypoint.sh overwrites this file at container
// startup from the BACKEND_URL environment variable, so it can be set
// per-deployment without rebuilding the image (e.g. behind a reverse
// proxy that forwards /api to the backend on the same origin — see
// frontend/src/lib/backendUrl.ts).
window.__RESOLVR_ENV__ = {}
