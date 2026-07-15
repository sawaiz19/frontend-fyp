// ============================================================
//  ChemTech — main.js  v5 (Auth Overhaul + frames4 + Crossfade)
// ============================================================

const FRAME_COUNT_1 = 192, FRAME_COUNT_2 = 186, FRAME_COUNT_3 = 192, FRAME_COUNT_5 = 192;
const FRAME_COUNT_6 = 180, FRAME_COUNT_7 = 192, FRAME_COUNT_8 = 192, FRAME_COUNT_9 = 192;
const FRAME_COUNT_OVERALL = 192, FRAME_COUNT_PUNJAB = 192, FRAME_COUNT_KPK = 154, FRAME_COUNT_SINDH = 192, FRAME_COUNT_BALOCH = 192;
const LOOP_START = 182, TARGET_FPS = 25, FRAME_INTERVAL = 1000 / 25;
const images1 = [], images2 = [], images3 = [], images5 = [];
const images6 = [], images7 = [], images8 = [], images9 = [];
const imagesOverall = [], imagesPunjab = [], imagesKPK = [], imagesSindh = [], imagesBaloch = [];
const BASE_PATH_1 = 'frames1/frame_', BASE_PATH_2 = 'frames2/frame_', BASE_PATH_3 = 'frames3/frame_';
const BASE_PATH_5 = 'frames_dashboard/frame_', BASE_PATH_6 = 'signout/frame_';
const BASE_PATH_7 = 'frames_chemicals/frame_', BASE_PATH_8 = 'frames_analytics/frame_', BASE_PATH_9 = 'frames_deliveries/frame_';

/** Flask API (chatbot.py). Relative /api/* only works when the page is served by Flask; otherwise use this base. */
const AUTH_API = (typeof window !== 'undefined' && window.CHEMTECH_API) || 'http://localhost:5000';

// DOM
const heroCanvas = document.getElementById('hero-canvas');
const hCtx = heroCanvas.getContext('2d');
const fxCanvas = document.getElementById('fx-canvas');
const fCtx = fxCanvas.getContext('2d');
const loaderEl = document.getElementById('loader');
const loadPctEl = document.getElementById('load-pct');
const panelEl = document.getElementById('panel');
const cursorEl = document.getElementById('cursor');
const cursorRing = document.getElementById('cursor-ring');
const liveTimeEl = document.getElementById('live-time');
const formulaEl = document.getElementById('formula');
const hudFrame = document.getElementById('hud-frame');
const hudCoords = document.getElementById('hud-coords');
const aiBtn = document.getElementById('ai-btn');
const aiInterface = document.getElementById('ai-interface');
const aiBackBtn = document.getElementById('ai-back-btn');
const logoutBtn = document.getElementById('logout-btn');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatHistory = document.getElementById('chat-history');
const voiceBtn = document.getElementById('voice-btn');
const stopAudioBtn = document.getElementById('stop-audio');
const adminPanelBtn = document.getElementById('admin-panel-btn');
const adminModal = document.getElementById('admin-modal');
const adminModalClose = document.getElementById('admin-modal-close');
const adminModalOverlay = document.getElementById('admin-modal-overlay');
const pendingListEl = document.getElementById('pending-list');
const adminsListEl = document.getElementById('admins-list');
const pendingCountEl = document.getElementById('pending-count');
const toastContainer = document.getElementById('toast-container');
const pendingUserListEl = document.getElementById('pending-user-list');
const pendingUserCountEl = document.getElementById('pending-user-count');
const allUsersListEl = document.getElementById('all-users-list');
const pendingScreen = document.getElementById('pending-screen');
const pendingBackBtn = document.getElementById('pending-back-btn');
const loginScreen = document.getElementById('login-screen');

const PANEL_W_CSS = 380;
const STATE_LOGIN = -1, STATE_HOME = 0, STATE_TRANS_IN = 1, STATE_AI_SCROLL = 2;
const STATE_TRANS_OUT = 3, STATE_INTRO_PLAY = 4, STATE_INTRO_REVERSE = 5, STATE_HOME_REVERSE = 6;
const STATE_DASHBOARD_IN = 10, STATE_DASHBOARD_OUT = 11;
const STATE_REGION_SELECT = 12, STATE_REGION_IN = 13, STATE_REGION_OPEN = 14, STATE_REGION_OUT = 15;
const STATE_SIGNOUT = 16;
const STATE_CHEM_IN = 17, STATE_CHEM_OUT = 18;
const STATE_ANALYTICS_IN = 19, STATE_ANALYTICS_OUT = 20;
const STATE_DELIVERIES_IN = 21, STATE_DELIVERIES_OUT = 22;

let appState = STATE_LOGIN;
let _regionImages = null, _regionFrameCount = 192, _selectedRegion = 'all';
let loaded1 = 0, loaded2 = 0, loaded3 = 0, loaded4 = 0;
let ready = false, frameIdx = 0;
let lastFTs = performance.now();
let mouse = { x: innerWidth * 0.7, y: innerHeight / 2 };
let parallax = { x: 0, y: 0 };
let ringPos = { x: innerWidth * 0.7, y: innerHeight / 2 };
let targetCenterFactor = 1, currentCenterFactor = 1;
let currentUser = null;
let pollInterval = null, lastPendingCount = 0, isFirstPoll = true;

// ---- Animation Skip Button ----
(function () {
    const skipBtn = document.createElement('button');
    skipBtn.id = 'skip-anim-btn';
    skipBtn.innerHTML = 'SKIP&nbsp;<span>&#x276F;</span>';
    document.body.appendChild(skipBtn);

    // Kept as no-op stub so any missed calls don't error
    window._showTransitionOverlay = function () {};

    const IN_STATES  = [STATE_AI_SCROLL, STATE_DASHBOARD_IN, STATE_CHEM_IN, STATE_ANALYTICS_IN, STATE_DELIVERIES_IN, STATE_REGION_IN];
    const OUT_STATES = [STATE_TRANS_OUT, STATE_DASHBOARD_OUT, STATE_CHEM_OUT, STATE_ANALYTICS_OUT, STATE_DELIVERIES_OUT, STATE_REGION_OUT];

    setInterval(() => {
        const inAnim  = IN_STATES.includes(appState)  || OUT_STATES.includes(appState);
        // Has the animation actually finished? Each IN state has a known last frame.
        let animDone = false;
        if      (appState === STATE_AI_SCROLL)    animDone = frameIdx >= FRAME_COUNT_2 - 1;
        else if (appState === STATE_DASHBOARD_IN) animDone = frameIdx >= FRAME_COUNT_5 - 1;
        else if (appState === STATE_CHEM_IN)      animDone = frameIdx >= FRAME_COUNT_7 - 1;
        else if (appState === STATE_ANALYTICS_IN) animDone = frameIdx >= FRAME_COUNT_8 - 1;
        else if (appState === STATE_DELIVERIES_IN)animDone = frameIdx >= FRAME_COUNT_9 - 1;
        else if (appState === STATE_REGION_IN)    animDone = frameIdx >= _regionFrameCount - 1;
        // OUT states resolve themselves back to STATE_HOME (no longer in OUT_STATES), so no extra check needed.
        skipBtn.classList.toggle('skip-visible', inAnim && !animDone);
    }, 80);


    skipBtn.addEventListener('click', () => {
        if (IN_STATES.includes(appState)) {
            if (appState === STATE_AI_SCROLL) {
                frameIdx = FRAME_COUNT_2 - 1;
                aiInterface.classList.remove('hidden');
                aiInterface.classList.add('visible');
            } else if (appState === STATE_DASHBOARD_IN) {
                frameIdx = FRAME_COUNT_5 - 1;
                window.showFullPanelCinematic('dashboard-panel');
            } else if (appState === STATE_CHEM_IN) {
                frameIdx = FRAME_COUNT_7 - 1;
                window.showFullPanelCinematic('chemicals-panel');
            } else if (appState === STATE_ANALYTICS_IN) {
                frameIdx = FRAME_COUNT_8 - 1;
                window.showFullPanelCinematic('analytics-panel', () => {
                    if (window.initAnalyticsPanel) window.initAnalyticsPanel();
                });
            } else if (appState === STATE_DELIVERIES_IN) {
                frameIdx = FRAME_COUNT_9 - 1;
                window.showFullPanelCinematic('delivery-panel', () => {
                    if (window.loadDeliveries) window.loadDeliveries();
                });
            } else if (appState === STATE_REGION_IN) {
                frameIdx = _regionFrameCount - 1;
                appState = STATE_REGION_OPEN;
                window.showFullPanelCinematic('dashboard-panel', () => {
                    if (window.loadDashboard) window.loadDashboard(_selectedRegion);
                });
            }
        } else if (OUT_STATES.includes(appState)) {
            if (appState === STATE_TRANS_OUT) {
                aiInterface.classList.add('hidden');
                aiInterface.classList.remove('visible');
            } else {
                ['chemicals-panel', 'delivery-panel', 'dashboard-panel', 'analytics-panel']
                    .forEach(id => { const el = document.getElementById(id); if (el) el.classList.remove('visible'); });
                const wc = document.getElementById('webgl-canvas');
                if (wc) wc.classList.remove('active');
                window.activePanel = null;
            }
            frameIdx = LOOP_START;
            appState = STATE_HOME;
            targetCenterFactor = 1;
            panelEl.classList.remove('offscreen');
        }
    });
})();

