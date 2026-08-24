import os
from dotenv import load_dotenv
from paths import COURSES_DIR as _BUNDLE_COURSES, TEMPLATES_DIR as _BUNDLE_TEMPLATES

load_dotenv()


def _base_dir():
    """Return a persistent, user-level data directory.

    On Windows this is %APPDATA%\\DigitalEdu (safe from classroom users and
    survives the app folder being read-only). On other platforms fall back to
    <project>/instance so the current dev behaviour is unchanged.
    """
    override = os.environ.get('DIGITALEDU_DATA_DIR')
    if override:
        return override
    if os.name == 'nt':
        appdata = os.environ.get('APPDATA')
        if appdata:
            return os.path.join(appdata, 'DigitalEdu')
    from paths import FROZEN, APP_DIR
    if FROZEN:
        if os.name == 'nt':
            return os.path.join(os.environ.get('APPDATA', APP_DIR), 'DigitalEdu')
        # Frozen on Linux/macOS: keep data out of the ephemeral _MEIPASS dir
        xdg_data = os.environ.get('XDG_DATA_HOME') or os.path.expanduser('~/.local/share')
        return os.path.join(xdg_data, 'DigitalEdu')
    return os.path.join(APP_DIR, 'instance')


def _ensure(path):
    try:
        os.makedirs(path, exist_ok=True)
    except OSError:
        pass
    return path


class Config:
    BASE_DIR = _base_dir()
    BACKUP_DIR = _ensure(os.path.join(BASE_DIR, 'backups'))
    SESSION_FILE_DIR = _ensure(os.path.join(BASE_DIR, 'sessions'))
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    _db_path = os.path.join(BASE_DIR, 'digital-edu.db').replace(os.sep, '/')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', f"sqlite:///{_db_path}")
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = 'filesystem'
    COURSES_DIR = _BUNDLE_COURSES
    TEMPLATES_DIR = _BUNDLE_TEMPLATES
