import os
from app import create_app

app = create_app()

if __name__ == '__main__':
    extra = []
    static_dir = os.path.join(os.path.dirname(__file__), 'static')
    if os.path.isdir(static_dir):
        for root, _, files in os.walk(static_dir):
            for f in files:
                extra.append(os.path.join(root, f))
    app.run(debug=True, extra_files=extra)