// ---- Login Tab Switching ----
document.querySelectorAll('.login-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.login-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('#login-screen .login-tab-content').forEach(c => c.classList.remove('active'));
        const target = tab.dataset.tab === 'google' ? 'login-google-tab' : 'login-manual-tab';
        document.getElementById(target).classList.add('active');

        if (tab.dataset.tab === 'manual') {
            setTimeout(() => document.getElementById('login-username').focus(), 50);
        }
    });
});

// ---- Role Selector ----
let selectedRole = 'user';
document.querySelectorAll('.role-pill').forEach(pill => {
    pill.addEventListener('click', () => {
        document.querySelectorAll('.role-pill').forEach(p => p.classList.remove('active'));
        pill.classList.add('active');
        selectedRole = pill.dataset.role;
        const hint = document.getElementById('role-hint');
        if (hint) {
            if (selectedRole === 'admin') hint.textContent = 'Request admin access after sign-in';
            else if (selectedRole === 'regional_admin') hint.textContent = 'Regional Admin — awaits admin approval';
            else hint.textContent = 'Sign in as a standard user';
        }
    });
});

const CHEMTECH_LLM_KEY = 'chemtech_llm_provider';
function getLlmProvider() {
    try {
        return (localStorage.getItem(CHEMTECH_LLM_KEY) || 'groq').toLowerCase() === 'local' ? 'local' : 'groq';
    } catch (_) {
        return 'groq';
    }
}
function setLlmProvider(mode) {
    try {
        localStorage.setItem(CHEMTECH_LLM_KEY, mode === 'local' ? 'local' : 'groq');
    } catch (_) { /* ignore */ }
    syncLlmHomepageUi();
}
function syncLlmHomepageUi() {
    const mode = getLlmProvider();
    const groqPill = document.getElementById('llm-pill-groq');
    const localPill = document.getElementById('llm-pill-local');
    const hint = document.getElementById('llm-selector-hint');
    if (groqPill && localPill) {
        groqPill.classList.toggle('active', mode === 'groq');
        localPill.classList.toggle('active', mode === 'local');
    }
    if (hint) {
        hint.textContent = mode === 'local'
            ? 'Uses local Ollama only. Keep Ollama running (same model as OLLAMA_MODEL on the server).'
            : 'Cloud when available; automatically uses Ollama if the Groq API fails.';
    }
}
// Track last known show-state to avoid spamming class changes every animation frame
let _llmWasVisible = false;

function updateHomepageLlmFloatingVisibility() {
    const el = document.getElementById('llm-floating-toggle');
    if (!el) return;
    const loggedIn = !!(window._currentUser || currentUser);
    const onHomeHero = appState === STATE_HOME;
    const shouldShow = loggedIn && onHomeHero;

    if (shouldShow && !_llmWasVisible) {
        // Drop-in: reset any exit state, then play enter animation
        el.classList.remove('llm-exiting', 'llm-visible');
        void el.offsetWidth; // force reflow so animation restarts cleanly
        el.classList.add('llm-entering');
        // After animation completes, settle into the stable visible state
        const dur = 550 + 180; // animation duration + delay (ms)
        clearTimeout(el._llmEnterTimer);
        el._llmEnterTimer = setTimeout(() => {
            el.classList.remove('llm-entering');
            el.classList.add('llm-visible');
        }, dur);
        _llmWasVisible = true;
    } else if (!shouldShow && _llmWasVisible) {
        // Only animate out if not already exiting
        if (!el.classList.contains('llm-exiting')) {
            _hideLlmToggleNow(el);
        }
        _llmWasVisible = false;
    }
}

/** Immediately plays the exit animation (no delay). */
function _hideLlmToggleNow(el) {
    if (!el) el = document.getElementById('llm-floating-toggle');
    if (!el) return;
    clearTimeout(el._llmEnterTimer);
    el.classList.remove('llm-entering', 'llm-visible');
    void el.offsetWidth;
    el.classList.add('llm-exiting');
    setTimeout(() => {
        el.classList.remove('llm-exiting');
    }, 350);
}

/** Call this before any page-navigation trigger to animate the widget out first. */
function hideLlmToggleAnimated() {
    if (!_llmWasVisible) return;
    _llmWasVisible = false;
    _hideLlmToggleNow();
}
(function bindLlmFloatingPills() {
    const host = document.getElementById('llm-floating-toggle');
    if (!host) return;
    host.querySelectorAll('.llm-pill').forEach(pill => {
        pill.addEventListener('click', () => {
            host.querySelectorAll('.llm-pill').forEach(p => p.classList.remove('active'));
            pill.classList.add('active');
            setLlmProvider(pill.dataset.llm);
        });
    });
})();
syncLlmHomepageUi();
window.getLlmProvider = getLlmProvider;

// ---- User Groq API Key Management ----
async function loadUserGroqKeyStatus() {
    const u = window._currentUser || currentUser;
    if (!u || !u.user_id) return;
    try {
        const res = await fetch(AUTH_API + '/api/user/groq-key/get', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caller_id: u.user_id })
        });
        const data = await res.json();
        if (!data.success) return;
        const toggle = document.getElementById('use-own-key-toggle');
        const input = document.getElementById('user-groq-key-input');
        const status = document.getElementById('api-key-status');
        const deleteBtn = document.getElementById('delete-groq-key-btn');
        if (toggle) toggle.checked = data.use_own_key;
        if (data.has_key) {
            if (input) { input.value = ''; input.placeholder = data.masked_key || 'Key saved'; }
            if (status) {
                status.textContent = data.use_own_key ? '✓ Using your key' : 'Key saved (inactive)';
                status.className = 'api-key-status ' + (data.use_own_key ? 'active' : 'saved');
            }
            if (deleteBtn) deleteBtn.classList.remove('hidden');
        } else {
            if (input) { input.value = ''; input.placeholder = 'gsk_...'; }
            if (status) { status.textContent = ''; status.className = 'api-key-status'; }
            if (toggle) toggle.checked = false;
            if (deleteBtn) deleteBtn.classList.add('hidden');
        }
    } catch (e) {
        console.warn('[UserGroqKey] load error:', e);
    }
}

async function saveUserGroqKey() {
    const u = window._currentUser || currentUser;
    if (!u || !u.user_id) { showToast('Not logged in.', 'error'); return; }
    const input = document.getElementById('user-groq-key-input');
    const key = (input ? input.value : '').trim();
    if (!key) { showToast('Enter your Groq API key.', 'error'); return; }
    try {
        const res = await fetch(AUTH_API + '/api/user/groq-key', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caller_id: u.user_id, groq_api_key: key })
        });
        const data = await res.json();
        if (data.success) {
            showToast('✓ API key saved.', 'success');
            loadUserGroqKeyStatus();
        } else {
            showToast(data.error || 'Failed to save.', 'error');
        }
    } catch (e) {
        showToast('Network error saving key.', 'error');
    }
}

async function toggleUserGroqKey(enabled) {
    const u = window._currentUser || currentUser;
    if (!u || !u.user_id) return;
    try {
        const res = await fetch(AUTH_API + '/api/user/groq-key/toggle', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caller_id: u.user_id, enabled })
        });
        const data = await res.json();
        if (data.success) {
            showToast(enabled ? '✓ Using your personal API key.' : 'Switched to system API key.', 'success');
            loadUserGroqKeyStatus();
        } else {
            showToast(data.error || 'Toggle failed.', 'error');
            const toggle = document.getElementById('use-own-key-toggle');
            if (toggle) toggle.checked = !enabled;
        }
    } catch (e) {
        showToast('Network error.', 'error');
        const toggle = document.getElementById('use-own-key-toggle');
        if (toggle) toggle.checked = !enabled;
    }
}

async function deleteUserGroqKey() {
    const u = window._currentUser || currentUser;
    if (!u || !u.user_id) return;
    try {
        const res = await fetch(AUTH_API + '/api/user/groq-key/delete', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ caller_id: u.user_id })
        });
        const data = await res.json();
        if (data.success) {
            showToast('API key removed.', 'success');
            loadUserGroqKeyStatus();
        } else {
            showToast(data.error || 'Delete failed.', 'error');
        }
    } catch (e) {
        showToast('Network error.', 'error');
    }
}

// Wire up user API key UI events
(function bindUserApiKeyUI() {
    const saveBtn = document.getElementById('save-groq-key-btn');
    const deleteBtn = document.getElementById('delete-groq-key-btn');
    const toggle = document.getElementById('use-own-key-toggle');
    if (saveBtn) saveBtn.addEventListener('click', saveUserGroqKey);
    if (deleteBtn) deleteBtn.addEventListener('click', deleteUserGroqKey);
    if (toggle) toggle.addEventListener('change', () => toggleUserGroqKey(toggle.checked));
})();

