# The game now has a real backend (accounts + scores), so nginx alone isn't
# enough anymore - this runs the Flask app (via gunicorn) which serves both
# the static game files in public/ and the /api/* auth endpoints.
FROM python:3.12-slim

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .
COPY public/ public/

EXPOSE 80

# 2 workers is enough for a small college-project game; gunicorn handles
# concurrent requests without us needing to think about threading.
CMD ["gunicorn", "--bind", "0.0.0.0:80", "--workers", "2", "server:app"]
