import os
from flask import Blueprint, send_from_directory, send_file, abort

spa_bp = Blueprint('spa', __name__)

_SPA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), 'static', 'spa')


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


# Serve vendored Monaco editor (self-hosted, offline) at /monaco/vs/...
@spa_bp.route('/monaco/vs/<path:filename>')
def spa_monaco_vs(filename):
    monaco_dir = os.path.join(_SPA_DIR, 'monaco', 'vs')
    file_path = os.path.join(monaco_dir, filename)
    if os.path.isfile(file_path):
        return send_from_directory(monaco_dir, filename)
    abort(404)
