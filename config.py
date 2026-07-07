import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv('SECRET_KEY', 'dev-secret-key')
    SQLALCHEMY_DATABASE_URI = os.getenv('DATABASE_URL', 'sqlite:///digital-edu.db')
    SQLALCHEMY_TRACK_MODIFICATIONS = False
    SESSION_TYPE = 'filesystem'
    SESSION_FILE_DIR = os.path.join(os.path.abspath(os.path.dirname(__file__)), 'instance', 'sessions')
    COURSES_DIR = os.environ.get('COURSES_DIR') or os.path.join(os.path.abspath(os.path.dirname(__file__)), 'courses')
    TEMPLATES_DIR = os.environ.get('TEMPLATES_DIR') or os.path.join(os.path.abspath(os.path.dirname(__file__)), 'templates')