// ---- Admin Tab Switching ----
document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => {
        document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        document.querySelectorAll('.admin-tab-content').forEach(c => c.classList.remove('active'));
        document.getElementById(tab.dataset.tab).classList.add('active');
    });
});

// ---- Panel Transition Helpers (Web Animations API) ----
function _animatePanelIn(panel) {
    const SPRING = 'cubic-bezier(0.16, 1, 0.3, 1)';
    const header  = panel.querySelector('.fp-header');
    const content = panel.querySelector('.fp-content');

    // Header: drops in from slightly above with blur clearing
    if (header) {
        header.animate(
            [
                { opacity: '0', transform: 'translateY(-28px)', filter: 'blur(8px)' },
                { opacity: '1', transform: 'translateY(0)',      filter: 'blur(0px)' }
            ],
            { duration: 520, delay: 80, easing: SPRING, fill: 'both' }
        );
    }

    // Content: springs up from below with blur clearing
    if (content) {
        content.animate(
            [
                { opacity: '0', transform: 'translateY(40px) scale(0.97)', filter: 'blur(8px)' },
                { opacity: '1', transform: 'translateY(0)    scale(1)',    filter: 'blur(0px)' }
            ],
            { duration: 620, delay: 160, easing: SPRING, fill: 'both' }
        );

        // Stagger every direct card/section child
        const cards = content.querySelectorAll(
            '.chem-card, .delivery-card, .dash-card, .dash-section'
        );
        cards.forEach((el, i) => {
            el.animate(
                [
                    { opacity: '0', transform: 'translateY(30px) scale(0.95)' },
                    { opacity: '1', transform: 'translateY(0)    scale(1)'    }
                ],
                { duration: 500, delay: 240 + i * 60, easing: SPRING, fill: 'both' }
            );
        });
    }
}

function _animatePanelOut(panel, onDone) {
    const SHARP = 'cubic-bezier(0.55, 0, 1, 0.45)';
    const header  = panel.querySelector('.fp-header');
    const content = panel.querySelector('.fp-content');

    // Header exits upward
    if (header) {
        header.animate(
            [
                { opacity: '1', transform: 'translateY(0)',      filter: 'blur(0px)' },
                { opacity: '0', transform: 'translateY(-20px)',   filter: 'blur(6px)' }
            ],
            { duration: 240, easing: SHARP, fill: 'both' }
        );
    }

    // Content exits downward, slightly after header
    if (content) {
        content.animate(
            [
                { opacity: '1', transform: 'translateY(0)    scale(1)',    filter: 'blur(0px)' },
                { opacity: '0', transform: 'translateY(32px) scale(0.97)', filter: 'blur(6px)' }
            ],
            { duration: 260, delay: 30, easing: SHARP, fill: 'both' }
        );
    }

    // Speed up the panel's own CSS exit so it doesn't linger behind content
    panel.style.transitionDuration = '0.3s';
    setTimeout(() => {
        onDone();
        setTimeout(() => { panel.style.transitionDuration = ''; }, 320);
    }, 280);
}

// ---- Cinematic Panel Reveal Helper ----
window.showFullPanelCinematic = function(panelId, initFn) {
    const p = document.getElementById(panelId);
    if (!p || p.classList.contains('visible')) return;
    // Hide other panels
    ['chemicals-panel', 'delivery-panel', 'dashboard-panel', 'analytics-panel']
        .filter(x => x !== panelId)
        .forEach(id => { const el = document.getElementById(id); if (el) { el.classList.remove('visible'); el.classList.remove('panel-enter'); } });
    
    window.activePanel = panelId;
    
    // Show spheres background for these inner panels
    const webglCanvas = document.getElementById('webgl-canvas');
    if (webglCanvas) webglCanvas.classList.add('active');
    
    // Start cinematic sequence
    p.classList.add('panel-enter');
    
    // Add visible class after a tiny delay so the CSS transition engine registers the .panel-enter state first
    setTimeout(() => {
        p.classList.add('visible');
        if (initFn) initFn();
        // ---- Premium enter transition ----
        _animatePanelIn(p);
    }, 50);
    
    // Clean up animation class later
    setTimeout(() => {
        p.classList.remove('panel-enter');
    }, 1200);
};

// ---- Resize ----
function resizeCanvases() {
    heroCanvas.width = fxCanvas.width = innerWidth;
    heroCanvas.height = fxCanvas.height = innerHeight;
}
resizeCanvases();
addEventListener('resize', () => {
    resizeCanvases();
    if (MOL.length) resetMolNodes();
    if (BUBBLES.length) resetBubbles();
});

// ---- Draw Single Frame Helper ----
function drawSingleFrame(arr, idx, alpha) {
    const safeIdx = Math.max(0, Math.min(arr.length - 1, Math.round(idx)));
    const img = arr[safeIdx];
    if (!img || !img.complete || !img.naturalWidth) return;
    const cw = heroCanvas.width, ch = heroCanvas.height;
    const panelOffset = (PANEL_W_CSS * 0.38) * currentCenterFactor;
    const scale = Math.max((cw + Math.abs(panelOffset) * 2) / img.naturalWidth, ch / img.naturalHeight) * 1.02;
    const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
    const marginX = (iw - cw) / 2;
    const visibleCX = (PANEL_W_CSS * currentCenterFactor) + (cw - PANEL_W_CSS * currentCenterFactor) / 2;
    parallax.x += (((mouse.x - visibleCX) / ((cw - PANEL_W_CSS * currentCenterFactor) * 0.5)) - parallax.x) * 0.028;
    parallax.y += (((mouse.y - ch * 0.5) / (ch * 0.5)) - parallax.y) * 0.028;
    let ox = (cw - iw) / 2 + panelOffset + parallax.x * marginX * 0.35;
    let oy = (ch - ih) / 2 + parallax.y * ((ih - ch) / 2) * 0.25;
    if (ox > 0) ox = 0; if (ox + iw < cw) ox = cw - iw;
    if (oy > 0) oy = 0; if (oy + ih < ch) oy = ch - ih;
    hCtx.save();
    hCtx.globalAlpha = alpha;
    hCtx.drawImage(img, ox, oy, iw, ih);
    hCtx.restore();
}

// ---- Draw Hero Frame ----
function drawHeroFrame() {
    const cw = heroCanvas.width, ch = heroCanvas.height;
    currentCenterFactor += (targetCenterFactor - currentCenterFactor) * 0.025;
    hCtx.clearRect(0, 0, cw, ch);

    let arr = images1;
    if (appState === STATE_AI_SCROLL || appState === STATE_TRANS_IN || appState === STATE_TRANS_OUT) arr = images2;
    else if (appState === STATE_INTRO_PLAY || appState === STATE_INTRO_REVERSE) arr = images3;
    else if (appState === STATE_DASHBOARD_IN || appState === STATE_DASHBOARD_OUT || appState === STATE_REGION_SELECT) arr = images5;
    else if (appState === STATE_REGION_IN || appState === STATE_REGION_OPEN || appState === STATE_REGION_OUT) arr = _regionImages || images5;
    else if (appState === STATE_SIGNOUT) arr = images6;
    else if (appState === STATE_CHEM_IN || appState === STATE_CHEM_OUT) arr = images7;
    else if (appState === STATE_ANALYTICS_IN || appState === STATE_ANALYTICS_OUT) arr = images8;
    else if (appState === STATE_DELIVERIES_IN || appState === STATE_DELIVERIES_OUT) arr = images9;
    drawSingleFrame(arr, frameIdx, 1);
}

// ---- Preload ----
for (let i = 0; i < FRAME_COUNT_1; i++) {
    const img = new Image();
    img.onload = () => { loaded1++; if (loadPctEl) loadPctEl.textContent = Math.min(99, Math.round((loaded1 / FRAME_COUNT_1) * 100)); if (loaded1 >= 10 && !ready) { ready = true; startApp(); } };
    img.onerror = () => { loaded1++; };
    img.src = `${BASE_PATH_1}${String(i).padStart(3, '0')}_delay-0.041s.jpg?v=2`;
    images1.push(img);
}
function _pf(arr, basePath, count) { for (let i = 0; i < count; i++) { const img = new Image(); img.src = `${basePath}${String(i).padStart(3, '0')}_delay-0.041s.jpg`; arr.push(img); } }
function preloadFrames2() { _pf(images2, BASE_PATH_2, FRAME_COUNT_2); }
function preloadFrames3() { _pf(images3, BASE_PATH_3, FRAME_COUNT_3); }
function preloadFrames5() { _pf(images5, BASE_PATH_5, FRAME_COUNT_5); }
function preloadFrames6() { _pf(images6, BASE_PATH_6, FRAME_COUNT_6); }
function preloadFrames7() { _pf(images7, BASE_PATH_7, FRAME_COUNT_7); }
function preloadFrames8() { _pf(images8, BASE_PATH_8, FRAME_COUNT_8); }
function preloadFrames9() { _pf(images9, BASE_PATH_9, FRAME_COUNT_9); }
function preloadRegionFrames(folder, arr, count) {
    if (arr.length > 0) return;
    for (let i = 0; i < count; i++) { const img = new Image(); img.src = `${folder}/frame_${String(i).padStart(3, '0')}_delay-0.041s.jpg`; arr.push(img); }
}
setTimeout(() => { if (!ready) { ready = true; startApp(); } }, 3500);

