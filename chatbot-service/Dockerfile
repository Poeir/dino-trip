FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY src ./src

# Non-root user + writable HOME: HF Spaces containers don't grant root a
# writable home dir, and sentence-transformers needs one to cache the
# embedding model it downloads on first request.
RUN useradd -m -u 1000 appuser
ENV HOME=/app \
    HF_HOME=/app/.cache/huggingface
RUN mkdir -p "$HF_HOME" && chown -R appuser:appuser /app
USER appuser

EXPOSE 7860

CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "7860"]
