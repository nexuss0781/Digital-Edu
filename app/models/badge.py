from datetime import datetime
from .. import db


class Badge(db.Model):
    __tablename__ = 'badges'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    description = db.Column(db.Text, default='')
    icon = db.Column(db.String(50), default='award')
    badge_type = db.Column(db.String(30), nullable=False)
    config = db.Column(db.Text, default='{}')
    enabled = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime, default=datetime.utcnow)

    awards = db.relationship('UserBadge', backref='badge', lazy=True, cascade='all, delete-orphan')


class UserBadge(db.Model):
    __tablename__ = 'user_badges'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    badge_id = db.Column(db.Integer, db.ForeignKey('badges.id'), nullable=False)
    awarded_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('user_badges', lazy=True))


class ActivityLog(db.Model):
    __tablename__ = 'activity_log'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    date = db.Column(db.Date, nullable=False)
    count = db.Column(db.Integer, default=0)
    content_ids = db.Column(db.Text, default='')

    user = db.relationship('User', backref=db.backref('activity_logs', lazy=True))

    __table_args__ = (db.UniqueConstraint('user_id', 'date', name='uq_user_date'),)