function startApp() {
    if (loadPctEl) loadPctEl.textContent = '100';
    setTimeout(() => { loaderEl.classList.add('out'); requestAnimationFrame(loop); preloadFrames2(); preloadFrames3(); preloadFrames5(); preloadFrames6(); preloadFrames7(); preloadFrames8(); preloadFrames9(); }, 700);
}

// ---- Master Loop ----
function loop(ts) {
    requestAnimationFrame(loop);
    const delta = ts - lastFTs;

    if (appState === STATE_LOGIN) {
        targetCenterFactor = 1;
    }
    else if (appState === STATE_HOME) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx++;
            if (frameIdx >= FRAME_COUNT_1) frameIdx = LOOP_START;
        }
    }
    else if (appState === STATE_AI_SCROLL) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_2 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_2 - 1 && !aiInterface.classList.contains('visible')) {
                aiInterface.classList.remove('hidden');
                aiInterface.classList.add('visible');
            }
        }
    }
    else if (appState === STATE_TRANS_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) {
                frameIdx = LOOP_START;
                appState = STATE_HOME;
                targetCenterFactor = 1;
                panelEl.classList.remove('offscreen');
            }
        }
    }
    else if (appState === STATE_INTRO_PLAY) {
        const iv = FRAME_INTERVAL * 0.9;
        if (delta >= iv) {
            lastFTs = ts - (delta % iv);
            frameIdx++;
            if (frameIdx >= FRAME_COUNT_3 - 1) {
                // Direct transition to frames1 (same as logout but forward)
                frameIdx = 0;
                appState = STATE_HOME;
                panelEl.classList.remove('offscreen');
                document.getElementById('hud-bar').classList.add('visible');
            }
        }
    }
    else if (appState === STATE_INTRO_REVERSE) {
        const iv = FRAME_INTERVAL * 0.7;
        if (delta >= iv) {
            lastFTs = ts - (delta % iv);
            frameIdx--;
            if (frameIdx <= 0) {
                frameIdx = 0;
                appState = STATE_LOGIN;
                loginScreen.classList.remove('hidden');
            }
        }
    }
    else if (appState === STATE_HOME_REVERSE) {
        const iv = FRAME_INTERVAL * 0.3;
        if (delta >= iv) {
            lastFTs = ts - (delta % iv);
            frameIdx--;
            if (frameIdx <= 0) {
                frameIdx = FRAME_COUNT_3 - 1;
                appState = STATE_INTRO_REVERSE;
            }
        }
    }
    else if (appState === STATE_DASHBOARD_IN) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_5 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_5 - 1) {
                window.showFullPanelCinematic('dashboard-panel');
            }
        }
    }
    else if (appState === STATE_DASHBOARD_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) { frameIdx = LOOP_START; appState = STATE_HOME; targetCenterFactor = 1; panelEl.classList.remove('offscreen'); }
        }
    }
    else if (appState === STATE_REGION_IN) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < _regionFrameCount - 1) frameIdx++;
            if (frameIdx >= _regionFrameCount - 1 && appState !== STATE_REGION_OPEN) {
                window.showFullPanelCinematic('dashboard-panel', () => {
                    if (window.loadDashboard) window.loadDashboard(_selectedRegion);
                });
                appState = STATE_REGION_OPEN;
            }
        }
    }
    else if (appState === STATE_REGION_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) { frameIdx = FRAME_COUNT_5 - 1; appState = STATE_REGION_SELECT; showRegionSelector(); }
        }
    }
    else if (appState === STATE_SIGNOUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_6 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_6 - 1) { frameIdx = 0; appState = STATE_LOGIN; loginScreen.classList.remove('hidden'); }
        }
    }
    else if (appState === STATE_CHEM_IN) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_7 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_7 - 1) {
                window.showFullPanelCinematic('chemicals-panel');
            }
        }
    }
    else if (appState === STATE_CHEM_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) { frameIdx = LOOP_START; appState = STATE_HOME; targetCenterFactor = 1; panelEl.classList.remove('offscreen'); }
        }
    }
    else if (appState === STATE_ANALYTICS_IN) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_8 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_8 - 1) {
                window.showFullPanelCinematic('analytics-panel', () => {
                    if (window.initAnalyticsPanel) window.initAnalyticsPanel();
                });
            }
        }
    }
    else if (appState === STATE_ANALYTICS_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) { frameIdx = LOOP_START; appState = STATE_HOME; targetCenterFactor = 1; panelEl.classList.remove('offscreen'); }
        }
    }
    else if (appState === STATE_DELIVERIES_IN) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            if (frameIdx < FRAME_COUNT_9 - 1) frameIdx++;
            if (frameIdx >= FRAME_COUNT_9 - 1) {
                window.showFullPanelCinematic('delivery-panel', () => {
                    if (window.loadDeliveries) window.loadDeliveries();
                });
            }
        }
    }
    else if (appState === STATE_DELIVERIES_OUT) {
        if (delta >= FRAME_INTERVAL) {
            lastFTs = ts - (delta % FRAME_INTERVAL);
            frameIdx--;
            if (frameIdx <= 0) { frameIdx = LOOP_START; appState = STATE_HOME; targetCenterFactor = 1; panelEl.classList.remove('offscreen'); }
        }
    }

    drawHeroFrame();
    if (hudFrame) hudFrame.textContent = `FRAME ${String(Math.round(frameIdx) + 1).padStart(3, '0')}`;
    fCtx.clearRect(0, 0, fxCanvas.width, fxCanvas.height);
    updateDrawMolecules(); updateDrawBubbles();
    ringPos.x += (mouse.x - ringPos.x) * 0.12;
    ringPos.y += (mouse.y - ringPos.y) * 0.12;
    if (cursorRing) { cursorRing.style.left = ringPos.x + 'px'; cursorRing.style.top = ringPos.y + 'px'; }
    updateHomepageLlmFloatingVisibility();
}

// ---- Nav Renumbering ----
/** Re-stamps every visible nav link with sequential numbers 01, 02, 03… */
function renumberNav() {
    const links = document.querySelectorAll('#panel nav a:not(.hidden)');
    links.forEach((link, i) => {
        const numEl = link.querySelector('.nav-num');
        if (numEl) numEl.textContent = String(i + 1).padStart(2, '0');
    });
}

// ---- Post-Login Setup ----
window.onLoginSuccess = function onLoginSuccess(user) {
    currentUser = user;
    const chip = document.getElementById('profile-chip');
    const avatar = document.getElementById('profile-avatar');
    const nameEl = document.getElementById('profile-name');
    const badge = document.getElementById('profile-badge');
    if (user.picture) { avatar.src = user.picture; avatar.style.display = 'block'; }
    else { avatar.style.display = 'none'; }
    nameEl.textContent = user.name || user.username || user.email || 'User';


    // Hide all role-specific nav items first
    ['nav-analytics','nav-dashboard','admin-panel-btn','nav-chemicals','nav-deliveries'].forEach(id => {
        document.getElementById(id)?.classList.add('hidden');
    });

    if (user.role === 'admin') {
        badge.textContent = 'ADMIN';
        badge.className = 'profile-badge admin';
        // Admin: Analytics, Dashboard, Admin Panel, AI System
        document.getElementById('nav-analytics')?.classList.remove('hidden');
        document.getElementById('nav-dashboard')?.classList.remove('hidden');
        document.getElementById('admin-panel-btn')?.classList.remove('hidden');

        startAdminPolling();
    } else if (user.role === 'regional_admin') {
        badge.textContent = 'REG ADMIN';
        badge.className = 'profile-badge reg-admin';
        // Regional Admin: Regional Dashboard, Chemicals, AI System
        document.getElementById('nav-dashboard')?.classList.remove('hidden');
        document.getElementById('nav-chemicals')?.classList.remove('hidden');

        startUserPolling();
    } else {
        badge.textContent = 'USER';
        badge.className = 'profile-badge user';
        // User: My Deliveries, AI System
        document.getElementById('nav-deliveries')?.classList.remove('hidden');
        startUserPolling();
    }

    // Re-number all visible nav items sequentially for this role
    renumberNav();

    // Dynamic Hero Text Injection
    const heroEyebrow = document.getElementById('hero-eyebrow');
    const heroTitle   = document.getElementById('hero-title');
    const heroDesc    = document.getElementById('hero-desc');
    
    if (heroEyebrow && heroTitle && heroDesc) {
        if (user.role === 'admin') {
            heroEyebrow.innerHTML = 'Admin Access';
            heroTitle.innerHTML   = 'Managing<br><strong>the nationwide<br>distribution<br>network.</strong>';
            heroDesc.innerHTML    = 'As an Admin, oversee ChemTech\'s entire supply chain, view analytics arrays, and manage cross-regional logistics operations.';
        } else if (user.role === 'regional_admin') {
            heroEyebrow.innerHTML = 'Regional Admin Access';
            heroTitle.innerHTML   = 'Directing<br><strong>regional<br>logistics at<br>scale.</strong>';
            heroDesc.innerHTML    = 'As a Regional Admin, manage chemical inventory, track local operations, and orchestrate deliveries securely across your sector.';
        } else {
            heroEyebrow.innerHTML = 'User Portal';
            heroTitle.innerHTML   = 'Engineered<br><strong>at the<br>molecular<br>level.</strong>';
            heroDesc.innerHTML    = 'Welcome, User. Order high-performance chemical compounds that drive progress across energy, life sciences, and advanced materials.';
        }
    }

    chip.classList.remove('hidden');
    // Show notification bell for logged-in users
    const bellBtn = document.getElementById('notif-bell-btn');
    if (bellBtn) bellBtn.classList.remove('hidden');
    syncLlmHomepageUi();
    loadUserGroqKeyStatus();
    initHoverLogic();
    if (window.initFeatureNav) window.initFeatureNav();
    loginScreen.classList.add('hidden');
    pendingScreen.classList.add('hidden');
    appState = STATE_INTRO_PLAY; frameIdx = 0; targetCenterFactor = 1;
};

