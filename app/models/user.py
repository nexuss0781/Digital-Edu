from flask_login import UserMixin
from werkzeug.security import generate_password_hash, check_password_hash
from .. import db, login_manager


class User(UserMixin, db.Model):
    __tablename__ = 'users'

    id = db.Column(db.Integer, primary_key=True)
    email = db.Column(db.String(120), unique=True, nullable=False)
    username = db.Column(db.String(80), unique=True, nullable=False)
    password_hash = db.Column(db.String(256), nullable=False)
    role = db.Column(db.String(20), nullable=False, default='student')
    profile_visibility = db.Column(db.String(20), default='public')

    certifications = db.Column(db.Text, default='')
    achievements = db.Column(db.Text, default='')
    bio = db.Column(db.Text, default='')
    avatar = db.Column(db.String(200), default='')

    def set_password(self, password):
        self.password_hash = generate_password_hash(password)

    def check_password(self, password):
        return check_password_hash(self.password_hash, password)

    @property
    def is_banned(self):
        from .admin import Ban
        now = __import__('datetime').datetime.utcnow()
        active_ban = Ban.query.filter(
            Ban.user_id == self.id,
            Ban.active == True,
            db.or_(Ban.expires_at.is_(None), Ban.expires_at > now)
        ).first()
        return active_ban is not None

    def to_dict(self):
        return {
            'id': self.id,
            'email': self.email,
            'username': self.username,
            'role': self.role,
        }


@login_manager.user_loader
def load_user(user_id):
    return db.session.get(User, int(user_id))
