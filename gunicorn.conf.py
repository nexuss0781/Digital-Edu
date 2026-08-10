import os
import multiprocessing

bind = os.getenv('GUNICORN_BIND', '0.0.0.0:' + os.getenv('PORT', '8000'))
workers = int(os.getenv('GUNICORN_WORKERS', multiprocessing.cpu_count() * 2 + 1))
worker_class = 'sync'
timeout = 120
keepalive = 5
accesslog = os.getenv('GUNICORN_ACCESS_LOG', '-')
errorlog = os.getenv('GUNICORN_ERROR_LOG', '-')
loglevel = os.getenv('GUNICORN_LOG_LEVEL', 'info')
preload_app = False
reload = True
reload_extra_files = ['app/templates/']
