# -*- mode: python ; coding: utf-8 -*-
# chemtech-backend.spec — PyInstaller build spec for the Flask backend.
# Usage:  pyinstaller chemtech-backend.spec --noconfirm
#    or:  npm run dist:backend

block_cipher = None

a = Analysis(
    ['server_entry.py'],          # ← our thin wrapper; chatbot.py is imported
    pathex=['.'],
    binaries=[],
    datas=[
        # Bundle turso_compat.py alongside chatbot.py
        ('turso_compat.py',   '.'),
        # Bundle .env.example so users know what variables to set
        ('.env.example',      '.'),
    ],
    hiddenimports=[
        # Flask & ecosystem
        'flask',
        'flask.templating',
        'flask_cors',
        'werkzeug',
        'werkzeug.serving',
        'werkzeug.security',
        'werkzeug.exceptions',
        'werkzeug.routing',
        'werkzeug.middleware',
        'werkzeug.middleware.proxy_fix',
        'jinja2',
        'jinja2.ext',
        'markupsafe',
        'click',
        'itsdangerous',
        # HTTP
        'requests',
        'requests.adapters',
        'requests.auth',
        'requests.compat',
        'requests.cookies',
        'requests.exceptions',
        'urllib3',
        'urllib3.util',
        'urllib3.util.retry',
        'urllib3.util.ssl_',
        'certifi',
        'charset_normalizer',
        'idna',
        # Env / config
        'dotenv',
        'dotenv.main',
        # Turso / LibSQL
        'turso_python',
        # Standard lib helpers used in chatbot.py
        'json',
        're',
        'uuid',
        'random',
        'base64',
        'datetime',
    ],
    hookspath=[],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[
        # Exclude heavy / unused packages to keep exe small
        'tkinter',
        'matplotlib',
        'numpy',
        'pandas',
        'scipy',
        'PIL',
        'cv2',
        'PyQt5',
        'PyQt6',
        'wx',
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
    [],
    exclude_binaries=True,
    name='chemtech-backend',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    console=True,          # keep console visible so Flask logs are readable
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
)

coll = COLLECT(
    exe,
    a.binaries,
    a.zipfiles,
    a.datas,
    strip=False,
    upx=True,
    upx_exclude=[],
    name='chemtech-backend',   # output folder: dist/chemtech-backend/
)
