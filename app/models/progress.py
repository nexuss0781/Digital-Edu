from .. import db

class Progress(db.Model):
    __tablename__ = 'progress'

    id = db.Column(db.Integer, primary_key=True)
    user_id = db.Column(db.Integer, db.ForeignKey('users.id'), nullable=False)
    content_id = db.Column(db.String(200), nullable=False)
    content_type = db.Column(db.String(20), nullable=False)
    completed = db.Column(db.Boolean, default=False)
    step_index = db.Column(db.Integer, default=0)
    score = db.Column(db.Float, nullable=True)
    passed = db.Column(db.Boolean, nullable=True)
    submission = db.Column(db.Text, nullable=True)
    verdict = db.Column(db.String(20), nullable=True)

    user = db.relationship('User', backref=db.backref('progress', lazy=True))
