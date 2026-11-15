# syntax=docker/dockerfile:1
# The desk (decision 14). Built from the repo root: docker build -f apps/desk/Dockerfile .

# Build: the same Node as CI, pinned by digest, at the repo's depth (known-mistakes 23).
FROM node:26.13.0-bookworm-slim@sha256:add5c17c14752c54d2f3d519ec46a3815684d41c33f198bcb09fb998f7dcbf68 AS build
WORKDIR /web/apps/desk
COPY apps/desk/package.json apps/desk/package-lock.json apps/desk/.npmrc ./
RUN npm ci --no-audit --no-fund
COPY apps/desk/ ./
RUN npm run build

# Serve: nginx as a non-root user, with the api behind /api on the compose network.
FROM nginxinc/nginx-unprivileged:1.31-alpine@sha256:b5047b9b76845eac124358373c6852377c52e4b05834a47647e955dd91cb8f1e
# Alpine's security fixes, which the base image doesn't carry yet; then back to the non-root user.
USER root
RUN apk upgrade --no-cache
USER 101
COPY apps/desk/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /web/apps/desk/dist /usr/share/nginx/html
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
    CMD wget -q -O /dev/null http://127.0.0.1:8080/ || exit 1
