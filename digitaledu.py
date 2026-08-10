import os
from app import create_app
from monitor_structure import scan_courses, save_tree

application = create_app()


def _initial_scan():
    courses_dir = application.config['COURSES_DIR']
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


_initial_scan()
