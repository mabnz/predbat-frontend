FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install dependencies first (better layer caching)
COPY requirements.txt .
RUN pip install -r requirements.txt

# Copy app source
COPY app.py ./
COPY templates/ ./templates/
COPY static/ ./static/

EXPOSE 5053

CMD ["waitress-serve", "--listen=0.0.0.0:5053", "app:app"]
