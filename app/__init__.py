import os
from flask import Flask, flash, redirect, url_for
from flask_sqlalchemy import SQLAlchemy
from flask_login import LoginManager, current_user
from flask_session import Session
from flask_migrate import Migrate
from config import Config

db = SQLAlchemy()
login_manager = LoginManager()
sess = Session()
migrate = Migrate()


def create_app(config_class=Config):
    application = Flask(__name__, static_folder=os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'static'))
    application.config.from_object(config_class)

    db.init_app(application)
    login_manager.init_app(application)
    sess.init_app(application)
    migrate.init_app(application, db)

    login_manager.login_view = 'auth.login'
    login_manager.login_message_category = 'info'

    from .routes.auth import auth_bp
    from .routes.main import main_bp
    from .routes.courses import courses_bp
    from .routes.progress_api import progress_api, validate_api
    from .routes.admin import admin_bp
    application.register_blueprint(auth_bp)
    application.register_blueprint(main_bp)
    application.register_blueprint(courses_bp)
    application.register_blueprint(progress_api)
    application.register_blueprint(validate_api)
    application.register_blueprint(admin_bp)

    @application.before_request
    def check_banned():
        if current_user.is_authenticated and current_user.is_banned:
            flash('Your account has been suspended.', 'error')
            return redirect(url_for('auth.logout'))

    with application.app_context():
        from . import models
        db.create_all()
        from .services import course_parser
        if course_parser.load_structure() == {}:
            course_parser.capture_structure()

    return application