function showPendingScreen() {
    loginScreen.classList.add('hidden');
    pendingScreen.classList.remove('hidden');
}

// ---- Pending Back Button ----
pendingBackBtn.addEventListener('click', () => {
    pendingScreen.classList.add('hidden');
    loginScreen.classList.remove('hidden');
});

// ---- Google Login ----
window.handleGoogleLogin = async function (response) {
    try {
        const res = await fetch(AUTH_API + '/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ credential: response.credential, role: selectedRole }) });
        const data = await res.json();
        if (!data.success) { showToast(data.error || 'Login failed.', 'error'); return; }
        const user = data.user;
        // Check approval
        if (!user.approved) {
            showPendingScreen();
            showToast('Account pending admin approval.', 'info');
            return;
        }
        if (selectedRole === 'admin' && user.role !== 'admin') {
            await fetch(AUTH_API + '/api/request-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ google_id: user.google_id }) });
            user.pending_admin = true;
            showToast('Admin access requested. Awaiting approval.', 'info');
        }
        window.onLoginSuccess(user);
    } catch (err) { console.error('Auth error', err); showToast('Could not reach secure auth backend.', 'error'); }
};

// ---- Manual Login ----
const manualLoginForm = document.getElementById('manual-login-form');
const loginError = document.getElementById('login-error');
const usernameInput = document.getElementById('login-username');
const passwordInput = document.getElementById('login-password');

usernameInput.addEventListener('input', () => loginError.textContent = '');
passwordInput.addEventListener('input', () => loginError.textContent = '');

manualLoginForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    loginError.textContent = '';
    try {
        const res = await fetch(AUTH_API + '/api/manual-login', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const data = await res.json();
        if (!data.success) {
            loginError.textContent = data.error || 'Login failed.';
            return;
        }
        if (!data.user.approved) {
            showPendingScreen();
            showToast('Account pending admin approval.', 'info');
            return;
        }
        window.onLoginSuccess(data.user);
    } catch (err) {
        loginError.textContent = 'Could not connect to server.';
        console.error('Manual login error', err);
    }
});

// ---- Register ----
document.getElementById('register-btn').addEventListener('click', async () => {
    const username = document.getElementById('login-username').value.trim();
    const password = document.getElementById('login-password').value.trim();
    loginError.textContent = '';
    if (!username || !password) { loginError.textContent = 'Please fill in both fields.'; return; }
    try {
        const res = await fetch(AUTH_API + '/api/register', {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, role: selectedRole })
        });
        const data = await res.json();
        if (!data.success) {
            loginError.textContent = data.error || 'Registration failed.';
            return;
        }
        showPendingScreen();
        showToast('Account created! Awaiting admin approval.', 'success');
    } catch (err) {
        loginError.textContent = 'Could not connect to server.';
        console.error('Register error', err);
    }
});

// ---- Logout ----
logoutBtn.addEventListener('click', e => {
    e.preventDefault();
    if (appState !== STATE_HOME) return;
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    if (window._userPollInterval) { clearInterval(window._userPollInterval); window._userPollInterval = null; }
    currentUser = null; lastPendingCount = 0; isFirstPoll = true;
    document.getElementById('profile-chip').classList.add('hidden');
    const bellBtn = document.getElementById('notif-bell-btn');
    if (bellBtn) bellBtn.classList.add('hidden');
    const badge = document.getElementById('notif-badge');
    if (badge) badge.classList.add('hidden');
    closeNotifPanel();
    adminPanelBtn.classList.add('hidden');
    panelEl.classList.add('offscreen');
    document.getElementById('hud-bar').classList.remove('visible');
    frameIdx = 0; appState = STATE_SIGNOUT; targetCenterFactor = 1;
    fetch(AUTH_API + '/api/logout', { method: 'POST' });
});

// ---- AI Mode ----
aiBtn.addEventListener('click', e => {
    e.preventDefault();
    if (appState !== STATE_HOME) return;
    hideLlmToggleAnimated();
    frameIdx = 0; appState = STATE_TRANS_IN;
    panelEl.classList.remove('hidden'); // fail-safe cleanup
    panelEl.classList.add('offscreen'); targetCenterFactor = 0;
    setTimeout(() => { appState = STATE_AI_SCROLL; }, 1100);
});

aiBackBtn.addEventListener('click', () => {
    if (appState === STATE_AI_SCROLL) {
        aiInterface.classList.remove('visible');
        aiInterface.classList.add('hidden');
        appState = STATE_TRANS_OUT;
    }
});

// ---- Dashboard Anim Hooks ----
window.triggerDashboardAnim = () => {
    if (appState !== STATE_HOME) return;
    hideLlmToggleAnimated();
    frameIdx = 0; appState = STATE_DASHBOARD_IN;
    panelEl.classList.remove('hidden'); panelEl.classList.add('offscreen');
    targetCenterFactor = 0;
};
window.triggerDashboardBackAnim = () => {
    if (appState === STATE_DASHBOARD_IN) {
        const panel = document.getElementById('dashboard-panel');
        const webglCanvas = document.getElementById('webgl-canvas');
        if (webglCanvas) webglCanvas.classList.remove('active');
        window.activePanel = null;
        frameIdx = FRAME_COUNT_5 - 1;
        appState = STATE_DASHBOARD_OUT;
        if (panel) {
            _animatePanelOut(panel, () => panel.classList.remove('visible'));
        }
    }
};
window.handleRegionSelectBack = function() {
    hideRegionSelector(); frameIdx = FRAME_COUNT_5 - 1; appState = STATE_DASHBOARD_OUT;
};
// ---- Region selector helpers ----
function showRegionSelector() {
    const ov = document.getElementById('region-select-overlay');
    if (ov) { ov.classList.remove('hidden'); ov.classList.add('visible'); }
}
function hideRegionSelector() {
    const ov = document.getElementById('region-select-overlay');
    if (ov) { ov.classList.add('hidden'); ov.classList.remove('visible'); }
}
window.selectRegion = function(region, folder, count) {
    _selectedRegion = region;
    const map = { overall: imagesOverall, punjab: imagesPunjab, KPK: imagesKPK, sindh: imagesSindh, balochistan: imagesBaloch };
    _regionImages = map[folder] || imagesOverall; _regionFrameCount = count;
    preloadRegionFrames(folder, _regionImages, count);
    hideRegionSelector(); frameIdx = 0; appState = STATE_REGION_IN;
};
// ---- Chemicals Anim Hooks ----
window.triggerChemAnim = () => {
    if (appState !== STATE_HOME) return;
    hideLlmToggleAnimated();
    frameIdx = 0; appState = STATE_CHEM_IN;
    panelEl.classList.remove('hidden'); panelEl.classList.add('offscreen');
    targetCenterFactor = 0;
};
window.triggerChemBackAnim = () => {
    if (appState === STATE_CHEM_IN) {
        const panel = document.getElementById('chemicals-panel');
        const webglCanvas = document.getElementById('webgl-canvas');
        if (webglCanvas) webglCanvas.classList.remove('active');
        window.activePanel = null; frameIdx = FRAME_COUNT_7 - 1; appState = STATE_CHEM_OUT;
        if (panel) {
            _animatePanelOut(panel, () => panel.classList.remove('visible'));
        }
    }
};
// ---- Analytics Anim Hooks ----
window.triggerAnalyticsAnim = () => {
    if (appState !== STATE_HOME) return;
    hideLlmToggleAnimated();
    frameIdx = 0; appState = STATE_ANALYTICS_IN;
    panelEl.classList.remove('hidden'); panelEl.classList.add('offscreen');
    targetCenterFactor = 0;
};
window.triggerAnalyticsBackAnim = () => {
    if (appState === STATE_ANALYTICS_IN) {
        const panel = document.getElementById('analytics-panel');
        const webglCanvas = document.getElementById('webgl-canvas');
        if (webglCanvas) webglCanvas.classList.remove('active');
        window.activePanel = null; frameIdx = FRAME_COUNT_8 - 1; appState = STATE_ANALYTICS_OUT;
        if (panel) {
            _animatePanelOut(panel, () => panel.classList.remove('visible'));
        }
    }
};
// ---- Deliveries Anim Hooks ----
window.triggerDeliveriesAnim = () => {
    if (appState !== STATE_HOME) return;
    hideLlmToggleAnimated();
    frameIdx = 0; appState = STATE_DELIVERIES_IN;
    panelEl.classList.remove('hidden'); panelEl.classList.add('offscreen');    
    targetCenterFactor = 0;
};
window.triggerDeliveriesBackAnim = () => {
    if (appState === STATE_DELIVERIES_IN) {
        const panel = document.getElementById('delivery-panel');
        const webglCanvas = document.getElementById('webgl-canvas');
        if (webglCanvas) webglCanvas.classList.remove('active');
        window.activePanel = null; frameIdx = FRAME_COUNT_9 - 1; appState = STATE_DELIVERIES_OUT;
        if (panel) {
            _animatePanelOut(panel, () => panel.classList.remove('visible'));
        }
    }
};

