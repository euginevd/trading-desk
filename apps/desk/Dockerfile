# syntax=docker/dockerfile:1
# The desk (decision 14). Built from the repo root: docker build -f apps/desk/Dockerfile .

# Build: the same Node as CI, pinned by digest, at the repo's depth (known-mistakes 23).
FROM node:24.22.1-bookworm-slim@sha256:be8204d4bd327363357f532187b752ff62759c31bedf98e9e18fc08c9cbd605c AS build
WORKDIR /web/apps/desk
COPY apps/desk/package.json apps/desk/package-lock.json apps/desk/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY apps/desk/ ./
RUN npm run build

# Serve: nginx as a non-root user, with the api behind /api on the compose network.
FROM nginxinc/nginx-unprivileged:1.30-alpine@sha256:f5116ed4606f3eb015dd4a8e28cb9b351476dc0ad4bc6e9f93b19cec130cdf03
# Alpine's security fixes, which the base image doesn't carry yet; then back to the non-root user.
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/desk/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/apps/desk/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
