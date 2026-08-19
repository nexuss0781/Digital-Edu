# -*- mode: python ; coding: utf-8 -*-
"""
PyInstaller spec for DigitalEdu offline exe.

Build with:
    pyinstaller digiEdu.spec

Or use the helper script:
    build_exe.bat
"""
import os
import sys
from PyInstaller.utils.hooks import collect_data_files, collect_submodules

block_cipher = None
ROOT = os.path.abspath(SPECPATH)

# ---------------------------------------------------------------------------
# Data: everything Flask needs to serve
# ---------------------------------------------------------------------------
datas = []

# React SPA build output
spa_dir = os.path.join(ROOT, 'static', 'spa')
if os.path.isdir(spa_dir):
    datas.append((spa_dir, os.path.join('static', 'spa')))

# Static assets (favicon, CSS, fonts, images, vendor JS)
static_dir = os.path.join(ROOT, 'static')
for subdir in ('css', 'fonts', 'images', 'img', 'js', 'vendor'):
    p = os.path.join(static_dir, subdir)
    if os.path.isdir(p):
        datas.append((p, os.path.join('static', subdir)))
favicon = os.path.join(static_dir, 'favicon.svg')
if os.path.isfile(favicon):
    datas.append((favicon, 'static'))

# Jinja2 templates (fallback for legacy pages)
tpl_dir = os.path.join(ROOT, 'templates')
if os.path.isdir(tpl_dir):
    datas.append((tpl_dir, 'templates'))

# Course content (Markdown, PDFs, assets, YAML structure files)
courses_dir = os.path.join(ROOT, 'courses')
if os.path.isdir(courses_dir):
    datas.append((courses_dir, 'courses'))

# Workshop groups helper file
wg_path = os.path.join(ROOT, 'scripts', 'workshop_groups.json')
if os.path.isfile(wg_path):
    datas.append((wg_path, 'scripts'))

# .env file for SECRET_KEY etc.
env_path = os.path.join(ROOT, '.env')
if os.path.isfile(env_path):
    datas.append((env_path, '.'))

# ---------------------------------------------------------------------------
# Hidden imports: Flask extensions that use lazy / dynamic imports
# ---------------------------------------------------------------------------
hiddenimports = [
    'flask',
    'flask_sqlalchemy',
    'flask_login',
    'flask_session',
    'flask_migrate',
    'flask_cors',
    'sqlalchemy',
    'sqlalchemy.dialects.sqlite',
    'yaml',
    'markdown',
    'watchdog',
    'watchdog.observers',
    'watchdog.events',
    'dotenv',
]

# ---------------------------------------------------------------------------
# Analysis
# ---------------------------------------------------------------------------
a = Analysis(
    [os.path.join(ROOT, 'run_offline.py')],
    pathex=[ROOT],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        'gunicorn',
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
    ],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='DigitalEdu',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon=None,
)
