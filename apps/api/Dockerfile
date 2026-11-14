# syntax=docker/dockerfile:1
# The api (decision 14). Built from the repo root: docker build -f apps/api/Dockerfile .

# Build: uv's own image, the same one CI uses, pinned by digest.
FROM ghcr.io/astral-sh/uv:0.13.6-python3.13-trixie-slim@sha256:e586c1c65b7071aec78f02c5587c76c5011159cd76b3d6f1255f40e48e850abc AS build
ENV UV_COMPILE_BYTECODE=1 UV_LINK_MODE=copy UV_PYTHON_DOWNLOADS=never
WORKDIR /app
COPY pyproject.toml uv.lock .python-version ./
COPY apps/api/pyproject.toml apps/api/pyproject.toml
COPY apps/api/src apps/api/src
RUN uv sync --locked --no-dev --no-editable

# Run: the matching slim Python, patched, without pip (known-mistakes 12), as a non-root user.
FROM python:3.13-slim-trixie@sha256:e48f59cdba69a3cbd9ed2cf0f348d90d45a8d350d98134cf1070bc106ee9ed90
RUN apt-get update && apt-get upgrade -y && rm -rf /var/lib/apt/lists/* \
    && python -m pip uninstall -y pip setuptools wheel || true
RUN useradd --uid 10001 --no-create-home desk && mkdir -p /app/local && chown desk /app/local
WORKDIR /app
COPY --from=build /app/.venv /app/.venv
ENV PATH=/app/.venv/bin:$PATH PYTHONUNBUFFERED=1 \
    API_HOST=0.0.0.0 DESK_DB_DIR=/app/local AUDIT_LOG_PATH=/app/local/audit.jsonl
USER desk
EXPOSE 8000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
    CMD ["python", "-c", "import http.client as h; c = h.HTTPConnection('127.0.0.1', 8000, timeout=3); c.request('GET', '/health'); exit(c.getresponse().status != 200)"]
CMD ["python", "-m", "api.local"]