// ---- Admin Modal ----
adminPanelBtn.addEventListener('click', e => { e.preventDefault(); openAdminModal(); });
adminModalClose.addEventListener('click', closeAdminModal);
adminModalOverlay.addEventListener('click', closeAdminModal);

function openAdminModal() {
    adminModal.classList.remove('hidden'); adminModal.classList.add('visible');
    refreshAdminModal();
}
function closeAdminModal() {
    adminModal.classList.remove('visible');
    setTimeout(() => adminModal.classList.add('hidden'), 350);
}

function getAuthBody() {
    if (!currentUser) return {};
    return currentUser.google_id
        ? { google_id: currentUser.google_id, caller_id: currentUser.user_id }
        : { caller_id: currentUser.user_id };
}

async function refreshAdminModal() {
    if (!currentUser || currentUser.role !== 'admin') return;
    const authBody = getAuthBody();
    const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(authBody) };
    try {
        const [pendUsersRes, allUsersRes, pendAdminRes, adminsRes] = await Promise.all([
            fetch('http://localhost:5000/api/pending-users', opts).then(r => r.json()),
            fetch('http://localhost:5000/api/all-users', opts).then(r => r.json()),
            fetch('http://localhost:5000/api/pending-admin-requests', opts).then(r => r.json()),
            fetch('http://localhost:5000/api/admins', opts).then(r => r.json())
        ]);

        // Pending user approvals
        const pendUsers = pendUsersRes.users || [];
        pendingUserCountEl.textContent = pendUsers.length;
        pendingUserListEl.innerHTML = pendUsers.length
            ? pendUsers.map(u => `<div class="admin-row"><div class="admin-row-user">${u.picture ? `<img class="admin-avatar" src="${u.picture}" alt="">` : '<div class="admin-avatar-placeholder">👤</div>'}<div><div class="admin-row-name">${esc(u.name || u.username || 'Unknown')}</div><div class="admin-row-email">${esc(u.email || u.username || '')}</div><div class="admin-row-type">${u.login_type}</div></div></div><div class="admin-row-actions"><button class="admin-btn approve" onclick="approveUser(${u.user_id},'${esc(u.name || u.username || '')}','user')">Approve User</button><button class="admin-btn approve reg-approve-btn" onclick="approveUser(${u.user_id},'${esc(u.name || u.username || '')}','regional_admin')">✦ Reg Admin</button><button class="admin-btn approve" style="background:rgba(255,180,0,0.15);border-color:rgba(255,180,0,0.4);color:#ffb400;" onclick="approveUser(${u.user_id},'${esc(u.name || u.username || '')}','admin')">★ Admin</button><button class="admin-btn deny" onclick="denyUser(${u.user_id})">Deny</button></div></div>`).join('')
            : '<div class="admin-empty">No pending approvals</div>';

        // All users
        const allUsers = (allUsersRes.users || []).filter(u => u.approved);
        allUsersListEl.innerHTML = allUsers.length
            ? allUsers.map(u => {
                const isSelf = u.user_id === currentUser.user_id;
                return `<div class="admin-row"><div class="admin-row-user">${u.picture ? `<img class="admin-avatar" src="${u.picture}" alt="">` : '<div class="admin-avatar-placeholder">👤</div>'}<div><div class="admin-row-name">${esc(u.name || u.username || 'Unknown')}</div><div class="admin-row-email">${esc(u.email || u.username || '')}</div><div class="admin-row-type">${u.login_type} · ${u.role}</div></div></div><div class="admin-row-actions">${isSelf ? '<span class="admin-self-badge">You</span>' : `<button class="admin-btn revoke" onclick="revokeAccess(${u.user_id},'${esc(u.name || u.username || '')}')">Revoke</button>`}</div></div>`;
            }).join('')
            : '<div class="admin-empty">No approved users</div>';

        // Pending admin requests
        const pending = pendAdminRes.pending || [];
        pendingCountEl.textContent = pending.length;
        pendingListEl.innerHTML = pending.length
            ? pending.map(u => `<div class="admin-row"><div class="admin-row-user">${u.picture ? `<img class="admin-avatar" src="${u.picture}" alt="">` : '<div class="admin-avatar-placeholder">👤</div>'}<div><div class="admin-row-name">${u.name || 'Unknown'}</div><div class="admin-row-email">${u.email}</div></div></div><div class="admin-row-actions"><button class="admin-btn approve" onclick="approveAdmin('${u.google_id}','${(u.name || '').replace(/'/g, '')}')">Approve</button><button class="admin-btn deny" onclick="denyAdmin('${u.google_id}')">Deny</button></div></div>`).join('')
            : '<div class="admin-empty">No pending requests</div>';

        // Admins
        const admins = adminsRes.admins || [];
        adminsListEl.innerHTML = admins.length
            ? admins.map(u => `<div class="admin-row"><div class="admin-row-user">${u.picture ? `<img class="admin-avatar" src="${u.picture}" alt="">` : '<div class="admin-avatar-placeholder">👤</div>'}<div><div class="admin-row-name">${u.name || 'Unknown'}</div><div class="admin-row-email">${u.email}</div></div></div><div class="admin-row-actions">${u.google_id !== currentUser.google_id ? `<button class="admin-btn revoke" onclick="revokeAdmin('${u.google_id}','${(u.name || '').replace(/'/g, '')}')">Revoke</button>` : '<span class="admin-self-badge">You</span>'}</div></div>`).join('')
            : '<div class="admin-empty">No admins found</div>';
    } catch (e) { console.error('Admin modal error', e); }
}

