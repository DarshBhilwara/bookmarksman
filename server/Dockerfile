FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    BOOKMARKSMAN_DATA=/data/profiles

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt \
    && groupadd --system bookmarksman \
    && useradd --system --gid bookmarksman --home-dir /nonexistent bookmarksman \
    && mkdir -p /data/profiles \
    && chown -R bookmarksman:bookmarksman /data

COPY app ./app
USER bookmarksman
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD python -c "from urllib.request import urlopen; urlopen('http://127.0.0.1:8080/api/health', timeout=2)"
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8080"]
