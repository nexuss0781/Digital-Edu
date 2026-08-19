import os
from flask import Blueprint, send_from_directory, send_file, abort, redirect, url_for
from paths import SPA_DIR, STATIC_DIR

spa_bp = Blueprint('spa', __name__)

_SPA_DIR = SPA_DIR


def serve_spa():
    """Serve the built React SPA (Vite) index; fall back to /app."""
    index = os.path.join(_SPA_DIR, 'index.html')
    if os.path.isfile(index):
        return send_file(index)
    return redirect(url_for('spa.spa_index'))


@spa_bp.route('/app/')
@spa_bp.route('/app')
def spa_index():
    return send_file(os.path.join(_SPA_DIR, 'index.html'))


@spa_bp.route('/app/<path:path>')
def spa_catch_all(path):
    file_path = os.path.join(_SPA_DIR, path)
    if os.path.isfile(file_path):
        return send_from_directory(_SPA_DIR, path)
    return send_file(os.path.join(_SPA_DIR, 'index.html'))


# Serve SPA assets at root /assets/... for admin SPA
@spa_bp.route('/assets/<path:filename>')
def spa_assets(filename):
    assets_dir = os.path.join(_SPA_DIR, 'assets')
    file_path = os.path.join(assets_dir, filename)
    if os.path.isfile(file_path):
        return send_from_directory(assets_dir, filename)
    abort(404)


# Serve SPA images at root /images/... (logo, noise, course placeholder)
@spa_bp.route('/images/<path:filename>')
def spa_images(filename):
    images_dir = os.path.join(_SPA_DIR, 'images')
    file_path = os.path.join(images_dir, filename)
    if os.path.isfile(file_path):
        return send_from_directory(images_dir, filename)
    abort(404)


# Default browser request for the site favicon; we only ship an SVG one.
@spa_bp.route('/favicon.ico')
def spa_favicon():
    favicon = os.path.join(STATIC_DIR, 'favicon.svg')
    if os.path.isfile(favicon):
        return send_file(favicon, mimetype='image/svg+xml')
    abort(404)


# Serve vendored Monaco editor (self-hosted, offline) at /monaco/vs/...
@spa_bp.route('/monaco/vs/<path:filename>')
def spa_monaco_vs(filename):
    monaco_dir = os.path.join(_SPA_DIR, 'monaco', 'vs')
    file_path = os.path.join(monaco_dir, filename)
    if os.path.isfile(file_path):
        return send_from_directory(monaco_dir, filename)
    abort(404)