function esc(str) { return String(str).replace(/'/g, '&#39;').replace(/"/g, '&quot;').replace(/</g, '&lt;'); }

// User management actions
window.approveUser = async function (id, name, role = 'user') {
    const body = { ...getAuthBody(), target_id: id, role };
    await fetch('http://localhost:5000/api/approve-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const roleLabel = role === 'admin' ? 'Admin' : role === 'regional_admin' ? 'Regional Admin' : 'User';
    showToast(`✓ ${name || 'User'} approved as ${roleLabel}`, 'success');
    refreshAdminModal();
};
window.denyUser = async function (id) {
    const body = { ...getAuthBody(), target_id: id };
    await fetch('http://localhost:5000/api/deny-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast('User denied and removed.', 'info');
    refreshAdminModal();
};
window.revokeAccess = async function (id, name) {
    const body = { ...getAuthBody(), target_id: id };
    await fetch('http://localhost:5000/api/revoke-access', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast(`${name || 'User'} access revoked.`, 'warning');
    refreshAdminModal();
};

// Admin role actions
window.approveAdmin = async function (id, name) {
    const body = { google_id: currentUser.google_id, target_google_id: id };
    await fetch('http://localhost:5000/api/approve-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast(`✓ ${name || 'User'} is now an Admin`, 'success'); refreshAdminModal();
};
window.denyAdmin = async function (id) {
    const body = { google_id: currentUser.google_id, target_google_id: id };
    await fetch('http://localhost:5000/api/deny-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast('Request denied.', 'info'); refreshAdminModal();
};
window.revokeAdmin = async function (id, name) {
    const body = { google_id: currentUser.google_id, target_google_id: id };
    await fetch('http://localhost:5000/api/revoke-admin', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    showToast(`${name || 'User'} revoked to User role.`, 'info'); refreshAdminModal();
};

// Add user form
document.getElementById('add-user-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    const username = document.getElementById('add-user-username').value.trim();
    const password = document.getElementById('add-user-password').value.trim();
    const roleEl = document.getElementById('add-user-role');
    const role = roleEl ? roleEl.value : 'user';
    if (!username || !password) { showToast('Fill in username and password.', 'error'); return; }
    const body = { ...getAuthBody(), username, password, role };
    try {
        const res = await fetch('http://localhost:5000/api/add-user', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
        const data = await res.json();
        if (data.success) {
            const roleLabel = role === 'admin' ? 'Admin' : role === 'regional_admin' ? 'Regional Admin' : 'User';
            showToast(`✓ ${roleLabel} '${username}' created`, 'success');
            document.getElementById('add-user-username').value = '';
            document.getElementById('add-user-password').value = '';
            if (roleEl) roleEl.value = 'user';
            refreshAdminModal();
        } else {
            showToast(data.error || 'Failed to add user.', 'error');
        }
    } catch (err) { showToast('Server error.', 'error'); }
});

// ---- Persistent Notification Center ----
let _notifPanelOpen = false;

window.loadNotifications = async function() {
    if (!currentUser) return;
    try {
        const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getAuthBody()) };
        const data = await fetch('http://localhost:5000/api/notifications/list', opts).then(r => r.json());
        const notifications = data.notifications || [];
        _renderNotifList(notifications);
    } catch (_) { }
};

function _renderNotifList(notifications) {
    const bell = document.getElementById('notif-bell-btn');
    const badge = document.getElementById('notif-badge');
    const list = document.getElementById('notif-list');
    const countEl = document.getElementById('notif-panel-count');
    const dismissAllBtn = document.getElementById('notif-dismiss-all-btn');

    const count = notifications.length;

    // Update badge
    if (badge) {
        badge.textContent = count > 9 ? '9+' : String(count);
        badge.classList.toggle('hidden', count === 0);
    }
    if (bell) bell.classList.toggle('notif-bell-active', count > 0);
    if (countEl) countEl.textContent = count > 0 ? `${count} unread` : '';
    if (dismissAllBtn) dismissAllBtn.style.display = count > 0 ? '' : 'none';

    if (!list) return;

    if (count === 0) {
        list.innerHTML = '<div class="notif-empty">✓ You\'re all caught up</div>';
        return;
    }

    list.innerHTML = notifications.map(n => {
        const icon = n.type === 'delivery' ? '📦' : n.type === 'low_stock' ? '⚠️' : '🔔';
        const typeClass = n.type === 'delivery' ? 'notif-delivery' : n.type === 'low_stock' ? 'notif-lowstock' : '';
        const when = _timeAgo(n.created_at);
        return `<div class="notif-item ${typeClass}" id="notif-item-${n.id}">
            <div class="notif-item-icon">${icon}</div>
            <div class="notif-item-body">
                <div class="notif-item-title">${esc(n.title)}</div>
                <div class="notif-item-text">${esc(n.body)}</div>
                <div class="notif-item-time">${when}</div>
            </div>
            <button class="notif-item-dismiss" onclick="dismissNotification(${n.id})" title="Dismiss">✕</button>
        </div>`;
    }).join('');
}

function _timeAgo(isoStr) {
    if (!isoStr) return '';
    const diff = Math.floor((Date.now() - new Date(isoStr + 'Z').getTime()) / 1000);
    if (isNaN(diff) || diff < 0) return 'just now';
    if (diff < 60) return 'just now';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
}

window.dismissNotification = async function(id) {
    if (!currentUser) return;
    try {
        const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...getAuthBody(), notification_id: id }) };
        await fetch('http://localhost:5000/api/notifications/dismiss', opts);
        // Animate out then reload
        const el = document.getElementById('notif-item-' + id);
        if (el) { el.style.opacity = '0'; el.style.transform = 'translateX(40px)'; el.style.transition = '0.25s'; setTimeout(() => window.loadNotifications(), 280); }
        else window.loadNotifications();
    } catch (_) { }
};

window.dismissAllNotifications = async function() {
    if (!currentUser) return;
    try {
        const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getAuthBody()) };
        await fetch('http://localhost:5000/api/notifications/dismiss-all', opts);
        window.loadNotifications();
    } catch (_) { }
};

window.toggleNotifPanel = function() {
    _notifPanelOpen ? closeNotifPanel() : openNotifPanel();
};
window.openNotifPanel = function() {
    const p = document.getElementById('notif-panel');
    if (!p) return;
    p.classList.remove('hidden');
    requestAnimationFrame(() => p.classList.add('notif-panel-visible'));
    _notifPanelOpen = true;
    window.loadNotifications();
};
window.closeNotifPanel = function() {
    const p = document.getElementById('notif-panel');
    if (!p) return;
    p.classList.remove('notif-panel-visible');
    setTimeout(() => p.classList.add('hidden'), 320);
    _notifPanelOpen = false;
};

// ---- Polling ----
function startAdminPolling() {
    if (pollInterval) clearInterval(pollInterval);
    pollInterval = setInterval(async () => {
        if (!currentUser || currentUser.role !== 'admin') return;
        try {
            const opts = { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(getAuthBody()) };
            const [pendRes, pendUserRes] = await Promise.all([
                fetch('http://localhost:5000/api/pending-admin-requests', opts).then(r => r.json()),
                fetch('http://localhost:5000/api/pending-users', opts).then(r => r.json())
            ]);
            const adminPending = pendRes.pending || [];
            const userPending = pendUserRes.users || [];
            const totalCount = adminPending.length + userPending.length;
            if (isFirstPoll) {
                lastPendingCount = totalCount;
                isFirstPoll = false;
            } else if (totalCount > lastPendingCount) {
                if (userPending.length > 0) {
                    const newest = userPending[userPending.length - 1];
                    showToast(`🔔 ${newest.name || newest.username || 'Someone'} requests access`, 'warning');
                } else if (adminPending.length > 0) {
                    const newest = adminPending[adminPending.length - 1];
                    showToast(`🔔 ${newest.name || newest.email} requested Admin access`, 'warning');
                }
            }
            lastPendingCount = totalCount;
            if (pendingCountEl) pendingCountEl.textContent = adminPending.length;
            if (pendingUserCountEl) pendingUserCountEl.textContent = userPending.length;
            // Also refresh notification bell for admin
            window.loadNotifications();
        } catch (_) { }
    }, 10000);
}

function startUserPolling() {
    if (window._userPollInterval) clearInterval(window._userPollInterval);
    window._userPollInterval = setInterval(async () => {
        if (!currentUser) return;
        window.loadNotifications();
    }, 20000);
    // Fire immediately on login
    setTimeout(() => window.loadNotifications(), 1500);
}

// ---- Toasts ----
function showToast(message, type = 'info') {
    const t = document.createElement('div');
    t.className = `toast toast-${type}`;
    t.textContent = message;
    toastContainer.appendChild(t);
    requestAnimationFrame(() => requestAnimationFrame(() => t.classList.add('visible')));
    setTimeout(() => { t.classList.remove('visible'); setTimeout(() => t.remove(), 500); }, 5000);
}

// ---- Chatbot ----
function addMessage(text, type) {
    const div = document.createElement('div');
    div.className = `msg ${type}`; 
    // Poor man's markdown for display
    div.innerHTML = esc(text).replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br>');
    chatHistory.appendChild(div); chatHistory.scrollTop = chatHistory.scrollHeight;
}

document.querySelectorAll('.chat-sugg-chip').forEach(chip => {
    chip.addEventListener('click', () => {
        chatInput.value = chip.dataset.q || '';
        chatForm.dispatchEvent(new Event('submit'));
    });
});

chatForm.addEventListener('submit', async e => {
    e.preventDefault();
    const text = chatInput.value.trim(); if (!text) return;
    addMessage(text, 'user'); chatInput.value = '';
    const ld = document.createElement('div'); ld.className = 'msg bot'; ld.innerHTML = '<span style="opacity:0.5;">Processing molecular database query...</span>';
    chatHistory.appendChild(ld); chatHistory.scrollTop = chatHistory.scrollHeight;
    try {
        const u = window._currentUser || {};
        const payload = {
            question: text,
            caller_id: u.user_id,
            name: u.name || u.username,
            role: u.role,
            province: u.province,
            llm_provider: getLlmProvider()
        };
        const res = await fetch(AUTH_API + '/api/chat', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });
        const data = await res.json(); chatHistory.removeChild(ld);
        if (data.error) addMessage(`Error: ${data.error}`, 'bot error');
        else {
            if (data.llm_notice) showToast(data.llm_notice, 'info');
            addMessage(data.response, 'bot');
            speak(data.response);
        }
    } catch (err) { if (ld.parentNode) chatHistory.removeChild(ld); addMessage('Connection failed. Ensure chem-backend is running.', 'bot error'); }
});

