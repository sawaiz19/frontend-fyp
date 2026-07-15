'use strict';

const { app, BrowserWindow, dialog, shell, Menu, session } = require('electron');
const path   = require('path');
const http   = require('http');
const fs     = require('fs');
const { spawn, exec } = require('child_process');

// ─── Constants ──────────────────────────────────────────────────────────────
const FLASK_PORT  = 5000;   // chatbot.py runs here
const STATIC_PORT = 5500;   // replaces: python -m http.server 5500
const isDev       = !app.isPackaged;

/**
 * Bundle root in dev  → project root  (same as cwd when running `npm start`)
 * Bundle root in prod → the extraResources copy inside the packaged app
 */
const bundleRoot = isDev
  ? path.join(__dirname, '..')
  : path.join(process.resourcesPath, 'chemtech-bundle');

let mainWindow   = null;
let flaskProcess = null;
let staticServer = null;

/** Same-origin app (static + API) — allow in-app navigation / windows */
function isChemtechLocalUrl(url) {
  return (
    url.startsWith(`http://localhost:${STATIC_PORT}`) ||
    url.startsWith(`http://127.0.0.1:${STATIC_PORT}`) ||
    url.startsWith(`http://localhost:${FLASK_PORT}`) ||
    url.startsWith(`http://127.0.0.1:${FLASK_PORT}`)
  );
}

/**
 * Google Sign-In (GIS) uses window.open / popups. Sending those to the system
 * browser breaks the flow because the JWT must postMessage back to this app.
 * Allow in-app BrowserWindows for Google hosts (and about:blank popups).
 */
function isGoogleSignInPopupUrl(url) {
  if (!url || url === 'about:blank') return true;
  try {
    const { hostname } = new URL(url);
    return (
      hostname === 'accounts.google.com' ||
      hostname === 'accounts.youtube.com' ||
      hostname === 'apis.google.com' ||
      hostname === 'ogs.google.com' ||
      hostname === 'myaccount.google.com' ||
      hostname.endsWith('.googleusercontent.com')
    );
  } catch {
    return false;
  }
}

function popupOptionsForAuth(openerWindow) {
  return {
    parent            : openerWindow,
    modal             : false,
    width             : 520,
    height            : 680,
    autoHideMenuBar   : true,
    show              : true,
    backgroundColor   : '#ffffff',
    webPreferences    : {
      nodeIntegration : false,
      contextIsolation: true,
      webSecurity     : true,
    },
  };
}

