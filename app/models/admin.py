from datetime import datetime
from .. import db


class Ban(db.Model):
    __tablename__ = 'bans'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    banned_by = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    reason = db.Column(db.String(500), default='')
    banned_at = db.Column(db.DateTime, default=datetime.utcnow)
    expires_at = db.Column(db.DateTime, nullable=True)
    active = db.Column(db.Boolean, default=True)

    user = db.relationship('User', foreign_keys=[user_id], backref=db.backref('bans', lazy=True))


class CertificateTemplate(db.Model):
    __tablename__ = 'certificate_templates'

    id = db.Column(db.Integer, primary_key=True)
    name = db.Column(db.String(200), nullable=False)
    header = db.Column(db.String(200), default='Certificate of Completion')
    subtitle = db.Column(db.String(200), default='')
    description = db.Column(db.Text, default='')
    issuer = db.Column(db.String(200), default='Digital-Edu')
    footer = db.Column(db.String(200), default='')
    created_at = db.Column(db.DateTime, default=datetime.utcnow)


class Certificate(db.Model):
    __tablename__ = 'certificates'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    template_id = db.Column(db.Integer, db.ForeignKey('certificate_templates.id'), nullable=True)
    category_id = db.Column(db.String(200), nullable=False)
    category_title = db.Column(db.String(200), nullable=False)
    subcategory_ids = db.Column(db.Text, default='')
    awarded_at = db.Column(db.DateTime, default=datetime.utcnow)

    user = db.relationship('User', backref=db.backref('certificates_list', lazy=True))
    template = db.relationship('CertificateTemplate', backref=db.backref('certificates', lazy=True))
