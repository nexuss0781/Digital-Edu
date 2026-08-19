"""Production WSGI entrypoint used by Gunicorn and Render."""
from app import create_app

app = create_app()
