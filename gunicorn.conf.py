import os
import multiprocessing

bind = os.getenv('GUNICORN_BIND', '0.0.0.0:' + os.getenv('PORT', '8000'))
# SQLite: keep 1 worker to avoid "database is locked" across processes.
# Raise with GUNICORN_WORKERS when a real server DB is used.
workers = int(os.getenv('GUNICORN_WORKERS', '1'))
worker_class = 'sync'
timeout = 120
keepalive = 5
accesslog = os.getenv('GUNICORN_ACCESS_LOG', '-')
errorlog = os.getenv('GUNICORN_ERROR_LOG', '-')
loglevel = os.getenv('GUNICORN_LOG_LEVEL', 'info')
preload_app = False
reload = os.getenv('GUNICORN_RELOAD', 'false').lower() in ('1', 'true', 'yes')
if reload:
    reload_extra_files = ['app/templates/']
