# Backend Dockerfile for HeroMaker API
FROM python:3.11-slim

# Set working directory
WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    gcc \
    && rm -rf /var/lib/apt/lists/*

# Copy requirements first for better caching
COPY requirements.txt .

# Install Python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy backend application code
COPY app/ ./app/

# Create data directories if they don't exist (will be mounted as volume)
RUN mkdir -p /app/data/files /app/data/db

# Expose the FastAPI port (Railway sets PORT env var)
EXPOSE 8000

# Health check (use PORT env var, default to 8000)
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD sh -c "python -c \"import urllib.request, os; port = os.getenv('PORT', '8000'); urllib.request.urlopen(f'http://localhost:{port}/health')\"" || exit 1

# Run the application (use PORT env var for Railway, default to 8000)
# Use --reload for hot reload in development (when DEBUG=true)
CMD sh -c "if [ \"$DEBUG\" = \"true\" ]; then uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --reload; else uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}; fi"

