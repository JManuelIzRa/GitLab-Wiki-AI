"""Shared slowapi Limiter instance. Imported by both main.py (to attach to the app)
and routes.py (to decorate endpoints). Keeping it in a dedicated module avoids
circular imports between main and routes."""
from slowapi import Limiter
from slowapi.util import get_remote_address

limiter = Limiter(key_func=get_remote_address)
