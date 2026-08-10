#!/usr/bin/env python3
"""Quick smoke test for auth API endpoints."""
import sys, os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('SECRET_KEY', 'test-key')

from app import create_app

app = create_app()

with app.test_client() as c:
    print("=== Register ===")
    r = c.post('/api/v1/auth/register', json={
        'email': 'test@example.com',
        'username': 'testuser',
        'password': 'password123'
    })
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
    print()

    print("=== Login ===")
    r = c.post('/api/v1/auth/login', json={
        'email': 'test@example.com',
        'password': 'password123'
    })
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
    print()

    print("=== Login wrong password ===")
    r = c.post('/api/v1/auth/login', json={
        'email': 'test@example.com',
        'password': 'wrongpassword'
    })
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
    print()

    print("=== Me (authenticated) ===")
    r = c.get('/api/v1/auth/me')
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
    print()

    print("=== Register duplicate ===")
    r = c.post('/api/v1/auth/register', json={
        'email': 'test@example.com',
        'username': 'testuser2',
        'password': 'password123'
    })
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
    print()

    print("=== Login missing fields ===")
    r = c.post('/api/v1/auth/login', json={})
    print(f"Status: {r.status_code}")
    print(f"Content-Type: {r.content_type}")
    print(f"Body: {r.get_data(as_text=True)}")
