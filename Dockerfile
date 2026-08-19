# Build the React SPA during the image build so Render receives a self-contained image.
FROM node:22-bookworm-slim AS frontend-builder
WORKDIR /src/digital-edu-web

COPY digital-edu-web/package*.json ./
RUN npm ci

COPY digital-edu-web/ ./
RUN npm run build

# Production Flask image.
FROM python:3.12-slim
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DISABLE_COURSE_WATCHER=1 \
    FLASK_PORT=10000

WORKDIR /app

COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY . ./
# Always use the SPA compiled in this Docker build, rather than stale generated files.
COPY --from=frontend-builder /src/digital-edu-web/dist ./static/spa

EXPOSE 10000

CMD ["sh", "-c", "exec gunicorn --bind 0.0.0.0:${PORT:-10000} --workers 1 --threads 4 --timeout 120 wsgi:app"]
