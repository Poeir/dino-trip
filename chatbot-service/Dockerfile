FROM python:3.11-slim

WORKDIR /app

COPY requirements.txt .
# CPU-only torch: sentence-transformers otherwise pulls the CUDA build, which
# is both a much larger image and noticeably more RAM at runtime -- enough to
# OOM-kill on memory-capped hosts like Render's free tier even though nothing
# here ever touches a GPU.
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu
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

# Shell form (not exec form) so $PORT expands -- Render injects PORT
# dynamically, HF Spaces expects the fixed 7860 default.
CMD uvicorn src.main:app --host 0.0.0.0 --port ${PORT:-7860}
