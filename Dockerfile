FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    FLASK_PORT=5199 \
    VITE_PORT=5198 \
    VITE_API_PROXY=http://127.0.0.1:5199

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends nodejs npm \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY digital-edu-web/package*.json digital-edu-web/
RUN cd digital-edu-web && npm install

COPY . .

EXPOSE 5199 5198

CMD ["python", "run_dev.py"]