/** Google popups must stay in-app; nested popups need the same policy on every BrowserWindow. */
function attachPopupAndExternalLinkPolicy(browserWindow) {
  browserWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (isChemtechLocalUrl(url)) {
      return { action: 'allow' };
    }
    if (isGoogleSignInPopupUrl(url)) {
      return {
        action: 'allow',
        overrideBrowserWindowOptions: popupOptionsForAuth(browserWindow),
      };
    }
    if (/^https?:\/\//i.test(url)) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });
}

let _popupPolicyRegistered = false;
function registerBrowserWindowPopupPolicy() {
  if (_popupPolicyRegistered) return;
  _popupPolicyRegistered = true;
  app.on('browser-window-created', (_event, win) => {
    attachPopupAndExternalLinkPolicy(win);
  });
}

// ─── MIME Types ─────────────────────────────────────────────────────────────
const MIME = {
  '.html'  : 'text/html; charset=utf-8',
  '.css'   : 'text/css',
  '.js'    : 'application/javascript',
  '.json'  : 'application/json',
  '.png'   : 'image/png',
  '.jpg'   : 'image/jpeg',
  '.jpeg'  : 'image/jpeg',
  '.gif'   : 'image/gif',
  '.svg'   : 'image/svg+xml',
  '.ico'   : 'image/x-icon',
  '.woff'  : 'font/woff',
  '.woff2' : 'font/woff2',
  '.ttf'   : 'font/ttf',
  '.webp'  : 'image/webp',
  '.mp4'   : 'video/mp4',
  '.webm'  : 'video/webm',
  '.txt'   : 'text/plain',
};

// ─── Static File Server (replaces `python -m http.server 5500`) ─────────────
function startStaticServer() {
  return new Promise((resolve, reject) => {
    staticServer = http.createServer((req, res) => {
      // Strip query string / hash
      let urlPath = (req.url || '/').split('?')[0].split('#')[0];
      if (urlPath === '/' || urlPath === '') urlPath = '/index.html';

      // Prevent directory traversal attacks
      const filePath = path.normalize(path.join(bundleRoot, urlPath));
      if (!filePath.startsWith(bundleRoot)) {
        res.writeHead(403); res.end('Forbidden'); return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          // Try index.html fallback for SPA-style routing
          const fallback = path.join(bundleRoot, 'index.html');
          if (fs.existsSync(fallback)) {
            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
            fs.createReadStream(fallback).pipe(res);
          } else {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not Found');
          }
          return;
        }

        const ext  = path.extname(filePath).toLowerCase();
        const mime = MIME[ext] || 'application/octet-stream';
        res.writeHead(200, {
          'Content-Type'  : mime,
          'Cache-Control' : 'no-cache',
        });
        fs.createReadStream(filePath).pipe(res);
      });
    });

    staticServer.listen(STATIC_PORT, '127.0.0.1', () => {
      console.log(`[Static] Serving "${bundleRoot}" → http://localhost:${STATIC_PORT}`);
      resolve();
    });

    staticServer.on('error', (err) => {
      if (err.code === 'EADDRINUSE') {
        // Port already in use — assume another instance is serving; continue.
        console.warn(`[Static] Port ${STATIC_PORT} already in use — skipping`);
        resolve();
      } else {
        reject(err);
      }
    });
  });
}

// ─── Flask Backend (replaces `python chatbot.py`) ───────────────────────────
function startFlask() {
  const env = {
    ...process.env,
    PYTHONUNBUFFERED     : '1', // ensure stdout/stderr are not buffered
    CHEMTECH_NO_RELOADER : '1', // chatbot.py: no Werkzeug reloader (clean shutdown under Electron)
  };

  let cmd, args;

  if (isDev) {
    // Development: run `python chatbot.py` from the project root (same as manual workflow)
    cmd  = 'python';
    args = [path.join(bundleRoot, 'chatbot.py')];
  } else {
    // Production: PyInstaller one-folder build (npm run dist:backend)
    cmd = path.join(bundleRoot, 'dist', 'chemtech-backend', 'chemtech-backend.exe');
    args = [];
    if (!fs.existsSync(cmd)) {
      throw new Error(
        `Backend executable not found.\n\nExpected:\n${cmd}\n\n` +
          'From the project root run: npm run dist:backend\n' +
          'Then rebuild the installer: npm run dist'
      );
    }
  }

  console.log(`[Flask] Starting: ${cmd} ${args.join(' ')}`);
  flaskProcess = spawn(cmd, args, { cwd: bundleRoot, env });

  flaskProcess.stdout.on('data', d => process.stdout.write(`[Flask] ${d}`));
  flaskProcess.stderr.on('data', d => process.stderr.write(`[Flask] ${d}`));

  flaskProcess.on('error', (err) => {
    console.error('[Flask] Spawn error:', err.message);
    const hint = isDev
      ? 'Install Python on PATH and run: pip install -r requirements.txt'
      : 'Reinstall the app or rebuild the backend (npm run dist:backend).';
    dialog.showErrorBox(
      'ChemTech — Backend Error',
      `Could not start the Flask backend.\n\n${err.message}\n\n${hint}`
    );
  });

  flaskProcess.on('exit', (code, signal) => {
    console.log(`[Flask] Exited  code=${code}  signal=${signal}`);
    flaskProcess = null;
  });
}