// ---- Voice / TTS ----
const Recognition = window.SpeechRecognition || window.webkitSpeechRecognition;
if (Recognition) {
    const rec = new Recognition(); rec.lang = 'en-US'; rec.interimResults = false;
    rec.onstart = () => voiceBtn.classList.add('recording');
    rec.onend = () => voiceBtn.classList.remove('recording');
    rec.onresult = e => { chatInput.value = e.results[0][0].transcript; chatForm.dispatchEvent(new Event('submit')); };
    voiceBtn.addEventListener('click', () => voiceBtn.classList.contains('recording') ? rec.stop() : rec.start());
}
function cleanForTTS(text) {
    if (!text) return '';
    return text
        // Remove markdown formatting
        .replace(/\*\*(.*?)\*\*/g, '$1')
        .replace(/\*(.*?)\*/g, '$1')
        .replace(/#(.*?)\n/g, '$1. ')
        .replace(/`(.*?)`/g, '$1')
        // Transform list items into short pauses
        .replace(/^[ \t]*[-*•][ \t]+/gm, ', ')
        // Remove markdown links but keep text
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
        // Collapse multiple line breaks into a single pause ending in a period
        .replace(/\n+/g, '. ')
        .trim();
}

function speak(text) {
    if (!window.speechSynthesis) return;
    window.speechSynthesis.cancel();
    
    const cleanText = cleanForTTS(text);

    // Split into sentences to prevent long utterance lag/freezing in Chromium
    const chunks = cleanText.match(/[^.!?]+[.!?]*/g) || [cleanText];

    const voices = window.speechSynthesis.getVoices();
    // Prioritize natural sounding distinct English voices
    const premiumEn = voices.filter(v => 
        (v.name.includes('Google UK English Female') || v.name.includes('Google US English') || v.name.includes('Samantha') || v.name.includes('Aria')) && v.lang.startsWith('en')
    );
    const localEn = voices.filter(v => v.lang.startsWith('en') && v.localService);
    const targetVoice = premiumEn[0] || localEn[0] || voices.filter(v => v.lang.startsWith('en'))[0] || voices[0];

    if (stopAudioBtn) stopAudioBtn.style.display = 'flex';

    chunks.forEach((chunk, index) => {
        if (!chunk.trim()) return;
        const msg = new SpeechSynthesisUtterance(chunk.trim());
        if (targetVoice) msg.voice = targetVoice;
        msg.pitch = 1.0; 
        msg.rate = 0.92; // Slightly slower feels more polished
        // Only hide the stop button when the final chunk finishes
        if (index === chunks.length - 1) {
            msg.onend = msg.onerror = () => { if (stopAudioBtn) stopAudioBtn.style.display = 'none'; };
        }
        window.speechSynthesis.speak(msg);
    });
}
if (stopAudioBtn) stopAudioBtn.addEventListener('click', () => { window.speechSynthesis.cancel(); stopAudioBtn.style.display = 'none'; });
if (window.speechSynthesis) window.speechSynthesis.getVoices();

// ---- Molecular Network ----
const NODE_COUNT = 28, MOL = [];
class MolNode {
    constructor() { this.init(); }
    init() {
        const m = 60; this.x = PANEL_W_CSS + m + Math.random() * (innerWidth - PANEL_W_CSS - m * 2); this.y = m + Math.random() * (innerHeight - m * 2);
        this.vx = (Math.random() - .5) * .28; this.vy = (Math.random() - .5) * .28; this.r = Math.random() * 2.2 + .6;
        this.a = Math.random() * .25 + .06; this.ph = Math.random() * Math.PI * 2; this.ps = .01 + Math.random() * .012;
        this.hue = Math.random() > .7 ? 165 : 185;
    }
    update() { this.x += this.vx; this.y += this.vy; this.ph += this.ps; if (this.x < 20 || this.x > innerWidth - 20) this.vx *= -1; if (this.y < 20 || this.y > innerHeight - 20) this.vy *= -1; }
}
for (let i = 0; i < NODE_COUNT; i++) MOL.push(new MolNode());
function resetMolNodes() { MOL.forEach(n => n.init()); }
const CONNECT_R = 160;
function updateDrawMolecules() {
    const ca = aiInterface.classList.contains('visible');
    for (let i = 0; i < MOL.length; i++) {
        MOL[i].update();
        for (let j = i + 1; j < MOL.length; j++) { const dx = MOL[i].x - MOL[j].x, dy = MOL[i].y - MOL[j].y, d = Math.sqrt(dx * dx + dy * dy); if (d < CONNECT_R && !ca) { const t = d / CONNECT_R; fCtx.save(); fCtx.globalAlpha = (1 - t) * .22; const g = fCtx.createLinearGradient(MOL[i].x, MOL[i].y, MOL[j].x, MOL[j].y); g.addColorStop(0, `hsla(${MOL[i].hue},80%,65%,1)`); g.addColorStop(1, `hsla(${MOL[j].hue},80%,65%,1)`); fCtx.strokeStyle = g; fCtx.lineWidth = .8; fCtx.beginPath(); fCtx.moveTo(MOL[i].x, MOL[i].y); fCtx.lineTo(MOL[j].x, MOL[j].y); fCtx.stroke(); fCtx.restore(); } }
    }
    MOL.forEach(n => { const p = n.a * (.65 + Math.sin(n.ph) * .35); fCtx.save(); fCtx.globalAlpha = ca ? p * .2 : p; fCtx.shadowColor = `hsl(${n.hue},80%,60%)`; fCtx.shadowBlur = 12; fCtx.fillStyle = `hsl(${n.hue},80%,70%)`; fCtx.beginPath(); fCtx.arc(n.x, n.y, n.r, 0, Math.PI * 2); fCtx.fill(); fCtx.restore(); });
}

// ---- Bubbles ----
const BUBBLE_N = 22, BUBBLES = [];
class Bubble {
    constructor(init = false) { this.reset(init); }
    reset(init = false) { this.x = Math.random() * innerWidth; this.y = init ? Math.random() * innerHeight : innerHeight + 40; this.r = Math.random() * 30 + 6; this.vy = -(Math.random() * .38 + .1); this.vx = (Math.random() - .5) * .18; this.a = Math.random() * .055 + .012; this.wb = Math.random() * Math.PI * 2; this.wbs = .006 + Math.random() * .009; this.hue = Math.random() > .5 ? 165 : 180; }
    update() { this.wb += this.wbs; this.x += this.vx + Math.sin(this.wb) * .3; this.y += this.vy; if (this.y + this.r < 0) this.reset(); }
    draw() { const am = Math.max(.2, currentCenterFactor); fCtx.save(); fCtx.globalAlpha = this.a * am; fCtx.strokeStyle = `hsla(${this.hue},70%,65%,.9)`; fCtx.lineWidth = .7; fCtx.beginPath(); fCtx.arc(this.x, this.y, this.r, 0, Math.PI * 2); fCtx.stroke(); const g = fCtx.createRadialGradient(this.x - this.r * .3, this.y - this.r * .3, this.r * .05, this.x, this.y, this.r); g.addColorStop(0, `hsla(${this.hue},70%,75%,.07)`); g.addColorStop(1, `hsla(${this.hue},70%,45%,0)`); fCtx.fillStyle = g; fCtx.beginPath(); fCtx.arc(this.x, this.y, this.r, 0, Math.PI * 2); fCtx.fill(); fCtx.globalAlpha = this.a * .7 * am; fCtx.strokeStyle = 'rgba(255,255,255,1)'; fCtx.lineWidth = .5; fCtx.beginPath(); fCtx.arc(this.x - this.r * .3, this.y - this.r * .3, this.r * .28, .8, 2.4); fCtx.stroke(); fCtx.restore(); }
}
for (let i = 0; i < BUBBLE_N; i++) BUBBLES.push(new Bubble(true));
function resetBubbles() { BUBBLES.forEach(b => b.reset(true)); }
function updateDrawBubbles() { BUBBLES.forEach(b => { b.update(); b.draw(); }); }

// ---- Cursor ----
document.addEventListener('mousemove', e => {
    mouse.x = e.clientX; mouse.y = e.clientY;
    cursorEl.style.left = e.clientX + 'px'; cursorEl.style.top = e.clientY + 'px';
    if (hudCoords) hudCoords.textContent = `X:${String(Math.round(e.clientX)).padStart(4, '0')} Y:${String(Math.round(e.clientY)).padStart(4, '0')}`;
});
function initHoverLogic() { document.querySelectorAll('button,a,nav a,input').forEach(el => { el.addEventListener('mouseenter', () => document.body.classList.add('hov')); el.addEventListener('mouseleave', () => document.body.classList.remove('hov')); }); }
initHoverLogic();

// ---- Clock & Formulas ----
const pad = v => String(v).padStart(2, '0');
function clock() { const n = new Date(); if (liveTimeEl) liveTimeEl.textContent = `${pad(n.getUTCHours())}:${pad(n.getUTCMinutes())}:${pad(n.getUTCSeconds())}`; }
clock(); setInterval(clock, 1000);
const FORMULAS = ['H<sub>2</sub>O', 'NaOH', 'C<sub>8</sub>H<sub>10</sub>N<sub>4</sub>O<sub>2</sub>', 'H<sub>2</sub>SO<sub>4</sub>', 'C<sub>2</sub>H<sub>5</sub>OH', 'C<sub>6</sub>H<sub>6</sub>', 'CH<sub>4</sub>', 'CO<sub>2</sub>'];
let fIdx = 0;
setInterval(() => { if (!formulaEl) return; formulaEl.classList.add('fade'); setTimeout(() => { fIdx = (fIdx + 1) % FORMULAS.length; formulaEl.innerHTML = FORMULAS[fIdx]; formulaEl.classList.remove('fade'); }, 500); }, 3500);
const dots = [0, 1, 2, 3].map(i => document.getElementById(`dot-${i}`)); let dotIdx = 0;
setInterval(() => { dots.forEach((d, i) => { if (d) d.classList.toggle('active', i === dotIdx); }); dotIdx = (dotIdx + 1) % dots.length; }, 2200);