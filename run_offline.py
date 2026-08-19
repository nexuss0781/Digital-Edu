"""Offline/Windows launcher for DigitalEdu.

Self-contained entrypoint used by start.bat and DigitalEdu.exe. It:
  * creates the app (schema is created from code if missing),
  * snapshots the database to the backup dir before serving,
  * opens the default browser (when running as a frozen .exe),
  * runs a non-debug server bound to 127.0.0.1 so no internet is required.
"""
import os
import sys
import time
import shutil
import subprocess
import threading
import webbrowser
from paths import FROZEN, APP_DIR
from app import create_app
from monitor_structure import scan_courses, save_tree
from config import Config

HOST = '127.0.0.1'
PORT = int(os.environ.get('FLASK_PORT', os.environ.get('PORT', '5199')))


def _port_pids(port):
    """Return the PIDs of processes listening on the given TCP port."""
    pids = []
    if os.name == 'nt':
        try:
            out = subprocess.check_output(['netstat', '-ano'], stderr=subprocess.DEVNULL)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            return pids
        for line in out.decode('utf-8', 'replace').splitlines():
            parts = line.split()
            if len(parts) >= 5 and parts[1].endswith(':%d' % port) and parts[3] == 'LISTENING':
                try:
                    pids.append(int(parts[4]))
                except ValueError:
                    pass
        return pids
    for cmd in (['lsof', '-ti', 'tcp:%d' % port], ['fuser', '%d/tcp' % port]):
        try:
            out = subprocess.check_output(cmd, stderr=subprocess.DEVNULL)
        except (subprocess.CalledProcessError, FileNotFoundError, OSError):
            continue
        for token in out.decode('utf-8', 'replace').split():
            if token.isdigit():
                pids.append(int(token))
        if pids:
            break
    return pids


def _is_our_app_on_windows(pid):
    """On Windows only stop python processes, never unrelated programs."""
    try:
        out = subprocess.check_output(
            ['tasklist', '/FI', 'PID eq %d' % pid, '/FO', 'CSV', '/NH'],
            stderr=subprocess.DEVNULL,
        )
        name = out.decode('utf-8', 'replace').split(',')[0].strip('"').lower()
        return 'python' in name or name.startswith('py')
    except Exception:
        return True


def free_port(port):
    """Kill leftover DigitalEdu instances holding the port so we can bind it."""
    pids = _port_pids(port)
    if not pids:
        print(f'[port] Port {port} is free')
        return
    for pid in pids:
        if os.name == 'nt' and not _is_our_app_on_windows(pid):
            print(f'[port] Port {port} is held by PID {pid} (not Python); leaving it alone.')
            continue
        print(f'[port] Port {port} is held by PID {pid} - stopping it...')
        try:
            if os.name == 'nt':
                subprocess.run(['taskkill', '/F', '/PID', str(pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                subprocess.run(['kill', str(pid)],
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        except OSError:
            pass
    time.sleep(1)
    if _port_pids(port):
        print(f'[port] Warning: could not free port {port} automatically.')
    else:
        print(f'[port] Port {port} is now free')


def _initial_scan(courses_dir):
    if not os.path.isdir(courses_dir):
        return
    struct_path = os.path.join(courses_dir, 'course_structure.yaml')
    needs_scan = not os.path.exists(struct_path)
    if not needs_scan:
        try:
            import yaml
            with open(struct_path, 'r') as f:
                data = yaml.safe_load(f)
            needs_scan = not isinstance(data, list) or len(data) == 0
        except Exception:
            needs_scan = True
    if needs_scan:
        print('[startup] Scanning course structure...')
        tree = scan_courses(courses_dir)
        save_tree(tree, courses_dir)
        print(f'[startup] Found {len(tree)} top-level items')
    else:
        print('[startup] Course structure already cached')


def _backup_db():
    """Copy the live database to the backup dir, keeping the last 30 copies."""
    db_path = os.path.join(Config.BASE_DIR, 'digital-edu.db')
    if not os.path.isfile(db_path):
        return
    ts = time.strftime('%Y%m%d-%H%M%S')
    dest = os.path.join(Config.BACKUP_DIR, f'digital-edu-{ts}.db')
    try:
        shutil.copy2(db_path, dest)
        print(f'[backup] Saved database snapshot -> {dest}')
    except OSError as e:
        print(f'[backup] Could not create snapshot: {e}')
    try:
        backups = sorted(
            f for f in os.listdir(Config.BACKUP_DIR)
            if f.startswith('digital-edu-') and f.endswith('.db')
        )
        for old in backups[:-30]:
            os.remove(os.path.join(Config.BACKUP_DIR, old))
    except OSError:
        pass


def _open_browser():
    """Wait for the server to start, then open the default browser."""
    url = f'http://{HOST}:{PORT}/'
    for _ in range(90):
        try:
            import socket
            with socket.create_connection((HOST, PORT), timeout=1):
                break
        except OSError:
            time.sleep(1)
    else:
        print(f'[browser] Could not detect server on port {PORT}; opening anyway.')
    print(f'[browser] Opening {url}')
    webbrowser.open(url)


if __name__ == '__main__':
    os.environ['DISABLE_COURSE_WATCHER'] = os.environ.get('DISABLE_COURSE_WATCHER', '1')
    app = create_app()
    _initial_scan(app.config['COURSES_DIR'])
    _backup_db()

    mode = 'exe' if FROZEN else 'source'
    print(f'[startup] Mode       : {mode} ({APP_DIR})')
    print(f'[startup] Data dir   : {Config.BASE_DIR}')
    print(f'[startup] Backup dir : {Config.BACKUP_DIR}')
    print(f'[startup] Courses dir: {app.config["COURSES_DIR"]}')
    print(f'[startup] Starting DigitalEdu on http://{HOST}:{PORT}/')
    free_port(PORT)

    if FROZEN:
        browser_thread = threading.Thread(target=_open_browser, daemon=True)
        browser_thread.start()

    try:
        app.run(host=HOST, port=PORT, debug=False, use_reloader=False)
    except KeyboardInterrupt:
        print('\n[shutdown] Goodbye.')
        sys.exit(0)
