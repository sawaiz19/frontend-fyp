"""
server_entry.py — PyInstaller entry point for the ChemTech backend.

This file is used ONLY by PyInstaller (chemtech-backend.spec).
It imports the Flask app from chatbot.py and runs it without the Werkzeug
reloader, which does not work inside a frozen executable.

chatbot.py itself is NOT modified.
"""
import sys
import os

# ── Working-directory fix for PyInstaller ────────────────────────────────────
# When PyInstaller bundles an app, sys.executable points to the .exe.
# We chdir to its directory so that python-dotenv finds .env and the
# database files (users.db / db.sqlite) are written next to the exe.
if getattr(sys, 'frozen', False):
    _exe_dir = os.path.dirname(sys.executable)
    os.chdir(_exe_dir)

# ── Import the Flask app (runs module-level code: load_dotenv, init_db) ──────
from chatbot import app  # noqa: E402

# ── Start the server ─────────────────────────────────────────────────────────
if __name__ == '__main__':
    app.run(
        host        = '127.0.0.1',
        port        = 5000,
        debug       = False,       # must be False in a frozen exe
        use_reloader= False,       # reloader cannot work in a frozen exe
        threaded    = True,        # handle concurrent requests
    )