// ─── Wait for Flask to accept connections ────────────────────────────────────
function waitForFlask(retries = 40, intervalMs = 500) {
  return new Promise((resolve) => {
    let attempts = 0;

    function tryConnect() {
      const req = http.get(`http://localhost:${FLASK_PORT}/`, (res) => {
        res.resume();   // drain the response so the socket closes cleanly
        console.log('[Flask] Ready ✓');
        resolve(true);
      });

      req.setTimeout(400, () => req.destroy());

      req.on('error', () => {
        attempts++;
        if (attempts < retries) {
          setTimeout(tryConnect, intervalMs);
        } else {
          console.warn('[Flask] Did not respond within timeout — opening window anyway');
          resolve(false);
        }
      });
    }

    tryConnect();
  });
}

// ─── BrowserWindow ───────────────────────────────────────────────────────────
function createWindow() {
  const iconPath = path.join(bundleRoot, 'logo', 'logo.png');

  mainWindow = new BrowserWindow({
    width           : 1440,
    height          : 900,
    minWidth        : 1024,
    minHeight       : 700,
    title           : 'ChemTech',
    icon            : fs.existsSync(iconPath) ? iconPath : undefined,
    backgroundColor : '#0a0a0a',   // prevents white flash before page loads
    show            : false,       // show only when content is ready
    webPreferences  : {
      nodeIntegration : false,
      contextIsolation: true,
      preload         : path.join(__dirname, 'preload.js'),
      webSecurity     : true,
    },
  });

  // Remove the default application menu (looks cleaner for a desktop app)
  if (!isDev) Menu.setApplicationMenu(null);

  // Load the frontend — exactly as opening http://localhost:5500 in a browser
  mainWindow.loadURL(`http://localhost:${STATIC_PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    // Open DevTools in development so you can inspect/debug
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
  });

  mainWindow.on('closed', () => { mainWindow = null; });
}

// ─── App Lifecycle ────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  try {
    registerBrowserWindowPopupPolicy();

    // FedCM / cross-site cookie flows used by Google Identity may prompt for storage access.
    // Geolocation: ChemTech "Use my GPS & route" uses navigator.geolocation on http://localhost:5500.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
      const ok = new Set([
        'geolocation',
        'storage-access',
        'top-level-storage-access',
        'clipboard-read',
        'clipboard-sanitized-write',
        'notifications',
        'fullscreen',
      ]);
      callback(ok.has(permission));
    });

    session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
      if (permission === 'geolocation') {
        try {
          const { hostname } = new URL(requestingOrigin || '');
          return (
            hostname === 'localhost' ||
            hostname === '127.0.0.1' ||
            hostname === '[::1]'
          );
        } catch {
          return false;
        }
      }
      return true;
    });

    await startStaticServer();
    startFlask();
    await waitForFlask();
    createWindow();
  } catch (err) {
    console.error('Startup error:', err);
    dialog.showErrorBox('ChemTech — Startup Error', `Failed to start:\n\n${err.message}`);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  // On macOS apps stay in the dock until explicitly quit — standard behaviour
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// ─── Cleanup ──────────────────────────────────────────────────────────────────
function cleanup() {
  if (staticServer) {
    staticServer.close();
    staticServer = null;
  }

  if (flaskProcess) {
    // On Windows: `taskkill /t` also kills children (Werkzeug reloader subprocess)
    if (process.platform === 'win32') {
      exec(`taskkill /pid ${flaskProcess.pid} /f /t`, (err) => {
        if (err) { try { flaskProcess.kill('SIGKILL'); } catch (_) {} }
      });
    } else {
      try { process.kill(-flaskProcess.pid, 'SIGKILL'); } catch (_) {
        try { flaskProcess.kill('SIGKILL'); } catch (__) {}
      }
    }
    flaskProcess = null;
  }
}

app.on('before-quit', cleanup);
// Safety net — should not normally be needed
process.on('exit', cleanup);
