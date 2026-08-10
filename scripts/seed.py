from app import create_app, db
from app.models.user import User

app = create_app()
with app.app_context():
    from datetime import datetime
    existing = User.query.filter(
        (User.email == 'nexuss0781@gmail.com') | (User.username == 'nexuss0781')
    ).first()
    if existing:
        existing.email = 'nexuss0781@gmail.com'
        existing.username = 'nexuss0781'
        existing.role = 'admin'
        existing.set_password('123456')
        if not existing.date_joined:
            existing.date_joined = datetime.utcnow()
        db.session.commit()
        print(f'Updated user {existing.id}: {existing.username} -> admin')
    else:
        user = User(
            email='nexuss0781@gmail.com',
            username='nexuss0781',
            role='admin',
            date_joined=datetime.utcnow(),
        )
        user.set_password('123456')
        db.session.add(user)
        db.session.commit()
        print('Created admin user')
    print('Done')
