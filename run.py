import os
import sys
from app import create_app
from monitor_structure import scan_courses, save_tree, start_watching


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


app = create_app()

if __name__ == '__main__':
    courses_dir = app.config['COURSES_DIR']

    _initial_scan(courses_dir)
    observer = start_watching(courses_dir)

    extra = []
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    if os.path.isdir(static_dir):
        for root, _, files in os.walk(static_dir):
            for f in files:
                extra.append(os.path.join(root, f))

    print('[startup] Starting Flask app...')
    port = int(os.environ.get('FLASK_PORT', os.environ.get('PORT', '5199')))
    try:
        app.run(debug=True, port=port, extra_files=extra)
    finally:
        observer.stop()
        observer.join()
