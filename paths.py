"""Central path resolution for DigitalEdu.

When running as a normal Python script, paths resolve relative to the
project root (where this file lives).

When running as a PyInstaller --onefile bundle, sys._MEIPASS points to
the temporary extraction directory and all bundled data lives there.
"""
import os
import sys

FROZEN = getattr(sys, 'frozen', False)

if FROZEN:
    APP_DIR = sys._MEIPASS
else:
    APP_DIR = os.path.dirname(os.path.abspath(__file__))


def app_path(*parts):
    """Return an absolute path inside the application bundle / project root."""
    return os.path.join(APP_DIR, *parts)


COURSES_DIR = os.environ.get('COURSES_DIR') or app_path('courses')
STATIC_DIR = app_path('static')
SPA_DIR = app_path('static', 'spa')
TEMPLATES_DIR = os.environ.get('TEMPLATES_DIR') or app_path('templates')
WORKSHOP_GROUPS_JSON = app_path('scripts', 'workshop_groups.json')
