// ============================================================
//  panel-frames.js — Background frame player for each panel
//  Each panel gets its own canvas that plays looping frames
//  from a dedicated folder. Falls back to a CSS gradient.
// ============================================================
'use strict';

const PANEL_FRAME_CONFIG = {
    'chemicals-panel':  { canvas: 'chem-frame-canvas',      folder: 'frames_chemicals',  frameCount: 192 },
    'delivery-panel':   { canvas: 'delivery-frame-canvas',   folder: 'frames_deliveries', frameCount: 192 },
    'dashboard-panel':  { canvas: 'dashboard-frame-canvas',  folder: 'frames_dashboard',  frameCount: 192 },
    'analytics-panel':  { canvas: 'analytics-frame-canvas',  folder: 'frames_analytics',  frameCount: 192 },
};

const _framePlayers = {};

// ---- Probe once if frames exist ----
async function probeFrames(folder) {
    try {
        const r = await fetch(`${folder}/frame_000_delay-0.041s.jpg`, { method: 'HEAD' });
        return r.ok;
    } catch { return false; }
}

// ---- Build & start a frame player on a canvas ----
function createFramePlayer(canvas, folder, frameCount) {
    const ctx = canvas.getContext('2d');
    let imgs = [];
    let loaded = 0;
    let currentIdx = 0;
    let rafId = null;
    let lastTs = 0;
    const FPS_INTERVAL = 1000 / 24; // 24 fps

    function resize() {
        canvas.width = window.innerWidth;
        canvas.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Preload frames (staggered to avoid bandwidth spike)
    for (let i = 0; i < frameCount; i++) {
        const img = new Image();
        img.src = `${folder}/frame_${String(i).padStart(3, '0')}_delay-0.041s.jpg`;
        img.onload = () => loaded++;
        img.onerror = () => loaded++;
        imgs.push(img);
    }

    function draw(idx) {
        const img = imgs[idx];
        if (!img || !img.complete || !img.naturalWidth) return;
        const cw = canvas.width, ch = canvas.height;
        // Cover-fit (like background-size: cover)
        const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
        const iw = img.naturalWidth * scale;
        const ih = img.naturalHeight * scale;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
    }

    function loop(ts) {
        rafId = requestAnimationFrame(loop);
        if (ts - lastTs < FPS_INTERVAL) return;
        lastTs = ts;
        if (loaded < 4) return; // wait for at least a few frames
        currentIdx = (currentIdx + 1) % frameCount;
        draw(currentIdx);
    }

    rafId = requestAnimationFrame(loop);

    return {
        stop() { cancelAnimationFrame(rafId); window.removeEventListener('resize', resize); },
        draw,
    };
}

// ---- Hook into panel open/close ----
(function waitForPanelSystem() {
    const ready = setInterval(() => {
        if (typeof openPanel === 'function' && typeof closePanel === 'function') {
            clearInterval(ready);
            patchPanelSystem();
        }
    }, 60);
})();

async function patchPanelSystem() {
    // Pre-probe all folders
    const hasFrames = {};
    await Promise.all(Object.entries(PANEL_FRAME_CONFIG).map(async ([panelId, cfg]) => {
        hasFrames[panelId] = await probeFrames(cfg.folder);
    }));

    const _origOpen = window.openPanel;
    const _origClose = window.closePanel;

    window.openPanel = function (id) {
        _origOpen(id);
        if (hasFrames[id] && !_framePlayers[id]) {
            const cfg = PANEL_FRAME_CONFIG[id];
            const canvas = document.getElementById(cfg.canvas);
            if (canvas) {
                _framePlayers[id] = createFramePlayer(canvas, cfg.folder, cfg.frameCount);
            }
        }
        // Trigger hero animation
        triggerPanelEntrance(id);
    };

    window.closePanel = function () {
        // Stop frame players to save resources
        Object.keys(_framePlayers).forEach(k => {
            _framePlayers[k].stop();
            delete _framePlayers[k];
        });
        _origClose();
    };
}

// ---- Staggered fade-in entrance for hero + cards ----
function triggerPanelEntrance(panelId) {
    const panel = document.getElementById(panelId);
    if (!panel) return;

    // Reset all animated children
    const hero = panel.querySelector('.panel-hero');
    const topbar = panel.querySelector('.panel-topbar');
    const cardsRegion = panel.querySelector('.panel-cards-region');
    const anBar = panel.querySelector('.an-center-bar');
    const anSugg = panel.querySelector('.analytics-suggestions');

    [hero, topbar, cardsRegion, anBar, anSugg].forEach(el => {
        if (el) {
            el.style.opacity = '0';
            el.style.transform = 'translateY(28px)';
            el.style.transition = 'none';
        }
    });

    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            const ease = 'cubic-bezier(0.4, 0, 0.2, 1)';
            if (topbar) {
                topbar.style.transition = `opacity 0.5s ${ease}, transform 0.5s ${ease}`;
                topbar.style.opacity = '1';
                topbar.style.transform = 'translateY(0)';
            }
            if (hero) {
                hero.style.transition = `opacity 0.65s 0.1s ${ease}, transform 0.65s 0.1s ${ease}`;
                hero.style.opacity = '1';
                hero.style.transform = 'translateY(0)';
            }
            if (anBar) {
                anBar.style.transition = `opacity 0.6s 0.2s ${ease}, transform 0.6s 0.2s ${ease}`;
                anBar.style.opacity = '1';
                anBar.style.transform = 'translateY(0)';
            }
            if (anSugg) {
                anSugg.style.transition = `opacity 0.6s 0.3s ${ease}, transform 0.6s 0.3s ${ease}`;
                anSugg.style.opacity = '1';
                anSugg.style.transform = 'translateY(0)';
            }
            if (cardsRegion) {
                cardsRegion.style.transition = `opacity 0.7s 0.35s ${ease}, transform 0.7s 0.35s ${ease}`;
                cardsRegion.style.opacity = '1';
                cardsRegion.style.transform = 'translateY(0)';
            }
        });
    });
}

// Export for external use
window.triggerPanelEntrance = triggerPanelEntrance;
