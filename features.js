// ============================================================
//  ChemTech features.js — Panels, Chemicals, Deliveries,
//  Dashboard, Feedback, AI Analytics
// ============================================================
'use strict';
const API = 'http://localhost:5000';
const PROVINCES = ['Punjab', 'KPK', 'Sindh', 'Balochistan'];

function llmProviderField() {
    try {
        const p = (typeof window.getLlmProvider === 'function')
            ? window.getLlmProvider()
            : (localStorage.getItem('chemtech_llm_provider') || 'groq').toLowerCase();
        return { llm_provider: p === 'local' ? 'local' : 'groq' };
    } catch (_) {
        return { llm_provider: 'groq' };
    }
}

// ---- helpers ----
function authBody(extra) {
    const u = window._currentUser;
    const base = llmProviderField();
    if (!u) return { ...base, ...(extra || {}) };
    const b = {};
    if (u.google_id) b.google_id = u.google_id;
    if (u.user_id) b.caller_id = u.user_id;
    return { ...base, ...b, ...(extra || {}) };
}
async function api(path, body) {
    const r = await fetch(API + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const txt = await r.text();
    try {
        return txt ? JSON.parse(txt) : {};
    } catch {
        throw new Error((txt && txt.slice(0, 200)) || `Bad response (${r.status})`);
    }
}

/** POST JSON with AbortSignal timeout (local LLM analytics can run many minutes). */
async function fetchJsonWithTimeout(path, body, timeoutMs) {
    const ctrl = new AbortController();
    const id = setTimeout(() => ctrl.abort(), timeoutMs);
    try {
        const r = await fetch(API + path, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body),
            signal: ctrl.signal
        });
        const txt = await r.text();
        let data;
        try {
            data = txt ? JSON.parse(txt) : {};
        } catch {
            throw new Error((txt && txt.slice(0, 200)) || `Bad response (${r.status})`);
        }
        return data;
    } catch (e) {
        if (e.name === 'AbortError') {
            throw new Error(
                'Request timed out. Local Ollama can be very slow for large analytics—try Groq cloud, a shorter question, or increase timeout in code.'
            );
        }
        throw e;
    } finally {
        clearTimeout(id);
    }
}
function esc2(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
function fmtPKR(n) { return 'PKR ' + (+n).toLocaleString('en-PK', { minimumFractionDigits: 0, maximumFractionDigits: 0 }); }
function fmtDate(s) { return s ? new Date(s).toLocaleDateString('en-PK', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }

// ---- panel system ----
let activePanel = null;
function openPanel(id) {
    ['chemicals-panel', 'delivery-panel', 'dashboard-panel', 'analytics-panel'].forEach(p => {
        const el = document.getElementById(p);
        if (el) { el.classList.remove('visible'); }
    });
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.add('visible');
    activePanel = id;
    const panelEl = document.getElementById('panel');
    if (panelEl) panelEl.classList.add('offscreen');
}
function closePanel() {
    if (activePanel) {
        const el = document.getElementById(activePanel);
        if (el) el.classList.remove('visible');
        activePanel = null;
    }
    const panelEl = document.getElementById('panel');
    if (panelEl) panelEl.classList.remove('offscreen');
}

// ---- nav wiring (runs after login) ----
window.initFeatureNav = function () {
    const u = window._currentUser || currentUser;
    window._currentUser = u;
    const role = u ? u.role : 'user';
    // nav clicks
    const bind = (id, fn) => { const el = document.getElementById(id); if (el) { el.onclick = e => { e.preventDefault(); fn(); }; } };
    bind('nav-chemicals', () => {
        if (window.triggerChemAnim) { window.triggerChemAnim(); loadChemicals('all'); setTimeout(initChemSearch, 150); }
        else { openPanel('chemicals-panel'); loadChemicals('all'); setTimeout(initChemSearch, 150); }
    });
    bind('nav-deliveries', () => {
        if (window.triggerDeliveriesAnim) window.triggerDeliveriesAnim();
        else openPanel('delivery-panel');
        loadDeliveries();
    });
    bind('nav-analytics', () => {
        if (window.triggerAnalyticsAnim) window.triggerAnalyticsAnim();
        else { openPanel('analytics-panel'); initAnalyticsPanel(); }
    });
    bind('nav-dashboard', () => {
        if (window.triggerDashboardAnim) window.triggerDashboardAnim();
        else openPanel('dashboard-panel');
        loadDashboard('all');
    });
    // back buttons
    bind('chemicals-back-btn', () => {
        if (window.triggerChemBackAnim) window.triggerChemBackAnim();
        else closePanel();
    });
    bind('delivery-back-btn', () => {
        if (window.triggerDeliveriesBackAnim) window.triggerDeliveriesBackAnim();
        else closePanel();
    });
    bind('analytics-back-btn', () => {
        if (window.triggerAnalyticsBackAnim) window.triggerAnalyticsBackAnim();
        else closePanel();
    });
    bind('dashboard-back-btn', () => {
        if (window.triggerDashboardBackAnim) window.triggerDashboardBackAnim();
        else closePanel();
    });
    // province tabs
    document.querySelectorAll('#chem-province-tabs .prov-tab').forEach(t => {
        t.onclick = () => {
            document.querySelectorAll('#chem-province-tabs .prov-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active'); loadChemicals(t.dataset.prov);
        };
    });
    document.querySelectorAll('#dash-province-tabs .prov-tab').forEach(t => {
        t.onclick = () => {
            document.querySelectorAll('#dash-province-tabs .prov-tab').forEach(x => x.classList.remove('active'));
            t.classList.add('active'); loadDashboard(t.dataset.prov);
        };
    });
    // add chem button (only shown for admins)
    const acBtn = document.getElementById('add-chem-btn');
    if (acBtn) acBtn.onclick = () => {
        const m = document.getElementById('add-chem-modal');
        if (m) m.classList.remove('hidden');
    };
    const acCancel = document.getElementById('ac-cancel-btn');
    if (acCancel) acCancel.onclick = () => { document.getElementById('add-chem-modal').classList.add('hidden'); };
    const acSubmit = document.getElementById('ac-submit-btn');
    if (acSubmit) acSubmit.onclick = submitAddChemical;
    // order modal
    document.getElementById('order-cancel-btn').onclick = () => document.getElementById('order-modal').classList.add('hidden');
    document.getElementById('order-confirm-btn').onclick = confirmOrder;
    // feedback modal
    document.getElementById('feedback-cancel-btn').onclick = () => document.getElementById('feedback-modal').classList.add('hidden');
    document.getElementById('feedback-submit-btn').onclick = submitFeedback;
    document.getElementById('feedback-voice-btn').onclick = handleVoiceRecord;
    // location modal
    const locConfirm = document.getElementById('location-confirm-btn');
    if (locConfirm) locConfirm.onclick = confirmDeliveryLocation;
    const locCancel = document.getElementById('location-cancel-btn');
    if (locCancel) locCancel.onclick = () => {
        document.getElementById('location-modal').classList.add('hidden');
        if (_locationMap) { _locationMap.remove(); _locationMap = null; }
    };
};

// Hook into existing onLoginSuccess — features.js wraps the global function
// (main.js exposes it as window.onLoginSuccess so this works in global scope)
(function () {
    const _orig = window.onLoginSuccess;
    window.onLoginSuccess = function (user) {
        window._currentUser = user;
        if (_orig) _orig.call(this, user);
        setTimeout(window.initFeatureNav, 200);
    };
})();

// ============================================================
//  CHEMICALS PANEL
// ============================================================
let _chemCache = [];
async function loadChemicals(province) {
    const grid = document.getElementById('chemicals-grid');
    if (!grid) return;
    grid.innerHTML = '<div class="fp-loading">Loading catalog...</div>';
    const body = authBody({ province: province === 'all' ? undefined : province });
    const data = await api('/api/chemicals', body).catch(() => ({ chemicals: [] }));
    _chemCache = data.chemicals || [];
    renderChemicals(_chemCache);
    // Reset search on province change
    const si = document.getElementById('chem-search-input');
    if (si) si.value = '';
    const sc = document.getElementById('chem-search-clear');
    if (sc) sc.classList.add('hidden');
}
function renderChemicals(chems) {
    const grid = document.getElementById('chemicals-grid');
    if (!chems.length) { grid.innerHTML = '<div class="fp-loading">No chemicals found.</div>'; return; }
    grid.innerHTML = chems.map(c => {
        const low = c.amount_kg < 50;
        return `<div class="chem-card">
      <div class="card-glare"></div>
      <div class="chem-card-banner chem-cat-${(c.category||'General').toLowerCase()}"></div>
      <div class="chem-card-header">
        <div><div class="chem-name">${esc2(c.name)}</div>
          <div class="chem-category">${esc2(c.category)}</div>
          <div class="chem-province">${esc2(c.province)}</div>
        </div>
        <span class="chem-formula">${esc2(c.formula || '—')}</span>
      </div>
      <div class="chem-desc">${esc2(c.description || '—')}</div>
      <div class="chem-stats">
        <div class="chem-stat"><div class="chem-stat-label">Stock</div>
          <div class="chem-stat-value ${low ? 'low' : ''}">${(+c.amount_kg).toFixed(1)} kg${low ? ' ⚠' : ''}</div></div>
        <div class="chem-stat"><div class="chem-stat-label">Concentration</div>
          <div class="chem-stat-value">${(+c.concentration_pct).toFixed(1)}%</div></div>
        <div class="chem-stat"><div class="chem-stat-label">Price/kg</div>
          <div class="chem-stat-value price">PKR ${(+c.price_per_kg).toFixed(0)}</div></div>
        <div class="chem-stat"><div class="chem-stat-label">Sold</div>
          <div class="chem-stat-value">${(+c.quantity_sold).toFixed(1)} kg</div></div>
      </div>
      <div class="chem-card-footer">
        <button class="chem-order-btn" onclick="openOrderModal(${c.id})" ${c.amount_kg <= 0 ? 'disabled' : ''}>
          ${c.amount_kg <= 0 ? 'Out of Stock' : 'Order Now'}
        </button>
      </div>
    </div>`;
    }).join('');
    // Attach 3D tilt after DOM is updated
    requestAnimationFrame(init3DCardTilt);
}

function init3DCardTilt() {
    const MAX_TILT = 14;   // degrees
    const cards = document.querySelectorAll('#chemicals-grid .chem-card');
    cards.forEach(card => {
        // Avoid double-binding
        if (card._tiltBound) return;
        card._tiltBound = true;

        const glare = card.querySelector('.card-glare');

        card.addEventListener('mousemove', e => {
            const rect = card.getBoundingClientRect();
            const x = e.clientX - rect.left;   // 0 → width
            const y = e.clientY - rect.top;    // 0 → height
            const cx = rect.width / 2;
            const cy = rect.height / 2;

            // Normalised -1 → +1
            const nx = (x - cx) / cx;
            const ny = (y - cy) / cy;

            const rotY =  nx * MAX_TILT;
            const rotX = -ny * MAX_TILT;

            card.style.transform =
                `perspective(900px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale3d(1.04,1.04,1.04) translateZ(8px)`;

            // Move the glare highlight with the cursor
            if (glare) {
                const gx = Math.round(x / rect.width  * 100);
                const gy = Math.round(y / rect.height * 100);
                glare.style.background =
                    `radial-gradient(circle at ${gx}% ${gy}%, rgba(255,255,255,0.11) 0%, transparent 65%)`;
            }
        });

        card.addEventListener('mouseleave', () => {
            card.style.transform = '';
            if (glare) glare.style.background = '';
        });
    });
}

function initChemSearch() {
    const input = document.getElementById('chem-search-input');
    const clearBtn = document.getElementById('chem-search-clear');
    if (!input || input._searchBound) return;
    input._searchBound = true;
    input.addEventListener('input', () => {
        const q = input.value.toLowerCase().trim();
        if (clearBtn) { q ? clearBtn.classList.remove('hidden') : clearBtn.classList.add('hidden'); }
        if (!q) { renderChemicals(_chemCache); return; }
        renderChemicals(_chemCache.filter(c =>
            (c.name||'').toLowerCase().includes(q) ||
            (c.formula||'').toLowerCase().includes(q) ||
            (c.category||'').toLowerCase().includes(q) ||
            (c.province||'').toLowerCase().includes(q) ||
            (c.description||'').toLowerCase().includes(q)
        ));
    });
    if (clearBtn) clearBtn.onclick = () => {
        input.value = ''; clearBtn.classList.add('hidden'); renderChemicals(_chemCache);
    };
}
window.openOrderModal = function (chemId) {
    const c = _chemCache.find(x => x.id === chemId); if (!c) return;
    document.getElementById('order-modal-title').textContent = 'Order: ' + c.name;
    document.getElementById('order-modal-info').textContent =
        `${c.province} · ${c.formula} · PKR ${(+c.price_per_kg).toFixed(0)}/kg · ${(+c.amount_kg).toFixed(1)} kg available`;
    document.getElementById('order-qty').value = '';
    document.getElementById('order-notes').value = '';
    document.getElementById('order-modal').dataset.chemId = chemId;
    const u = window._currentUser;
    // Show assign-user section for regional admins
    const assignSection = document.getElementById('assign-user-section');
    if (assignSection && u && u.role === 'regional_admin') {
        assignSection.classList.remove('hidden');
        loadUsersForAssignment();
    } else if (assignSection) {
        assignSection.classList.add('hidden');
    }
    // Show location picker section for regional admins
    const locSection = document.getElementById('order-location-section');
    if (locSection && u && u.role === 'regional_admin') {
        locSection.classList.remove('hidden');
        // Reset any pending location
        _pendingLat = null; _pendingLng = null; _pendingLocationName = '';
        const display = document.getElementById('order-location-display');
        if (display) display.textContent = 'No location pinned yet';
    } else if (locSection) {
        locSection.classList.add('hidden');
    }
    document.getElementById('order-modal').classList.remove('hidden');
};
async function loadUsersForAssignment() {
    const select = document.getElementById('assign-user-select');
    if (!select) return;
    select.innerHTML = '<option value="">Loading users…</option>';
    const data = await api('/api/users/list-delivery-targets', authBody()).catch(() => ({ users: [] }));
    const users = data.users || [];
    if (!users.length) { select.innerHTML = '<option value="">No users available</option>'; return; }
    select.innerHTML = '<option value="">Select user to assign…</option>' +
        users.map(u => `<option value="${u.user_id}">${esc2(u.name || u.username)}</option>`).join('');
}
async function confirmOrder() {
    const modal = document.getElementById('order-modal');
    const chemId = modal.dataset.chemId;
    const qty = parseFloat(document.getElementById('order-qty').value);
    const notes = document.getElementById('order-notes').value;
    if (!qty || qty <= 0) { showToast('Enter a valid quantity.', 'error'); return; }
    const u = window._currentUser;
    let extraBody = {};
    if (u && u.role === 'regional_admin') {
        const assignedUserId = document.getElementById('assign-user-select')?.value;
        if (!assignedUserId) { showToast('Please select a user to assign this delivery to.', 'error'); return; }
        extraBody.assigned_user_id = +assignedUserId;
    }
    const body = authBody({ chemical_id: +chemId, quantity_kg: qty, notes, ...extraBody });
    const data = await api('/api/deliveries/create', body).catch(() => ({ success: false, error: 'Network error' }));
    if (data.success) {
        modal.classList.add('hidden');
        // If regional admin pinned a location, save it now with the new delivery id
        if (_pendingLat !== null && _pendingLng !== null && data.delivery?.id) {
            const locBody = authBody({ delivery_id: data.delivery.id, lat: _pendingLat, lng: _pendingLng, location_name: _pendingLocationName });
            await api('/api/deliveries/set-location', locBody).catch(() => {});
            _pendingLat = null; _pendingLng = null; _pendingLocationName = '';
        }
        showToast(`✓ Order placed! Tracking: ${data.tracking_code}`, 'success');
        loadChemicals('all');
    } else {
        showToast(data.error || 'Order failed.', 'error');
    }
}

// ============================================================
//  DELIVERY TRACKER
// ============================================================
const STATUS_STEPS = ['ordered', 'processing', 'in_transit', 'delivered'];
const STATUS_LABELS = ['Ordered', 'Processing', 'In Transit', 'Delivered'];
let _deliveriesCache = [];
window._deliveryMaps = window._deliveryMaps || {};

function _destroyDeliveryMaps() {
    if (!window._deliveryMaps) return;
    Object.keys(window._deliveryMaps).forEach(k => {
        try { window._deliveryMaps[k].remove(); } catch (_) { /* already gone */ }
        delete window._deliveryMaps[k];
    });
}

function haversineKm(lat1, lon1, lat2, lon2) {
    const R = 6371;
    const toR = x => (x * Math.PI) / 180;
    const dLat = toR(lat2 - lat1);
    const dLon = toR(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toR(lat1)) * Math.cos(toR(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

async function loadDeliveries() {
    const list = document.getElementById('deliveries-list');
    if (!list) return;
    _destroyDeliveryMaps();
    list.innerHTML = '<div class="fp-loading">Loading deliveries...</div>';
    const data = await api('/api/deliveries', authBody()).catch(() => ({ deliveries: [] }));
    const deliveries = data.deliveries || [];
    _deliveriesCache = deliveries;
    if (!deliveries.length) { list.innerHTML = '<div class="fp-empty">No deliveries yet. Order chemicals to get started.</div>'; return; }
    list.innerHTML = deliveries.map(d => renderDeliveryCard(d)).join('');
    // Initialise Leaflet maps for deliveries with a location set
    deliveries.forEach(d => { if (d.delivery_lat && d.delivery_lng) initDeliveryMap(d); });
}
// Expose loadDeliveries globally so navigation hooks can always call it directly
window.loadDeliveries = loadDeliveries;
function renderDeliveryCard(d) {
    const stepIdx = STATUS_STEPS.indexOf(d.status);
    const isAdmin = window._currentUser && window._currentUser.role === 'admin';
    const isRegAdmin = window._currentUser && window._currentUser.role === 'regional_admin';
    const isOwner = window._currentUser && window._currentUser.user_id === d.user_id;
    const fill = Math.round((stepIdx / (STATUS_STEPS.length - 1)) * 100);
    const nodes = STATUS_STEPS.map((s, i) => {
        const cls = i < stepIdx ? 'done' : i === stepIdx ? 'current' : '';
        return `<div class="progress-node ${cls}"></div>${i < STATUS_STEPS.length - 1 ? '<div class="progress-line"><div class="progress-line-fill" style="width:' + ((i < stepIdx ? 100 : i === stepIdx ? 50 : 0)) + '%"></div></div>' : ''}`;
    }).join('');
    const labels = STATUS_STEPS.map((s, i) => {
        const cls = i < stepIdx ? 'done' : i === stepIdx ? 'current' : '';
        return `<span class="progress-label-item ${cls}">${STATUS_LABELS[i]}</span>`;
    }).join('');
    const canAdvance = isAdmin || isRegAdmin || isOwner;
    const advanceBtn = (canAdvance && stepIdx < STATUS_STEPS.length - 1) ?
        `<button class="delivery-advance-btn" onclick="advanceDelivery(${d.id},'${STATUS_STEPS[stepIdx + 1]}')">Advance → ${STATUS_LABELS[stepIdx + 1]}</button>` : '';
    const feedbackBtn = (d.status === 'delivered') ?
        `<button class="delivery-feedback-btn" onclick="openFeedbackModal(${d.id})">Leave Feedback</button>` : '';
    // Location map section (standard users get GPS / routing toolbar)
    const hasLoc = d.delivery_lat && d.delivery_lng;
    const showUserGps = hasLoc && window._currentUser && window._currentUser.role === 'user';
    const mapElClass = showUserGps ? 'delivery-map delivery-map--live' : 'delivery-map';
    const mapToolbar = showUserGps ? `
        <div class="delivery-map-toolbar">
            <button type="button" class="delivery-map-btn primary" onclick="trackDeliveryFromMe(${d.id})">Use my GPS &amp; route</button>
            <button type="button" class="delivery-map-btn share-loc-btn" onclick="openShareLocationModal(${d.id})">&#x1F4E4; Share Location</button>
            <button type="button" class="delivery-map-btn ghost" onclick="clearMyDeliveryRoute(${d.id})">Reset map</button>
        </div>
        <p class="delivery-map-gps-hint">Your location is estimated from your network. For greater accuracy, tap the map and choose <strong>Use this as my location</strong>.</p>
        <div class="delivery-route-meta" id="route-meta-${d.id}"></div>` : '';
    const mapSection = hasLoc ? `
        <div class="delivery-map-wrap${showUserGps ? ' delivery-map-wrap--interactive' : ''}">
            <div class="delivery-map-label">📍 Delivery Location: <strong>${esc2(d.delivery_location_name || 'Pakistan')}</strong></div>
            ${mapToolbar}
            <div id="dmap-${d.id}" class="${mapElClass}"></div>
        </div>` : '';
    return `<div class="delivery-card" id="dcard-${d.id}">
    <div class="delivery-card-top">
      <div><div class="delivery-chem">${esc2(d.chem_name || d.chemical_id)}</div>
        <div class="delivery-track">${esc2(d.tracking_code || '—')}</div>
        <div class="delivery-meta">${(+d.quantity_kg).toFixed(1)} kg · ${esc2(d.province)} · ${fmtDate(d.created_at)}</div>
      </div>
      <span class="delivery-status-badge ${d.status}">${d.status.replace('_', ' ')}</span>
    </div>
    <div class="delivery-progress">
      <div class="progress-track">${nodes}</div>
      <div class="progress-labels">${labels}</div>
    </div>
    ${mapSection}
    <div class="delivery-actions">${advanceBtn}${feedbackBtn}</div>
  </div>`;
}
function initDeliveryMap(d) {
    setTimeout(() => {
        if (!window.L) return;
        const mapEl = document.getElementById('dmap-' + d.id);
        if (!mapEl || mapEl._leaflet_id) return;
        const isUser = window._currentUser && window._currentUser.role === 'user';
        const map = L.map('dmap-' + d.id, {
            zoomControl: true,
            scrollWheelZoom: !!isUser,
            doubleClickZoom: true,
            boxZoom: true,
            keyboard: true
        }).setView([d.delivery_lat, d.delivery_lng], 12);
        L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OSM &copy; CARTO · Routing via OSRM demo',
            subdomains: 'abcd',
            maxZoom: 20
        }).addTo(map);
        const icon = L.divIcon({
            className: '',
            html: `<div style="width:14px;height:14px;background:var(--accent);border:2px solid white;border-radius:50%;box-shadow:0 0 8px rgba(0,230,195,0.6);"></div>`,
            iconSize: [14, 14], iconAnchor: [7, 7]
        });
        const deliveryMarker = L.marker([d.delivery_lat, d.delivery_lng], { icon })
            .addTo(map)
            .bindPopup(`<strong>${esc2(d.delivery_location_name || 'Delivery Location')}</strong><br><span style="opacity:.75;font-size:11px;">Drag map · scroll to zoom</span>`);
        if (!isUser) deliveryMarker.openPopup();

        map._routeLayers = L.layerGroup().addTo(map);
        map._deliveryLat = d.delivery_lat;
        map._deliveryLng = d.delivery_lng;
        window._deliveryMaps[d.id] = map;

        if (isUser) {
            L.control.scale({ metric: true, imperial: false }).addTo(map);
            map.on('click', ev => {
                const lat = ev.latlng.lat;
                const lng = ev.latlng.lng;
                const id = d.id;
                L.popup()
                    .setLatLng(ev.latlng)
                    .setContent(
                        `<div style="min-width:200px;font-family:inherit;font-size:13px;">
              <strong>Map</strong><br>
              <span style="opacity:.85">${lat.toFixed(5)}, ${lng.toFixed(5)}</span>
              <button type="button" class="delivery-map-btn primary" style="margin-top:10px;width:100%;box-sizing:border-box"
                onclick="window.setDeliveryRouteFromMapPick(${id}, ${lat}, ${lng})">Use this as my location</button>
            </div>`
                    )
                    .openOn(map);
            });
        }
    }, 350);
}

/** Geolocation with retries — high accuracy first often times out on desktop / Electron. */
function geoGetOnce(options) {
    return new Promise((resolve, reject) => {
        navigator.geolocation.getCurrentPosition(resolve, reject, options);
    });
}

function geoErrorMessage(err) {
    const code = err && err.code;
    if (code === 1) {
        return 'Location permission denied. Allow location for this page, and in Windows: Settings → Privacy → Location (turn on + allow desktop apps).';
    }
    if (code === 2) {
        return 'Location unavailable. Enable Windows Location services and try again.';
    }
    if (code === 3) {
        return 'Location timed out. Try again; Wi‑Fi on helps even without GPS.';
    }
    return 'Could not read your location.';
}

/**
 * Try several Chromium strategies: low-accuracy + cached fix usually works on laptops;
 * then fresh low-accuracy; then high-accuracy. Stops early on permission denied.
 * @param {(attemptIndex: number, total: number) => void} [onAttempt]
 */
async function geoGetBestPosition(onAttempt) {
    const attempts = [
        { enableHighAccuracy: false, timeout: 32000, maximumAge: 300000 },
        { enableHighAccuracy: false, timeout: 45000, maximumAge: 0 },
        { enableHighAccuracy: true, timeout: 40000, maximumAge: 120000 },
    ];
    const total = attempts.length;
    let lastErr = null;
    for (let i = 0; i < attempts.length; i++) {
        if (typeof onAttempt === 'function') onAttempt(i, total);
        try {
            return await geoGetOnce(attempts[i]);
        } catch (e) {
            lastErr = e;
            if (e && e.code === 1) break;
        }
    }
    throw lastErr;
}

/**
 * Approximate lat/lng from the client’s public IP (no GPS).
 * Used when Chromium geolocation fails on Windows / Electron despite OS permissions.
 */
async function fetchApproxCoordinatesByIp() {
    const parsers = [
        async () => {
            const r = await fetch('https://get.geojs.io/v1/ip/geo.json', { cache: 'no-store' });
            if (!r.ok) return null;
            const j = await r.json();
            const lat = parseFloat(j.latitude);
            const lng = parseFloat(j.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            if (Math.abs(lat) < 1e-6 && Math.abs(lng) < 1e-6) return null;
            return { lat, lng };
        },
        async () => {
            const r = await fetch('https://ipapi.co/json/', { cache: 'no-store' });
            if (!r.ok) return null;
            const j = await r.json();
            if (j.error) return null;
            const lat = parseFloat(j.latitude);
            const lng = parseFloat(j.longitude);
            if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
            return { lat, lng };
        },
    ];
    for (const parse of parsers) {
        try {
            const v = await parse();
            if (v) return v;
        } catch (e) {
            console.warn('IP-based location lookup failed', e);
        }
    }
    return null;
}

/**
 * Draw user marker + OSRM route (or straight line) from (uLat,uLng) to delivery pin.
 * @param {string} [source] 'gps' | 'network' | 'map' — shown in route meta when not gps
 */
async function drawDeliveryRouteFromUserPoint(map, d, meta, uLat, uLng, source) {
    map._userLat = uLat;
    map._userLng = uLng;
    map._routeLayers.clearLayers();
    const userIcon = L.divIcon({
        className: '',
        html: '<div style="width:16px;height:16px;background:#3b82f6;border:2px solid #fff;border-radius:50%;box-shadow:0 0 10px rgba(59,130,246,.5);"></div>',
        iconSize: [16, 16],
        iconAnchor: [8, 8]
    });
    const popLabel = source === 'network' ? 'Approx. (network)' : source === 'map' ? 'Your pick' : 'You are here';
    L.marker([uLat, uLng], { icon: userIcon })
        .bindPopup(`<strong>${popLabel}</strong>`)
        .addTo(map._routeLayers);

    let routed = false;
    try {
        const url =
            'https://router.project-osrm.org/route/v1/driving/' +
            `${uLng},${uLat};${d.delivery_lng},${d.delivery_lat}?overview=full&geometries=geojson`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.routes && json.routes[0] && json.routes[0].geometry) {
            L.geoJSON(json.routes[0].geometry, {
                style: { color: '#00e6c3', weight: 4, opacity: 0.88 }
            }).addTo(map._routeLayers);
            const km = (json.routes[0].distance / 1000).toFixed(1);
            const min = Math.round(json.routes[0].duration / 60);
            const prefix =
                source === 'network'
                    ? 'Approx. area (IP) · '
                    : source === 'map'
                      ? 'From map · '
                      : '';
            if (meta) meta.textContent = `${prefix}~${km} km by road · ~${min} min driving (estimate)`;
            routed = true;
        }
    } catch (e) {
        console.warn('OSRM route failed', e);
    }
    if (!routed) {
        const km = haversineKm(uLat, uLng, d.delivery_lat, d.delivery_lng);
        L.polyline(
            [
                [uLat, uLng],
                [d.delivery_lat, d.delivery_lng]
            ],
            { color: '#60a5fa', weight: 3, dashArray: '8 6', opacity: 0.9 }
        ).addTo(map._routeLayers);
        if (meta) {
            const prefix =
                source === 'network'
                    ? 'Approx. (IP) · '
                    : source === 'map'
                      ? 'From map · '
                      : '';
            meta.textContent = `${prefix}Straight line ~${km.toFixed(1)} km. Use “Google Maps directions” for turn-by-turn.`;
        }
    }
    map.fitBounds(L.latLngBounds([[uLat, uLng], [d.delivery_lat, d.delivery_lng]]), { padding: [40, 40], maxZoom: 14 });
}

/** After choosing a point on the map (popup action). */
window.setDeliveryRouteFromMapPick = function (deliveryId, lat, lng) {
    const map = window._deliveryMaps && window._deliveryMaps[deliveryId];
    const d = _deliveriesCache.find(x => x.id === deliveryId);
    const meta = document.getElementById('route-meta-' + deliveryId);
    if (!map || !d || d.delivery_lat == null) return;
    const uLat = +lat;
    const uLng = +lng;
    if (!Number.isFinite(uLat) || !Number.isFinite(uLng)) return;
    try {
        map.closePopup();
    } catch (_) {}
    if (meta) meta.textContent = '';
    void (async () => {
        await drawDeliveryRouteFromUserPoint(map, d, meta, uLat, uLng, 'map');
        showToast('Route drawn from your map point.', 'success');
    })();
};

/** Standard users: network (IP-based) location + road route (OSRM) or straight-line fallback, relative to delivery pin. */
window.trackDeliveryFromMe = function (deliveryId) {
    const map = window._deliveryMaps && window._deliveryMaps[deliveryId];
    const d = _deliveriesCache.find(x => x.id === deliveryId);
    const meta = document.getElementById('route-meta-' + deliveryId);
    if (!map || !d || d.delivery_lat == null) {
        showToast('Map not ready.', 'error');
        return;
    }
    if (meta) meta.textContent = 'Detecting your network location…';

    (async () => {
        const ip = await fetchApproxCoordinatesByIp();
        if (ip) {
            showToast('Using your approximate network location.', 'info');
            await drawDeliveryRouteFromUserPoint(map, d, meta, ip.lat, ip.lng, 'network');
        } else {
            if (meta) meta.textContent = '';
            showToast(
                'Could not detect network location. Tap the map where you are, then "Use this as my location".',
                'error'
            );
        }
    })();
};

/** Build a Google Maps URL for the delivery pin (with optional user origin). */
function buildGoogleMapsUrl(deliveryId) {
    const d = _deliveriesCache.find(x => x.id === deliveryId);
    if (!d || d.delivery_lat == null) return null;
    const map = window._deliveryMaps && window._deliveryMaps[deliveryId];
    let url = `https://www.google.com/maps/search/?api=1&query=${d.delivery_lat},${d.delivery_lng}`;
    if (map && map._userLat != null && map._userLng != null) {
        url = `https://www.google.com/maps/dir/?api=1&origin=${map._userLat},${map._userLng}&destination=${d.delivery_lat},${d.delivery_lng}`;
    }
    return url;
}

window.openShareLocationModal = function (deliveryId) {
    const d = _deliveriesCache.find(x => x.id === deliveryId);
    if (!d || d.delivery_lat == null) {
        showToast('No delivery location set.', 'error');
        return;
    }
    const url = buildGoogleMapsUrl(deliveryId);
    const locationName = d.delivery_location_name || 'Delivery Location';
    const trackingCode = d.tracking_code || '';
    const shareText = `📍 Track my delivery (${trackingCode}) at: ${locationName}\n${url}`;

    // Populate modal
    document.getElementById('slm-location-name').textContent = locationName;
    document.getElementById('slm-tracking').textContent = trackingCode ? `#${trackingCode}` : '';
    document.getElementById('slm-link-input').value = url;

    // WhatsApp
    document.getElementById('slm-whatsapp-btn').onclick = () => {
        const waUrl = `https://wa.me/?text=${encodeURIComponent(shareText)}`;
        window.open(waUrl, '_blank', 'noopener,noreferrer');
    };

    // Gmail
    document.getElementById('slm-gmail-btn').onclick = () => {
        const subject = encodeURIComponent(`Delivery Location: ${locationName}`);
        const body = encodeURIComponent(shareText);
        window.open(`https://mail.google.com/mail/?view=cm&fs=1&su=${subject}&body=${body}`, '_blank', 'noopener,noreferrer');
    };

    // SMS
    document.getElementById('slm-sms-btn').onclick = () => {
        window.open(`sms:?body=${encodeURIComponent(shareText)}`, '_self');
    };

    // Telegram
    document.getElementById('slm-telegram-btn').onclick = () => {
        window.open(`https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(`📍 ${locationName} (${trackingCode})`)}`, '_blank', 'noopener,noreferrer');
    };

    // Copy link
    document.getElementById('slm-copy-btn').onclick = async () => {
        try {
            await navigator.clipboard.writeText(url);
            showToast('✓ Link copied!', 'success');
        } catch {
            document.getElementById('slm-link-input').select();
            document.execCommand('copy');
            showToast('✓ Link copied!', 'success');
        }
    };

    // Native share (mobile/desktop browsers that support it)
    const nativeBtn = document.getElementById('slm-native-btn');
    if (navigator.share) {
        nativeBtn.classList.remove('hidden');
        nativeBtn.onclick = () => {
            navigator.share({ title: `Delivery: ${locationName}`, text: shareText, url })
                .catch(() => {});
        };
    } else {
        nativeBtn.classList.add('hidden');
    }

    // Open Modal
    document.getElementById('share-location-modal').classList.remove('hidden');
};

window.closeShareLocationModal = function () {
    document.getElementById('share-location-modal').classList.add('hidden');
};

window.clearMyDeliveryRoute = function (deliveryId) {
    const map = window._deliveryMaps && window._deliveryMaps[deliveryId];
    const d = _deliveriesCache.find(x => x.id === deliveryId);
    const meta = document.getElementById('route-meta-' + deliveryId);
    if (!map || !d) return;
    if (map._routeLayers) map._routeLayers.clearLayers();
    map._userLat = null;
    map._userLng = null;
    if (meta) meta.textContent = '';
    map.setView([d.delivery_lat, d.delivery_lng], 12);
};
window.advanceDelivery = async function (id, status) {
    const body = authBody({ delivery_id: id, status });
    const data = await api('/api/deliveries/update-status', body).catch(() => ({ success: false }));
    if (data.success) {
        showToast(`Delivery advanced to ${status.replace('_', ' ')}.`, 'success');
        if (status === 'delivered' && typeof window.chemtechCelebrationDelivered === 'function') {
            window.chemtechCelebrationDelivered();
        }
        loadDeliveries();
    } else showToast(data.error || 'Failed.', 'error');
};

// ============================================================
//  FEEDBACK + SENTIMENT
// ============================================================
let _voiceTranscript = '';
window.openFeedbackModal = function (deliveryId) {
    document.getElementById('feedback-delivery-id').value = deliveryId;
    document.getElementById('feedback-text').value = '';
    document.getElementById('feedback-voice-status').textContent = '';
    document.getElementById('feedback-sentiment-result').className = 'sentiment-result hidden';
    document.getElementById('feedback-modal').classList.remove('hidden');
    _voiceTranscript = '';
};
async function submitFeedback() {
    const deliveryId = document.getElementById('feedback-delivery-id').value;
    const text = (document.getElementById('feedback-text').value || '').trim() || _voiceTranscript;
    if (!text) { showToast('Please enter feedback text or record voice.', 'error'); return; }
    const btn = document.getElementById('feedback-submit-btn');
    btn.textContent = 'Analyzing...'; btn.disabled = true;
    const body = authBody({ delivery_id: +deliveryId, text_feedback: text });
    const data = await api('/api/feedback/submit', body).catch(() => ({ success: false }));
    btn.textContent = 'Submit Feedback'; btn.disabled = false;
    if (!data.success) { showToast(data.error || 'Submission failed.', 'error'); return; }
    if (data.llm_notice) showToast(data.llm_notice, 'info');
    const s = data.sentiment;
    const lbl = (s.label || 'neutral').toLowerCase();
    const resultEl = document.getElementById('feedback-sentiment-result');
    resultEl.className = `sentiment-result ${lbl}`;
    resultEl.innerHTML = `<div class="sentiment-label-text">${s.label} Sentiment</div>
      <div class="sentiment-score-bar"><div class="sentiment-score-fill" style="width:${Math.round(s.score * 100)}%"></div></div>
      <div class="sentiment-justification">${esc2(s.justification)}</div>`;
    showToast(`Feedback recorded — ${s.label} (${Math.round(s.score * 100)}%)`, 'success');
    setTimeout(() => {
        document.getElementById('feedback-modal').classList.add('hidden');
        loadDeliveries();
    }, 3000);
}
function handleVoiceRecord() {
    const Rec = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Rec) { showToast('Voice not supported in this browser.', 'warning'); return; }
    const btn = document.getElementById('feedback-voice-btn');
    const status = document.getElementById('feedback-voice-status');
    if (btn.classList.contains('recording')) { if (window._feedbackRec) window._feedbackRec.stop(); return; }
    const rec = new Rec(); rec.lang = 'en-US'; rec.interimResults = false;
    rec.onstart = () => { btn.classList.add('recording'); btn.textContent = '⏹ Stop'; status.textContent = 'Recording…'; };
    rec.onend = () => { btn.classList.remove('recording'); btn.textContent = '🎙 Record Voice'; };
    rec.onresult = e => {
        _voiceTranscript = e.results[0][0].transcript;
        document.getElementById('feedback-text').value = _voiceTranscript;
        status.textContent = '✓ Transcribed';
    };
    rec.onerror = () => { status.textContent = 'Error. Please type instead.'; };
    window._feedbackRec = rec; rec.start();
}

// ============================================================
//  ADMIN DASHBOARD
// ============================================================
let _dashProvince = 'all';
async function loadDashboard(province) {
    _dashProvince = province;
    const cardsEl = document.getElementById('dashboard-cards');
    if (cardsEl) cardsEl.innerHTML = '<div class="fp-loading">Loading analytics...</div>';
    const anData = await api('/api/analytics/regional', authBody()).catch(() => ({ analytics: {} }));
    const analytics = anData.analytics || {};
    renderDashCards(analytics, province);
    loadDashboardChemicals(province);
    loadDashboardDeliveries(province);
    loadDashboardFeedback(province);
}
function renderDashCards(analytics, province) {
    const cardsEl = document.getElementById('dashboard-cards');
    if (!cardsEl) return;
    let pArr = province === 'all' ? PROVINCES : [province];
    let rev = 0, qty = 0, totalDel = 0, feedbackCount = 0, sentSum = 0, chemCount = 0;
    pArr.forEach(p => {
        const a = analytics[p] || {};
        rev += a.total_revenue || 0; qty += a.total_quantity_kg || 0;
        totalDel += a.total_deliveries || 0; feedbackCount += a.total_feedback || 0;
        if (a.avg_sentiment && a.total_feedback) { sentSum += a.avg_sentiment * (a.total_feedback); } chemCount += a.chemical_count || 0;
    });
    const avgSent = feedbackCount > 0 ? sentSum / feedbackCount : 0;
    const sentLabel = avgSent >= 0.6 ? 'Positive' : avgSent >= 0.4 ? 'Neutral' : 'Negative';
    cardsEl.innerHTML = `
    <div class="dash-card revenue"><div class="dash-card-label">Total Revenue</div>
      <div class="dash-card-value">${fmtPKR(rev)}</div>
      <div class="dash-card-sub">${qty.toFixed(0)} kg sold</div></div>
    <div class="dash-card deliveries"><div class="dash-card-label">Total Deliveries</div>
      <div class="dash-card-value">${totalDel}</div>
      <div class="dash-card-sub">${pArr.length} province${pArr.length > 1 ? 's' : ''}</div></div>
    <div class="dash-card sentiment"><div class="dash-card-label">Avg Sentiment</div>
      <div class="dash-card-value">${(avgSent * 100).toFixed(0)}%</div>
      <div class="dash-card-sub">${sentLabel} · ${feedbackCount} reviews</div></div>
    <div class="dash-card chemicals"><div class="dash-card-label">Chemicals</div>
      <div class="dash-card-value">${chemCount}</div>
      <div class="dash-card-sub">Active catalog items</div></div>`;
}
async function loadDashboardChemicals(province) {
    const chartEl = document.getElementById('dash-chemicals-chart');
    const tableEl = document.getElementById('dash-chemicals-table');
    if (!chartEl) return;
    chartEl.innerHTML = '<div class="fp-loading">Loading...</div>';
    if (tableEl) tableEl.innerHTML = '<div class="fp-loading">Loading...</div>';
    const body = authBody({ province: province === 'all' ? undefined : province });
    const data = await api('/api/chemicals', body).catch(() => ({ chemicals: [] }));
    const chems = data.chemicals || [];
    const u = window._currentUser;
    const isAdmin = u && u.role === 'admin';
    // show/hide add button — only for admins
    const addBtn = document.getElementById('add-chem-btn');
    if (addBtn) addBtn.style.display = isAdmin ? '' : 'none';
    if (!chems.length) {
        chartEl.innerHTML = '<div class="fp-loading">No chemicals.</div>';
        if (tableEl) tableEl.innerHTML = '<div class="fp-loading">No chemicals.</div>';
        return;
    }
    // ── Chart: stock levels horizontal bar ───────────────────
    const chartId = 'dcc-' + Date.now();
    chartEl.innerHTML = `<div style="position:relative;height:320px;padding:16px 16px 8px;"><canvas id="${chartId}"></canvas></div>`;
    setTimeout(() => {
        const ctx = document.getElementById(chartId);
        if (!ctx) return;
        const sorted = [...chems].sort((a, b) => b.amount_kg - a.amount_kg).slice(0, 12);
        const inst = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: sorted.map(c => c.name),
                datasets: [{
                    label: 'Stock (kg)',
                    data: sorted.map(c => +c.amount_kg),
                    backgroundColor: sorted.map(c => c.amount_kg < 50 ? 'rgba(244,63,94,0.22)' : 'rgba(0,230,195,0.15)'),
                    borderColor: sorted.map(c => c.amount_kg < 50 ? 'rgba(244,63,94,0.9)' : 'rgba(0,230,195,0.7)'),
                    borderWidth: 1.5, borderRadius: 6
                }]
            },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.raw + ' kg' + (c.raw < 50 ? ' ⚠ LOW' : '') } } },
                scales: {
                    x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => v + 'kg' } },
                    y: { grid: { display: false }, ticks: { color: TICK_COLOR, font: { size: 10 } } }
                }
            }
        });
        _chartInstances.push(inst);
    }, 80);
    // ── Detail table (hidden until toggled) ─────────────────
    if (tableEl) {
        if (isAdmin) {
            tableEl.innerHTML = `<table class="dash-table"><thead><tr>
              <th>Name</th><th>Formula</th><th>Province</th><th>Stock (kg)</th>
              <th>Conc%</th><th>Price/kg</th><th>Sold (kg)</th><th>Actions</th></tr></thead>
              <tbody>${chems.map(c => `<tr>
                <td>${esc2(c.name)}</td>
                <td class="mono accent">${esc2(c.formula || '—')}</td>
                <td class="mono">${esc2(c.province)}</td>
                <td class="mono ${c.amount_kg < 50 ? 'text-danger' : ''}">${(+c.amount_kg).toFixed(1)}</td>
                <td class="mono">${(+c.concentration_pct).toFixed(1)}</td>
                <td class="gold">PKR ${(+c.price_per_kg).toFixed(0)}</td>
                <td class="mono">${(+c.quantity_sold).toFixed(1)}</td>
                <td><div class="table-actions">
                  <input type="number" id="qty-${c.id}" value="${c.amount_kg}" min="0" step="0.1" style="width:80px">
                  <button class="admin-btn approve" onclick="updateChemQty(${c.id})">Save</button>
                  <button class="admin-btn deny" onclick="removeChemical(${c.id},'${esc2(c.name)}')">Remove</button>
                </div></td></tr>`).join('')}
              </tbody></table>`;
        } else {
            // Regional admin: read-only, no inputs or action buttons
            tableEl.innerHTML = `<div class="read-only-notice">👁 View Only — only Admins can edit chemical data</div>
              <table class="dash-table"><thead><tr>
              <th>Name</th><th>Formula</th><th>Province</th><th>Stock (kg)</th>
              <th>Conc%</th><th>Price/kg</th><th>Sold (kg)</th></tr></thead>
              <tbody>${chems.map(c => `<tr>
                <td>${esc2(c.name)}</td>
                <td class="mono accent">${esc2(c.formula || '—')}</td>
                <td class="mono">${esc2(c.province)}</td>
                <td class="mono ${c.amount_kg < 50 ? 'text-danger' : ''}">${(+c.amount_kg).toFixed(1)}${c.amount_kg < 50 ? ' ⚠' : ''}</td>
                <td class="mono">${(+c.concentration_pct).toFixed(1)}</td>
                <td class="gold">PKR ${(+c.price_per_kg).toFixed(0)}</td>
                <td class="mono">${(+c.quantity_sold).toFixed(1)}</td>
              </tr>`).join('')}
              </tbody></table>`;
        }
    }
}
window.updateChemQty = async function (id) {
    const val = parseFloat(document.getElementById('qty-' + id)?.value || 0);
    const body = authBody({ chemical_id: id, amount_kg: val });
    const data = await api('/api/chemicals/update', body).catch(() => ({ success: false }));
    if (data.success) showToast('Stock updated.', 'success');
    else showToast(data.error || 'Update failed.', 'error');
};
window.removeChemical = async function (id, name) {
    if (!confirm(`Remove "${name}"? This cannot be undone.`)) return;
    const data = await api('/api/chemicals/remove', authBody({ chemical_id: id })).catch(() => ({ success: false }));
    if (data.success) { showToast(`${name} removed.`, 'info'); loadDashboardChemicals(_dashProvince); }
    else showToast(data.error || 'Remove failed.', 'error');
};
async function submitAddChemical() {
    const name = document.getElementById('ac-name').value.trim();
    const province = document.getElementById('ac-province').value;
    if (!name || !province) { showToast('Name and province are required.', 'error'); return; }
    const body = authBody({
        name, formula: document.getElementById('ac-formula').value.trim(),
        province, category: document.getElementById('ac-category').value,
        amount_kg: parseFloat(document.getElementById('ac-amount').value || 0),
        concentration_pct: parseFloat(document.getElementById('ac-concentration').value || 100),
        price_per_kg: parseFloat(document.getElementById('ac-price').value || 0),
        description: document.getElementById('ac-description').value.trim()
    });
    const data = await api('/api/chemicals/add', body).catch(() => ({ success: false }));
    if (data.success) {
        document.getElementById('add-chem-modal').classList.add('hidden');
        showToast(`✓ ${name} added.`, 'success');
        loadDashboardChemicals(_dashProvince);
    } else showToast(data.error || 'Failed.', 'error');
}
async function loadDashboardDeliveries(province) {
    const chartEl = document.getElementById('dash-deliveries-chart');
    const tableEl = document.getElementById('dash-deliveries-table');
    if (!chartEl) return;
    chartEl.innerHTML = '<div class="fp-loading">Loading...</div>';
    const body = authBody({ province: province === 'all' ? undefined : province });
    const data = await api('/api/deliveries', body).catch(() => ({ deliveries: [] }));
    const dels = data.deliveries || [];
    if (!dels.length) {
        chartEl.innerHTML = '<div class="fp-loading">No deliveries.</div>';
        if (tableEl) tableEl.innerHTML = '<div class="fp-loading">No deliveries.</div>';
        // ── FIX: destroy & hide the map when there are no deliveries ─────
        if (window._dashDelMap) {
            try { window._dashDelMap.remove(); } catch (_) {}
            window._dashDelMap = null;
        }
        const mapEl = document.getElementById('dash-deliveries-map');
        if (mapEl) mapEl.style.display = 'none';
        return;
    }
    // ── Chart: status doughnut + sidebar metrics ─────────────
    const chartId = 'dcd-' + Date.now();
    chartEl.innerHTML = `
      <div class="dash-chart-flex">
        <div class="dash-chart-donut-wrap"><canvas id="${chartId}"></canvas></div>
        <div id="dc-del-stats" class="dash-chart-stats"></div>
      </div>`;
      
    // ── Map: Delivery Locations ──────────────────────────────
    const mapEl = document.getElementById('dash-deliveries-map');
    if (mapEl) {
        mapEl.style.display = 'block';
        setTimeout(() => {
            if (window._dashDelMap) { window._dashDelMap.remove(); window._dashDelMap = null; }
            if (window.L) {
                const map = L.map('dash-deliveries-map').setView([30.3753, 69.3451], 5); // Pakistan center
                L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
                
                const bounds = L.latLngBounds();
                let hasLocs = false;
                
                dels.forEach(d => {
                    if (d.delivery_lat && d.delivery_lng) {
                        hasLocs = true;
                        bounds.extend([d.delivery_lat, d.delivery_lng]);
                        // Color marker by status
                        let color = '#a78bfa'; // processing (purple)
                        if (d.status === 'ordered') color = '#9ca3af'; // gray
                        if (d.status === 'in_transit') color = '#f59e0b'; // amber
                        if (d.status === 'delivered') color = '#10b981'; // green
                        
                        const icon = L.divIcon({
                            className: '',
                            html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>`,
                            iconSize: [14, 14], iconAnchor: [7, 7]
                        });
                        
                        L.marker([d.delivery_lat, d.delivery_lng], { icon })
                            .bindPopup(`<strong>${esc2(d.chem_name)}</strong><br>${d.quantity_kg}kg · ${d.status.replace('_', ' ')}<br><span style="font-size:10px;color:gray;">${esc2(d.delivery_location_name || 'Mapped')}</span>`)
                            .addTo(map);
                    }
                });
                
                if (hasLocs) map.fitBounds(bounds.pad(0.2));
                window._dashDelMap = map;
            }
        }, 150);
    }
    
    setTimeout(() => {
        const statusCounts = {};
        dels.forEach(d => { statusCounts[d.status] = (statusCounts[d.status] || 0) + 1; });
        const statusLabels = ['ordered', 'processing', 'in_transit', 'delivered'];
        const statusNames = ['Ordered', 'Processing', 'In Transit', 'Delivered'];
        const vals = statusLabels.map(s => statusCounts[s] || 0);
        const ctx = document.getElementById(chartId);
        if (ctx) {
            const inst = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: statusNames, datasets: [{ data: vals, backgroundColor: PIE_COLORS, borderWidth: 0, hoverOffset: 8 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'bottom', labels: { color: TICK_COLOR, font: { size: 10 }, padding: 12 } }, tooltip: CHART_TOOLTIP } }
            });
            _chartInstances.push(inst);
        }
        const statsEl = document.getElementById('dc-del-stats');
        if (statsEl) {
            const total = dels.length;
            const delivered = statusCounts['delivered'] || 0;
            statsEl.innerHTML = `
              <div class="dash-stats-label">DELIVERY METRICS</div>
              ${statusNames.map((name, i) => `
                <div class="dash-stat-row">
                  <span class="dash-stat-name">${name}</span>
                  <span class="dash-stat-val" style="color:${PIE_COLORS[i]}">${vals[i]}</span>
                </div>`).join('')}
              <div class="dash-stat-total">${total} total · ${total > 0 ? Math.round(delivered / total * 100) : 0}% delivered</div>`;
        }
    }, 80);
    // ── Detail table (hidden until toggled) ─────────────────
    if (tableEl) {
        const u = window._currentUser;
        const canManageDel = u && (u.role === 'admin' || u.role === 'regional_admin');
        tableEl.innerHTML = `<table class="dash-table"><thead><tr>
          <th>Tracking</th><th>Chemical</th><th>User</th><th>Province</th>
          <th>Qty (kg)</th><th>Status</th><th>Date</th><th>Location</th><th>Actions</th></tr></thead>
          <tbody>${dels.slice(0, 30).map(d => {
            const si = STATUS_STEPS.indexOf(d.status);
            const next = si < STATUS_STEPS.length - 1 ? STATUS_STEPS[si + 1] : null;
            const hasLoc = d.delivery_lat && d.delivery_lng;
            const locDisplay = hasLoc ? `<span style="color:var(--accent);font-size:11px;">📍 ${esc2(d.delivery_location_name || d.delivery_lat.toFixed(3) + ',' + d.delivery_lng.toFixed(3))}</span>` : '<span style="opacity:.3;font-size:11px;">—</span>';
            const advanceCell = next
                ? `<button class="admin-btn approve" onclick="adminAdvance(${d.id},'${next}')">→ ${next.replace('_', ' ')}</button>`
                : '<span style="opacity:.4">Delivered</span>';
            const deleteCell = canManageDel
                ? `<button type="button" class="admin-btn deny" onclick="removeDashboardDelivery(${d.id})">Remove</button>`
                : '';
            return `<tr>
              <td class="mono accent">${esc2(d.tracking_code || '—')}</td>
              <td>${esc2(d.chem_name || '—')}</td>
              <td>${esc2(d.user_name || d.username || '—')}</td>
              <td class="mono">${esc2(d.province)}</td>
              <td class="mono">${(+d.quantity_kg).toFixed(1)}</td>
              <td><span class="status-dot ${d.status}"></span>${d.status.replace('_', ' ')}</td>
              <td class="mono">${fmtDate(d.created_at)}</td>
              <td>${locDisplay}</td>
              <td><div class="table-actions dash-del-actions">${advanceCell}${deleteCell}</div></td>
            </tr>`;
        }).join('')}</tbody></table>`;
    }
}
window.removeDashboardDelivery = async function (id) {
    if (!confirm('Remove this delivery? Related feedback will be removed too. This cannot be undone.')) return;
    const data = await api('/api/deliveries/delete', authBody({ delivery_id: id })).catch(() => ({ success: false }));
    if (data.success) {
        showToast('Delivery removed.', 'info');
        loadDashboard(_dashProvince);
    } else showToast(data.error || 'Remove failed.', 'error');
};
window.adminAdvance = async function (id, status) {
    const body = authBody({ delivery_id: id, status });
    const data = await api('/api/deliveries/update-status', body).catch(() => ({ success: false }));
    if (data.success) {
        showToast('Status updated.', 'success');
        if (status === 'delivered' && typeof window.chemtechCelebrationDelivered === 'function') {
            window.chemtechCelebrationDelivered();
        }
        loadDashboardDeliveries(_dashProvince);
    } else showToast(data.error || 'Failed.', 'error');
};
async function loadDashboardFeedback(province) {
    const chartEl = document.getElementById('dash-feedback-chart');
    const listEl = document.getElementById('dash-feedback-list');
    if (!chartEl) return;
    chartEl.innerHTML = '<div class="fp-loading">Loading...</div>';
    const body = authBody({ province: province === 'all' ? undefined : province });
    const data = await api('/api/feedback/list', body).catch(() => ({ feedback: [] }));
    const fb = data.feedback || [];
    if (!fb.length) {
        chartEl.innerHTML = '<div class="fp-loading">No feedback yet.</div>';
        if (listEl) listEl.innerHTML = '<div class="fp-loading">No feedback yet.</div>';
        return;
    }
    // ── Chart: sentiment by province horizontal bar ──────────
    const chartId = 'dcf-' + Date.now();
    chartEl.innerHTML = `<div style="position:relative;height:220px;padding:16px;"><canvas id="${chartId}"></canvas></div>`;
    setTimeout(() => {
        const ctx = document.getElementById(chartId);
        if (!ctx) return;
        const provSent = {};
        fb.forEach(f => {
            if (!provSent[f.province]) provSent[f.province] = { sum: 0, count: 0 };
            provSent[f.province].sum += (f.sentiment_score || 0);
            provSent[f.province].count++;
        });
        const provs = Object.keys(provSent);
        const avgSents = provs.map(p => Math.round((provSent[p].sum / provSent[p].count) * 100));
        const colors = avgSents.map(v => v >= 60 ? 'rgba(0,230,195,0.75)' : v >= 40 ? 'rgba(245,158,11,0.75)' : 'rgba(244,63,94,0.75)');
        const inst = new Chart(ctx, {
            type: 'bar',
            data: { labels: provs, datasets: [{ label: 'Avg Sentiment %', data: avgSents, backgroundColor: colors, borderColor: colors.map(c => c.replace('0.75', '1')), borderWidth: 1.5, borderRadius: 8 }] },
            options: {
                indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.raw + '%' } } },
                scales: {
                    x: { min: 0, max: 100, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => v + '%' } },
                    y: { grid: { display: false }, ticks: { color: TICK_COLOR } }
                }
            }
        });
        _chartInstances.push(inst);
    }, 80);
    // ── Detail list (hidden until toggled) ───────────────────
    if (listEl) {
        const u = window._currentUser;
        const canManageFb = u && (u.role === 'admin' || u.role === 'regional_admin');
        listEl.innerHTML = fb.slice(0, 20).map(f => {
            const lbl = (f.sentiment_label || 'neutral').toLowerCase();
            const score = Math.round((f.sentiment_score || 0) * 100);
            const delBtn = canManageFb
                ? `<button type="button" class="admin-btn deny" onclick="removeDashboardFeedback(${f.id})">Remove</button>`
                : '';
            return `<div class="dash-feedback-card">
              <div class="dash-feedback-header">
                <div><div class="dash-feedback-user">${esc2(f.user_name || 'User')}</div>
                  <div class="dash-feedback-meta">${esc2(f.chem_name || '—')} · ${esc2(f.province || '—')} · ${fmtDate(f.created_at)}</div>
                </div>
                <div class="dash-feedback-header-right">
                  <div class="sentiment-chip ${lbl}">${f.sentiment_label || 'Neutral'}<span class="score">${score}%</span></div>
                  ${delBtn}
                </div>
              </div>
              <div class="dash-feedback-text">"${esc2(f.text_feedback)}"</div>
              ${f.sentiment_justification ? `<div style="font-size:11px;color:var(--ink-dim);margin-top:4px;">${esc2(f.sentiment_justification)}</div>` : ''}
            </div>`;
        }).join('');
    }
}
window.removeDashboardFeedback = async function (id) {
    if (!confirm('Remove this feedback entry? This cannot be undone.')) return;
    const data = await api('/api/feedback/delete', authBody({ feedback_id: id })).catch(() => ({ success: false }));
    if (data.success) {
        showToast('Feedback removed.', 'info');
        loadDashboard(_dashProvince);
    } else showToast(data.error || 'Remove failed.', 'error');
};

// ============================================================
//  DASHBOARD SECTION TOGGLE (chart ↔ details)
// ============================================================
const _DSEC = {
    chemicals: { chart: 'dash-chemicals-chart', detail: 'dash-chemicals-table', detailBtn: 'chem-detail-btn', backBtn: 'chem-back-btn' },
    deliveries: { chart: 'dash-deliveries-chart', detail: 'dash-deliveries-table', detailBtn: 'del-detail-btn', backBtn: 'del-back-btn' },
    feedback:   { chart: 'dash-feedback-chart',   detail: 'dash-feedback-list',   detailBtn: 'fb-detail-btn',  backBtn: 'fb-back-btn' }
};
window.toggleDashSection = function(section) {
    const ids = _DSEC[section]; if (!ids) return;
    const chartEl  = document.getElementById(ids.chart);
    const detailEl = document.getElementById(ids.detail);
    const detailBtn = document.getElementById(ids.detailBtn);
    const backBtn   = document.getElementById(ids.backBtn);
    const showingChart = chartEl && !chartEl.classList.contains('collapsed');
    if (showingChart) {
        if (chartEl)  chartEl.classList.add('collapsed');
        if (detailEl) detailEl.classList.add('expanded');
        if (detailBtn) detailBtn.style.display = 'none';
        if (backBtn)   backBtn.style.display = '';
    } else {
        if (chartEl)  chartEl.classList.remove('collapsed');
        if (detailEl) detailEl.classList.remove('expanded');
        if (detailBtn) detailBtn.style.display = '';
        if (backBtn)   backBtn.style.display = 'none';
    }
};

// ============================================================
//  DELIVERY LOCATION PICKER
// ============================================================
let _locationMap = null, _locationMarker = null;
let _selectedLat = null, _selectedLng = null, _selectedLocationName = '';
let _locMode = 'direct'; // 'direct' = save to DB now  |  'order' = store for pending order
let _pendingLat = null, _pendingLng = null, _pendingLocationName = '';

// CartoDB Voyager — detailed, English labels, clean, no API key needed
const _OSM_TILES = 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
const _OSM_ATTR  = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>';
const _OSM_OPTS  = { subdomains: 'abcd', maxZoom: 20 };

// Open the location picker modal.
// mode: 'direct' — saves immediately to DB for an existing deliveryId
//       'order'  — stores coords for use in confirmOrder() (no deliveryId yet)
window.openLocationModal = function(deliveryId, mode) {
    _locMode = mode || 'direct';
    const modal = document.getElementById('location-modal');
    if (!modal) return;
    document.getElementById('location-delivery-id').value = deliveryId || '';
    const readout = document.getElementById('location-selected');
    if (readout) readout.textContent = 'No location selected yet';
    _selectedLat = null; _selectedLng = null; _selectedLocationName = '';
    modal.classList.remove('hidden');
    setTimeout(() => {
        if (!window.L) { showToast('Map library not loaded', 'error'); return; }
        if (_locationMap) { _locationMap.remove(); _locationMap = null; }
        // Pakistan center, zoom 5
        _locationMap = L.map('location-map').setView([30.3753, 69.3451], 5);
        L.tileLayer(_OSM_TILES, { ..._OSM_OPTS, attribution: _OSM_ATTR
        }).addTo(_locationMap);
        // Soft Pakistan bounds
        const pkBounds = L.latLngBounds([23.0, 59.0], [38.0, 78.0]);
        _locationMap.setMaxBounds(pkBounds.pad(0.15));
        _locationMap.on('click', function(e) {
            const { lat, lng } = e.latlng;
            _selectedLat = lat; _selectedLng = lng;
            if (_locationMarker) _locationMarker.remove();
            const icon = L.divIcon({
                className: '',
                html: `<div style="width:16px;height:16px;background:var(--accent);border:3px solid white;border-radius:50%;box-shadow:0 0 10px rgba(0,230,195,0.8);"></div>`,
                iconSize: [16, 16], iconAnchor: [8, 8]
            });
            _locationMarker = L.marker([lat, lng], { icon }).addTo(_locationMap);
            const readout = document.getElementById('location-selected');
            if (readout) readout.textContent = '⏳ ' + lat.toFixed(4) + ', ' + lng.toFixed(4) + ' — fetching name…';
            // Reverse geocode via Nominatim (English result)
            fetch('https://nominatim.openstreetmap.org/reverse?lat=' + lat + '&lon=' + lng + '&format=json&accept-language=en')
                .then(r => r.json())
                .then(geo => {
                    const city  = geo.address?.city || geo.address?.town || geo.address?.village || geo.address?.county || '';
                    const state = geo.address?.state || '';
                    _selectedLocationName = [city, state].filter(Boolean).join(', ') || (lat.toFixed(4) + ', ' + lng.toFixed(4));
                    const readout = document.getElementById('location-selected');
                    if (readout) readout.textContent = '📍 ' + _selectedLocationName;
                    _locationMarker.bindPopup('<strong>' + _selectedLocationName + '</strong>').openPopup();
                })
                .catch(() => {
                    _selectedLocationName = lat.toFixed(4) + ', ' + lng.toFixed(4);
                    const readout = document.getElementById('location-selected');
                    if (readout) readout.textContent = '📍 ' + _selectedLocationName;
                });
        });
    }, 160);
};
// Shortcut: open location picker in order-mode (no existing delivery id yet)
window.openLocationPickerForOrder = function() {
    openLocationModal('', 'order');
};
async function confirmDeliveryLocation() {
    if (_selectedLat === null || _selectedLng === null) {
        showToast('Please click on the map to select a location.', 'error'); return;
    }
    if (_locMode === 'order') {
        // Store for use in confirmOrder — don't call API yet
        _pendingLat = _selectedLat;
        _pendingLng = _selectedLng;
        _pendingLocationName = _selectedLocationName;
        document.getElementById('location-modal').classList.add('hidden');
        if (_locationMap) { _locationMap.remove(); _locationMap = null; }
        // Update the display inside the order modal
        const display = document.getElementById('order-location-display');
        if (display) display.textContent = '📍 ' + _selectedLocationName;
        return;
    }
    // Direct mode: save to DB immediately
    const deliveryId = document.getElementById('location-delivery-id').value;
    const body = authBody({ delivery_id: +deliveryId, lat: _selectedLat, lng: _selectedLng, location_name: _selectedLocationName });
    const data = await api('/api/deliveries/set-location', body).catch(() => ({ success: false }));
    if (data.success) {
        document.getElementById('location-modal').classList.add('hidden');
        if (_locationMap) { _locationMap.remove(); _locationMap = null; }
        showToast('📍 Location saved: ' + _selectedLocationName, 'success');
        loadDashboardDeliveries(_dashProvince);
    } else {
        showToast(data.error || 'Failed to save location.', 'error');
    }
}

// ============================================================
//  AI ANALYTICS — Intelligent Search + Answer + Charts  v7
// ============================================================

const PALETTE = {
    cyan: { border: 'rgba(0,230,195,1)', bg: 'rgba(0,230,195,0.12)', point: 'rgba(0,230,195,1)' },
    gold: { border: 'rgba(245,158,11,1)', bg: 'rgba(245,158,11,0.12)', point: 'rgba(245,158,11,1)' },
    purple: { border: 'rgba(167,139,250,1)', bg: 'rgba(167,139,250,0.1)', point: 'rgba(167,139,250,1)' },
    red: { border: 'rgba(244,63,94,1)', bg: 'rgba(244,63,94,0.1)', point: 'rgba(244,63,94,1)' },
    blue: { border: 'rgba(96,180,255,1)', bg: 'rgba(96,180,255,0.1)', point: 'rgba(96,180,255,1)' },
};
const PIE_COLORS = [
    'rgba(0,230,195,0.85)', 'rgba(245,158,11,0.85)',
    'rgba(167,139,250,0.85)', 'rgba(96,180,255,0.85)',
    'rgba(244,63,94,0.75)', 'rgba(52,211,153,0.75)'
];
const CHART_TOOLTIP = {
    backgroundColor: 'rgba(6,14,26,.97)',
    borderColor: 'rgba(0,230,195,0.4)', borderWidth: 1,
    titleColor: '#f0f8ff', bodyColor: 'rgba(220,240,255,0.9)',
    padding: 14, cornerRadius: 10
};
const GRID_COLOR = 'rgba(200,230,255,0.07)';
const TICK_COLOR = 'rgba(220,240,255,0.80)';
const _chartInstances = [];

// ── Analytics snapshot selector (one deep-focus dataset at a time) ──
const SNAPSHOT_HINTS = {
    '': 'Balanced context · pick one deep snapshot to save tokens',
    sales_ledger: 'Deep focus: individual sale transactions with dates',
    inventory_full: 'Deep focus: full chemical catalog and stock levels',
    deliveries_ops: 'Deep focus: deliveries, GPS coordinates, tracking',
    feedback_reviews: 'Deep focus: customer reviews and sentiment scores',
    users_directory: 'Deep focus: user accounts and roles',
    notifications_log: 'Deep focus: in-app notifications and alerts',
};

function getAnalyticsSnapshot() {
    const active = document.querySelector('.snapshot-chip.active');
    return (active && active.dataset.snapshot) ? active.dataset.snapshot : '';
}

function initAnalyticsSnapshotBar() {
    const hint = document.getElementById('an-snapshot-hint');
    document.querySelectorAll('.snapshot-chip').forEach(chip => {
        chip.addEventListener('click', () => {
            document.querySelectorAll('.snapshot-chip').forEach(c => c.classList.remove('active'));
            chip.classList.add('active');
            const id = chip.dataset.snapshot || '';
            if (hint) hint.textContent = SNAPSHOT_HINTS[id] || SNAPSHOT_HINTS[''];
        });
    });
}

// ── Wire up search on panel open ─────────────────────────
function initAnalyticsPanel() {
    const inp = document.getElementById('analytics-input');
    const btn = document.getElementById('analytics-submit-btn');
    const home = document.getElementById('analytics-home-btn');
    initAnalyticsSnapshotBar();
    if (inp) {
        inp.addEventListener('keypress', e => { if (e.key === 'Enter') anRunQuery(); });
        inp.addEventListener('input', () => {
            const bar = document.getElementById('an-search-bar');
            if (bar) bar.style.boxShadow = inp.value ? '0 0 0 3px rgba(0,230,195,0.08)' : '';
        });
    }
    if (btn) btn.onclick = anRunQuery;
    if (home) home.onclick = loadAnalyticsDashboard;
    document.querySelectorAll('.sugg-chip').forEach(chip => {
        chip.onclick = () => { if (inp) inp.value = chip.dataset.q; anRunQuery(); };
    });
}

// ── Public helper — called from example cards in HTML ────
window.anAskQuery = function (q) {
    const inp = document.getElementById('analytics-input');
    if (inp) inp.value = q;
    anRunQuery();
};

// ── Pull live DB context for the AI prompt ────────────────
async function getDbContext() {
    try {
        const [anRes, chemRes] = await Promise.all([
            api('/api/analytics/regional', authBody()).catch(() => ({ analytics: {} })),
            api('/api/chemicals', authBody()).catch(() => ({ chemicals: [] }))
        ]);
        const analytics = anRes.analytics || {};
        const chemicals = chemRes.chemicals || [];
        const PROVS = ['Punjab', 'KPK', 'Sindh', 'Balochistan'];

        let provSummary = {};
        PROVS.forEach(p => {
            const a = analytics[p] || {};
            provSummary[p] = {
                total_revenue_PKR: a.total_revenue || 0,
                total_volume_kg: a.total_quantity_kg || 0,
                total_deliveries: a.total_deliveries || 0,
                avg_sentiment_pct: Math.round((a.avg_sentiment || 0) * 100),
                feedback_count: a.total_feedback || 0,
                chemical_count: a.chemical_count || 0,
                monthly_trend: (a.monthly_trend || []).slice(-4),
                top_chemicals: a.top_chemicals || []
            };
        });

        const totalRev = PROVS.reduce((s, p) => s + (analytics[p]?.total_revenue || 0), 0);
        const totalQty = PROVS.reduce((s, p) => s + (analytics[p]?.total_quantity_kg || 0), 0);

        return `=== CHEMTECH PAKISTAN — LIVE DATABASE SNAPSHOT (April 2026) ===

COMPANY: ChemTech Pakistan — chemical distribution across 4 provinces.
TOTAL REVENUE (90 days): PKR ${Math.round(totalRev).toLocaleString()}
TOTAL VOLUME (90 days):  ${Math.round(totalQty).toLocaleString()} kg
CATALOG SIZE: ${chemicals.length} active SKUs

PROVINCIAL PERFORMANCE:
${JSON.stringify(provSummary, null, 2)}

FULL CHEMICAL INVENTORY:
${chemicals.map(c => `  • ${c.name} (${c.formula || '—'}) | ${c.province} | ${c.category} | PKR ${c.price_per_kg}/kg | Stock: ${c.amount_kg}kg | Sold: ${c.quantity_sold}kg | Conc: ${c.concentration_pct}%`).join('\n')}

INDUSTRY CONTEXT (Pakistan Chemical Market 2025-26):
- Pakistan chemical market size ~USD 4.2B, growing ~8% YoY
- Major competitors: ICI Pakistan, Nimir Chemicals, Sitara Chemicals, Engro Polymer
- ICI Pakistan revenue ~PKR 28B/yr; Nimir ~PKR 8B/yr; Sitara ~PKR 12B/yr
- ChemTech total 90-day revenue PKR ${Math.round(totalRev).toLocaleString()} (annualised ~PKR ${Math.round(totalRev * 4).toLocaleString()})
- Average industry delivery time: 3–5 days; ChemTech benchmark: 2–4 days
- Pakistan chemical sector: Acids & Solvents see highest demand from textile/pharma sectors
- Potassium Permanganate market highly specialised — ChemTech's KMnO4 at PKR 120/kg is competitively priced vs market avg PKR 130–145/kg
- Sindh (Karachi) is Pakistan's largest industrial hub — high chemical demand corridor
- Punjab (Lahore/Faisalabad) — textile sector drives acid and solvent demand
- KPK — growing pharmaceutical manufacturing driving solvent/ethanol demand
- Balochistan — mining/agriculture sector drives mineral demand`;
    } catch (e) {
        return '[DB context unavailable]';
    }
}

// ── Main query runner ─────────────────────────────────────
async function anRunQuery() {
    const inp = document.getElementById('analytics-input');
    const query = (inp?.value || '').trim();
    if (!query) { if (inp) inp.focus(); return; }

    // Switch to results view
    const landing = document.getElementById('analytics-landing');
    const results = document.getElementById('analytics-results');
    if (landing) landing.style.display = 'none';
    if (results) results.classList.remove('hidden');

    // Loading state on button
    const btnText = document.getElementById('analytics-btn-text');
    const btnLoader = document.getElementById('analytics-btn-loader');
    if (btnText) btnText.classList.add('hidden');
    if (btnLoader) btnLoader.classList.remove('hidden');

    // Create result block
    const block = document.createElement('div');
    block.className = 'an-result-block';
    block.innerHTML = `
        <div class="an-query-bubble">
            <div class="an-query-icon">◈</div>
            <div class="an-query-text">${esc2(query)}</div>
        </div>
        <div class="an-thinking" id="an-thinking-${Date.now()}">
            <div class="an-thinking-dots"><span></span><span></span><span></span></div>
            <span>Analysing database and market intelligence…</span>
        </div>`;
    results.appendChild(block);
    results.scrollTop = results.scrollHeight;

    // Clear input
    if (inp) inp.value = '';

    // Build context + call AI
    const thinking = block.querySelector('[id^="an-thinking-"]');
    try {
        const snapshot = getAnalyticsSnapshot();
        const body = authBody({ query });
        if (snapshot) body.snapshot = snapshot;
        const isLocal = (body.llm_provider || '') === 'local';
        const graphTimeoutMs = isLocal ? 420000 : 120000;
        const data = await fetchJsonWithTimeout('/api/ai/graph-query', body, graphTimeoutMs);
        if (!data.success) throw new Error(data.error || 'API failed');

        const answerText = data.summary || 'Analysis complete.';
        const charts = data.charts || [];
        const followups = data.followups || [];
        const snapshotLabel = data.snapshot_label;
        if (data.llm_notice) showToast(data.llm_notice, 'info');

        if (thinking) thinking.remove();

        // Render answer text
        const answerDiv = document.createElement('div');
        answerDiv.className = 'an-answer-area';
        const engineLabel = (data.llm_used || body.llm_provider) === 'local' ? 'Ollama' : 'Groq';
        const engineClass = engineLabel === 'Ollama' ? 'an-engine-ollama' : 'an-engine-groq';
        const snapshotBadge = snapshotLabel
            ? `<span class="an-snapshot-badge" title="Focused database snapshot">${esc2(snapshotLabel)}</span>`
            : '';
        const fallbackNote = data.used_fallback
            ? `<span class="an-local-fallback-note" title="Groq was unavailable">${esc2(data.llm_notice || 'Switched to Ollama')}</span>`
            : '';
        answerDiv.innerHTML = `
            <div class="an-answer-header">
                <span class="an-answer-chip">◈ ChemTech AI</span>
                <span class="an-engine-badge ${engineClass}">${esc2(engineLabel)}</span>
                ${snapshotBadge}${fallbackNote}
            </div>
            <div class="an-answer-text">${formatAnswerText(answerText)}</div>`;
        block.appendChild(answerDiv);

        // Render charts OR tables depending on model mode
        const table  = data.table;
        const table2 = data.table2;
        if (charts.length) {
            const chartsSection = document.createElement('div');
            chartsSection.className = 'an-charts-section';
            chartsSection.innerHTML = `<div class="an-charts-label">Visual Breakdown</div>`;
            const grid = document.createElement('div');
            grid.className = 'an-charts-grid';
            chartsSection.appendChild(grid);
            block.appendChild(chartsSection);

            for (let i = 0; i < charts.length; i++) {
                await new Promise(r => setTimeout(r, 60));
                renderAIChart(charts[i], grid);
            }
        } else if (table) {
            const tablesSection = document.createElement('div');
            tablesSection.className = 'an-charts-section';
            tablesSection.innerHTML = `<div class="an-charts-label">Data Breakdown</div>`;
            renderAITable(table, tablesSection);
            if (table2) renderAITable(table2, tablesSection);
            block.appendChild(tablesSection);
        }

        // Render follow-up chips
        if (followups.length) {
            const fuBar = document.createElement('div');
            fuBar.className = 'an-followup-bar';
            fuBar.innerHTML = `<span class="an-followup-label">Dig deeper:</span>` +
                followups.map(q => `<button class="an-followup-chip" onclick="anAskQuery(${JSON.stringify(esc2(q))})">${esc2(q)}</button>`).join('');
            block.appendChild(fuBar);
        }

    } catch (err) {
        if (thinking) thinking.remove();
        const errDiv = document.createElement('div');
        errDiv.className = 'an-answer-area';
        errDiv.innerHTML = `<div class="an-answer-text" style="color:var(--danger);">Analysis failed: ${esc2(err.message)}. Check your connection and try again.</div>`;
        block.appendChild(errDiv);
    } finally {
        if (btnText) btnText.classList.remove('hidden');
        if (btnLoader) btnLoader.classList.add('hidden');
        if (results) results.scrollTop = results.scrollHeight;
    }
}

// ── Format answer text: **bold** → <strong> ──────────────
function formatAnswerText(text) {
    return esc2(text)
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n\n/g, '</p><p style="margin-top:14px;">')
        .replace(/\n/g, '<br>');
}

// ── Render a single AI chart ──────────────────────────────
function renderAIChart(ch, container) {
    const pal = PALETTE[ch.colorScheme] || PALETTE.cyan;
    const uid = 'ai-ch-' + Math.random().toString(36).slice(2);
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `
        <div class="chart-card-header">
            <div class="chart-card-title">${esc2(ch.title)}</div>
            <div class="chart-card-desc">${esc2(ch.description)}</div>
        </div>
        <div class="chart-canvas-wrap" style="height:260px;position:relative;">
            <canvas id="${uid}"></canvas>
        </div>`;
    container.appendChild(card);
    setTimeout(() => {
        const canvas = document.getElementById(uid);
        if (!canvas) return;
        if (ch.type === 'line') renderLine(ch, canvas, pal);
        else if (ch.type === 'doughnut' || ch.type === 'pie') renderDoughnut(ch, canvas);
        else if (ch.type === 'radar') renderRadar(ch, canvas, pal);
        else if (ch.type === 'bubble') renderBubble(ch, canvas);
        else if (ch.type === 'bar3d') renderBar3D(ch, canvas.parentElement, pal);
        else renderBar2D(ch, canvas, pal);
    }, 80);
}

// ── Render a server-built data table (local model mode) ──────────────
function renderAITable(td, container) {
    if (!td || !td.headers || !td.rows) return;
    const wrap = document.createElement('div');
    wrap.style.cssText = 'overflow-x:auto; margin:16px 0; border:1px solid rgba(0,230,195,0.1); border-radius:12px; background:rgba(255,255,255,0.02);';
    let html = `<div style="padding:14px 16px 8px;font-family:var(--mono);font-size:9px;letter-spacing:2px;text-transform:uppercase;color:var(--accent);opacity:0.7;">${esc2(td.title || '')}</div>`;
    html += '<table style="width:100%;border-collapse:collapse;">';
    html += '<thead><tr>';
    td.headers.forEach((h, hi) => {
        const align = hi === 0 ? 'left' : 'right';
        html += `<th style="text-align:${align};padding:10px 16px;font-family:var(--mono);font-size:9px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(220,240,255,0.5);border-bottom:1px solid rgba(0,230,195,0.12);white-space:nowrap;">${esc2(h)}</th>`;
    });
    html += '</tr></thead><tbody>';
    td.rows.forEach((row, ri) => {
        const bg = ri % 2 === 0 ? 'rgba(255,255,255,0.015)' : 'transparent';
        html += `<tr style="background:${bg};"`
            + ` onmouseover="this.style.background='rgba(0,230,195,0.04)'"`
            + ` onmouseout="this.style.background='${bg}'">`;
        row.forEach((cell, ci) => {
            const isFirst = ci === 0;
            const align = isFirst ? 'left' : 'right';
            const color  = isFirst ? 'rgba(220,240,255,0.9)' : 'rgba(220,240,255,0.6)';
            html += `<td style="padding:11px 16px;font-family:var(--mono);font-size:12px;color:${color};border-bottom:1px solid rgba(255,255,255,0.04);white-space:nowrap;text-align:${align};">${esc2(String(cell))}</td>`;
        });
        html += '</tr>';
    });
    html += '</tbody></table>';
    wrap.innerHTML = html;
    container.appendChild(wrap);
}

function renderLine(ch, canvas, pal) {
    const inst = new Chart(canvas, {
        type: 'line', data: {
            labels: (ch.data || []).map(d => d.x), datasets: [{
                label: ch.yLabel || 'Value', data: (ch.data || []).map(d => +d.y),
                borderColor: pal.border, backgroundColor: pal.bg, pointBackgroundColor: pal.point,
                tension: 0.4, fill: true, borderWidth: 2, pointRadius: 4
            }]
        }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: CHART_TOOLTIP },
            scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } } }
        }
    });
    _chartInstances.push(inst);
}
function renderDoughnut(ch, canvas) {
    const inst = new Chart(canvas, {
        type: 'doughnut', data: {
            labels: (ch.data || []).map(d => d.x || d.label),
            datasets: [{ data: (ch.data || []).map(d => +d.y), backgroundColor: PIE_COLORS, borderWidth: 0, hoverOffset: 5 }]
        }, options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { position: 'right', labels: { color: TICK_COLOR, font: { size: 10 }, padding: 14 } }, tooltip: CHART_TOOLTIP }
        }
    });
    _chartInstances.push(inst);
}
function renderBar2D(ch, canvas, pal) {
    const isHoriz = ch.horizontal === true;
    const labels = (ch.data || []).map(d => d.x || d.label);
    const vals = (ch.data || []).map(d => +d.y);
    // Color each bar individually when multiple categories
    const bgColors = vals.map((_, i) => PIE_COLORS[i % PIE_COLORS.length].replace('0.85', '0.2'));
    const bdrColors = vals.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]);
    const inst = new Chart(canvas, {
        type: 'bar',
        data: {
            labels, datasets: [{
                label: ch.yLabel || 'Value', data: vals,
                backgroundColor: vals.length > 1 ? bgColors : pal.bg,
                borderColor: vals.length > 1 ? bdrColors : pal.border,
                borderWidth: 1.5, borderRadius: 6
            }]
        },
        options: {
            indexAxis: isHoriz ? 'y' : 'x', responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: CHART_TOOLTIP },
            scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } } }
        }
    });
    _chartInstances.push(inst);
}
function renderRadar(ch, canvas, pal) {
    const colors = [pal, PALETTE.gold, PALETTE.purple, PALETTE.blue];
    const datasets = (ch.datasets || []).map((ds, i) => ({
        label: ds.label, data: ds.data,
        borderColor: colors[i]?.border || pal.border,
        backgroundColor: colors[i]?.bg || pal.bg,
        pointBackgroundColor: colors[i]?.point || pal.point,
        borderWidth: 1.5, pointRadius: 3
    }));
    const inst = new Chart(canvas, {
        type: 'radar', data: { labels: ch.labels || [], datasets },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { labels: { color: TICK_COLOR, font: { size: 10 } } }, tooltip: CHART_TOOLTIP },
            scales: {
                r: {
                    grid: { color: 'rgba(255,255,255,.06)' }, pointLabels: { color: TICK_COLOR, font: { size: 10 } },
                    ticks: { display: false }, angleLines: { color: 'rgba(255,255,255,.06)' }
                }
            }
        }
    });
    _chartInstances.push(inst);
}
function renderBubble(ch, canvas) {
    const inst = new Chart(canvas, {
        type: 'bubble',
        data: {
            datasets: [{
                label: ch.yLabel || '', data: (ch.data || []).map(d => ({ x: +d.x, y: +d.y, r: d.r || 8, label: d.label || d.x })),
                backgroundColor: PIE_COLORS.map(c => c.replace('0.85', '0.5')),
                borderColor: PIE_COLORS, borderWidth: 1
            }]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => `${c.raw.label}: (${c.raw.x}, ${c.raw.y})` } } },
            scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } } }
        }
    });
    _chartInstances.push(inst);
}

// ── Dashboard mode (shown on "◈ Dashboard" click) ─────────
function makeKpiCard(label, value, sub, colorVar = 'var(--accent)') {
    return `<div class="kpi-card-premium" style="--kpi-color: ${colorVar}">
        <div class="kpi-title-premium">${label}</div>
        <div class="kpi-value-premium dash-card-value">${value}</div>
        <div class="kpi-sub-premium">${sub}</div>
    </div>`;
}
function makeChartCard(title, desc, canvasId, height = 260) {
    const card = document.createElement('div');
    card.className = 'chart-card';
    card.innerHTML = `
      <div class="chart-card-header">
        <div class="chart-card-title">${title}</div>
        <div class="chart-card-desc">${desc}</div>
      </div>
      <div class="chart-canvas-wrap" style="height:${height}px;position:relative;">
        <canvas id="${canvasId}"></canvas>
      </div>`;
    return card;
}

async function loadAnalyticsDashboard() {
    // We do NOT clear the AI results text — we just overlay the dashboard
    const fullDash = document.getElementById('analytics-full-dashboard');
    if (!fullDash) return;
    
    fullDash.innerHTML = '';
    fullDash.classList.remove('hidden');

    _chartInstances.forEach(c => { try { c.destroy(); } catch (e) { } });
    _chartInstances.length = 0;

    // Create header with close button
    const header = document.createElement('div');
    header.className = 'parallax-dash-header';
    header.innerHTML = `
        <div>
            <h2>Operations <span style="color:var(--accent);">Dashboard</span></h2>
            <div class="subtitle">Live Nationwide Analytics</div>
        </div>
        <button onclick="document.getElementById('analytics-full-dashboard').classList.add('hidden')" class="dash-close-btn-premium">✕</button>
    `;
    fullDash.appendChild(header);

    const [anRes, chemRes, delRes, fbRes] = await Promise.all([
        api('/api/analytics/regional', authBody()).catch(() => ({ analytics: {} })),
        api('/api/chemicals', authBody()).catch(() => ({ chemicals: [] })),
        api('/api/deliveries', authBody()).catch(() => ({ deliveries: [] })),
        api('/api/feedback/list', authBody()).catch(() => ({ feedback: [] }))
    ]);
    const analytics = anRes.analytics || {}, chemicals = chemRes.chemicals || [];
    const deliveries = delRes.deliveries || [];
    const feedbacks = fbRes.feedback || [];
    const PROVS = ['Punjab', 'KPK', 'Sindh', 'Balochistan'];

    let totalRev = 0, totalQty = 0, totalDel = 0, totalFb = 0, sentSum = 0;
    PROVS.forEach(p => {
        const a = analytics[p] || {};
        totalRev += a.total_revenue || 0; totalQty += a.total_quantity_kg || 0;
        totalDel += a.total_deliveries || 0; totalFb += a.total_feedback || 0;
        if (a.avg_sentiment && a.total_feedback) sentSum += a.avg_sentiment * a.total_feedback;
    });
    const avgSent = totalFb > 0 ? sentSum / totalFb : 0;

    const chartsSection = document.createElement('div');
    chartsSection.className = 'an-charts-section';

    // KPI row
    const kpiRow = document.createElement('div');
    kpiRow.className = 'kpi-row-premium';
    kpiRow.id = 'dashboard-cards'; // Added so CountUp animation targets it
    kpiRow.innerHTML =
        makeKpiCard('Total Revenue', 'PKR ' + (totalRev / 1000).toFixed(0) + 'K', 'All provinces', 'var(--gold)') +
        makeKpiCard('Volume Sold', totalQty.toFixed(0) + ' kg', '90-day period', 'var(--accent)') +
        makeKpiCard('Deliveries', totalDel, 'All statuses', 'var(--blue)') +
        makeKpiCard('Avg Sentiment', (avgSent * 100).toFixed(0) + '%', totalFb + ' reviews', avgSent >= .6 ? 'var(--accent)' : avgSent >= .4 ? 'var(--gold)' : 'var(--danger)') +
        makeKpiCard('Catalog', chemicals.length + ' SKUs', 'Active chemicals', 'var(--purple)');
    chartsSection.appendChild(kpiRow);

    const grid = document.createElement('div');
    grid.className = 'an-charts-grid';
    chartsSection.appendChild(grid);
    fullDash.appendChild(chartsSection);

    // Revenue by province
    {
        const card = makeChartCard('Revenue by Province', 'Total PKR revenue per province.', 'db-ch-1');
        card.style.gridColumn = '1/-1';
        card.style.maxWidth = '1000px';
        card.style.margin = '0 auto';
        card.style.width = '100%';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-1');
        if (ctx) {
            const vals = PROVS.map(p => Math.round((analytics[p] || {}).total_revenue || 0));
            const inst = new Chart(ctx, {
                type: 'bar', data: {
                    labels: PROVS, datasets: [{
                        label: 'Revenue (PKR)', data: vals,
                        backgroundColor: ['rgba(0,230,195,0.2)', 'rgba(245,158,11,0.2)', 'rgba(167,139,250,0.2)', 'rgba(96,180,255,0.2)'],
                        borderColor: ['rgba(0,230,195,0.9)', 'rgba(245,158,11,0.9)', 'rgba(167,139,250,0.9)', 'rgba(96,180,255,0.9)'],
                        borderWidth: 1.5, borderRadius: 8
                    }]
                }, options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => 'PKR ' + c.raw.toLocaleString('en-PK') } } },
                    scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => 'PKR ' + (v / 1000).toFixed(0) + 'K' } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // Interactive Map
    {
        const card = makeChartCard('Live Operations Map', 'Geospatial visualization of ongoing deliveries across the country.', 'db-ch-map', 480);
        card.style.gridColumn = '1/-1';
        // Transform the canvas into a map div
        setTimeout(() => {
            const cEl = document.getElementById('db-ch-map');
            if (!cEl) return;
            const parent = cEl.parentNode;
            
            const mapDiv = document.createElement('div');
            mapDiv.id = 'an-full-map';
            mapDiv.style.cssText = 'position:absolute; inset:0; border-radius:12px;';
            
            cEl.remove();
            parent.appendChild(mapDiv);
            
            if (window._anFullMap) { window._anFullMap.remove(); window._anFullMap = null; }
            if (window.L) {
                const map = L.map('an-full-map').setView([30.3753, 69.3451], 5);
                L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', { maxZoom: 20 }).addTo(map);
                const bounds = L.latLngBounds();
                let hasLocs = false;
                
                deliveries.forEach(d => {
                    if (d.delivery_lat && d.delivery_lng) {
                        hasLocs = true; bounds.extend([d.delivery_lat, d.delivery_lng]);
                        let color = '#a78bfa';
                        if (d.status === 'ordered') color = '#9ca3af';
                        if (d.status === 'in_transit') color = '#f59e0b';
                        if (d.status === 'delivered') color = '#10b981';
                        
                        const icon = L.divIcon({
                            className: '',
                            html: `<div style="width:14px;height:14px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 0 6px rgba(0,0,0,0.5);"></div>`,
                            iconSize: [14, 14], iconAnchor: [7, 7]
                        });
                        L.marker([d.delivery_lat, d.delivery_lng], { icon })
                            .bindPopup(`<strong>${esc2(d.chem_name)}</strong><br>${d.quantity_kg}kg · ${d.status.replace('_', ' ')}`)
                            .addTo(map);
                    }
                });
                if (hasLocs) map.fitBounds(bounds.pad(0.2));
                window._anFullMap = map;
            }
        }, 50);
    }
    // Volume by province
    {
        const card = makeChartCard('Volume Sold by Province (kg)', 'Balochistan and KPK lead in kg volume — bulk minerals and solvents dominate.', 'db-ch-2');
        card.style.gridColumn = '1/-1';
        card.style.maxWidth = '1000px';
        card.style.margin = '0 auto';
        card.style.width = '100%';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-2');
        if (ctx) {
            const vals = PROVS.map(p => Math.round((analytics[p] || {}).total_quantity_kg || 0));
            const inst = new Chart(ctx, {
                type: 'bar', data: {
                    labels: PROVS, datasets: [{
                        label: 'Volume (kg)', data: vals,
                        backgroundColor: ['rgba(0,230,195,0.15)', 'rgba(245,158,11,0.15)', 'rgba(167,139,250,0.15)', 'rgba(96,180,255,0.15)'],
                        borderColor: ['rgba(0,230,195,0.9)', 'rgba(245,158,11,0.9)', 'rgba(167,139,250,0.9)', 'rgba(96,180,195,0.9)'],
                        borderWidth: 1.5, borderRadius: 8
                    }]
                }, options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: CHART_TOOLTIP },
                    scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => v + 'kg' } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // Monthly trend
    {
        const card = makeChartCard('Monthly Revenue Trend by Province', 'Month-over-month per province. Feb 2026 Sindh spike reflects bulk KMnO₄ orders.', 'db-ch-3', 280);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-3');
        if (ctx) {
            const months = [...new Set(PROVS.flatMap(p => (analytics[p] || {}).monthly_trend || []).map(m => m.month))].sort();
            const colors = [PALETTE.cyan, PALETTE.gold, PALETTE.purple, PALETTE.blue];
            const datasets = PROVS.map((p, i) => {
                const trend = (analytics[p] || {}).monthly_trend || [];
                return {
                    label: p, data: months.map(m => { const e = trend.find(t => t.month === m); return e ? Math.round(e.rev) : 0; }),
                    borderColor: colors[i].border, backgroundColor: colors[i].bg, pointBackgroundColor: colors[i].point,
                    tension: 0.4, fill: false, borderWidth: 2, pointRadius: 3
                };
            });
            const inst = new Chart(ctx, {
                type: 'line', data: { labels: months, datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: TICK_COLOR, font: { size: 10 } } }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.dataset.label + ': PKR ' + c.raw.toLocaleString('en-PK') } } },
                    scales: { x: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => 'PKR ' + (v / 1000).toFixed(0) + 'K' } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // Inventory stock
    {
        const card = makeChartCard('Live Inventory Stock Levels (kg)', 'Red bars = below 50kg low-stock threshold. Green = healthy stock.', 'db-ch-4', 260);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-4');
        if (ctx) {
            const sorted = [...chemicals].sort((a, b) => b.amount_kg - a.amount_kg);
            const inst = new Chart(ctx, {
                type: 'bar', data: {
                    labels: sorted.map(c => c.name), datasets: [{
                        label: 'Stock (kg)',
                        data: sorted.map(c => c.amount_kg),
                        backgroundColor: sorted.map(c => c.amount_kg < 50 ? 'rgba(244,63,94,0.25)' : 'rgba(0,230,195,0.15)'),
                        borderColor: sorted.map(c => c.amount_kg < 50 ? 'rgba(244,63,94,0.9)' : 'rgba(0,230,195,0.7)'),
                        borderWidth: 1.5, borderRadius: 6
                    }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.raw + ' kg' + (c.raw < 50 ? ' ⚠ LOW STOCK' : '') } } },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: TICK_COLOR, font: { size: 10 }, maxRotation: 35 } },
                        y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => v + 'kg' } }
                    }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 5: Delivery Status Distribution ────────────────
    {
        const card = makeChartCard('Delivery Status Distribution', 'Breakdown of all deliveries by current status across all provinces.', 'db-ch-5');
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-5');
        if (ctx) {
            const statusTotals = {};
            PROVS.forEach(p => {
                const d = (analytics[p] || {}).deliveries || {};
                Object.keys(d).forEach(s => { statusTotals[s] = (statusTotals[s] || 0) + d[s]; });
            });
            const statusLabels = ['ordered', 'processing', 'in_transit', 'delivered'];
            const statusNames = ['Ordered', 'Processing', 'In Transit', 'Delivered'];
            const vals = statusLabels.map(s => statusTotals[s] || 0);
            const inst = new Chart(ctx, {
                type: 'doughnut',
                data: { labels: statusNames, datasets: [{ data: vals, backgroundColor: PIE_COLORS, borderWidth: 0, hoverOffset: 6 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: TICK_COLOR, font: { size: 10 }, padding: 12 } }, tooltip: CHART_TOOLTIP } }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 6: Sentiment Score by Province ─────────────────
    {
        const card = makeChartCard('Customer Sentiment by Province', 'Average sentiment score (0–100%) per province based on delivery feedback.', 'db-ch-6');
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-6');
        if (ctx) {
            const sentVals = PROVS.map(p => Math.round(((analytics[p] || {}).avg_sentiment || 0) * 100));
            const sentColors = sentVals.map(v => v >= 60 ? 'rgba(0,230,195,0.75)' : v >= 40 ? 'rgba(245,158,11,0.75)' : 'rgba(244,63,94,0.75)');
            const inst = new Chart(ctx, {
                type: 'bar',
                data: { labels: PROVS, datasets: [{ label: 'Sentiment %', data: sentVals, backgroundColor: sentColors, borderColor: sentColors.map(c=>c.replace('0.75','1')), borderWidth: 1.5, borderRadius: 8 }] },
                options: {
                    indexAxis: 'y', responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.raw + '%' } } },
                    scales: { x: { min: 0, max: 100, grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => v + '%' } }, y: { grid: { display: false }, ticks: { color: TICK_COLOR } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 7: Category Revenue Share ──────────────────────
    {
        const card = makeChartCard('Revenue by Chemical Category', 'Which product categories drive the most PKR revenue overall.', 'db-ch-7');
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-7');
        if (ctx) {
            const catRev = {};
            chemicals.forEach(c => {
                const cat = c.category || 'General';
                catRev[cat] = (catRev[cat] || 0) + (+c.price_per_kg * +c.quantity_sold);
            });
            const labels = Object.keys(catRev); const vals = labels.map(k => Math.round(catRev[k]));
            const inst = new Chart(ctx, {
                type: 'doughnut',
                data: { labels, datasets: [{ data: vals, backgroundColor: PIE_COLORS, borderWidth: 0, hoverOffset: 6 }] },
                options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { position: 'right', labels: { color: TICK_COLOR, font: { size: 10 }, padding: 12 } }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => 'PKR ' + c.raw.toLocaleString('en-PK') } } } }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 8: Price per kg Comparison ─────────────────────
    {
        const card = makeChartCard('Price per kg — All Chemicals', 'Compare pricing across the entire catalog. High-value chemicals identified.', 'db-ch-8', 280);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-8');
        if (ctx) {
            const sorted = [...chemicals].sort((a, b) => b.price_per_kg - a.price_per_kg);
            const inst = new Chart(ctx, {
                type: 'bar', data: {
                    labels: sorted.map(c => c.name),
                    datasets: [{ label: 'Price/kg (PKR)', data: sorted.map(c => +c.price_per_kg),
                        backgroundColor: sorted.map((_, i) => PIE_COLORS[i % PIE_COLORS.length].replace('0.85','0.2')),
                        borderColor: sorted.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
                        borderWidth: 1.5, borderRadius: 6 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => 'PKR ' + c.raw + '/kg' } } },
                    scales: { x: { grid: { display: false }, ticks: { color: TICK_COLOR, font: { size: 9 }, maxRotation: 35 } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => 'PKR ' + v } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 9: Top Chemicals by Estimated Revenue ───────────
    {
        const card = makeChartCard('Top Chemicals by Revenue Contribution', 'Chemicals ranked by (price × quantity sold) — your highest revenue generators.', 'db-ch-9');
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-9');
        if (ctx) {
            const ranked = [...chemicals].map(c => ({ name: c.name, rev: (+c.price_per_kg) * (+c.quantity_sold) }))
                .filter(c => c.rev > 0).sort((a,b) => b.rev - a.rev).slice(0, 8);
            const inst = new Chart(ctx, {
                type: 'bar', data: {
                    labels: ranked.map(c => c.name),
                    datasets: [{ label: 'Revenue (PKR)', data: ranked.map(c => Math.round(c.rev)),
                        backgroundColor: 'rgba(0,230,195,0.15)', borderColor: 'rgba(0,230,195,0.9)', borderWidth: 1.5, borderRadius: 8 }]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => 'PKR ' + c.raw.toLocaleString('en-PK') } } },
                    scales: { x: { grid: { display: false }, ticks: { color: TICK_COLOR, font: { size: 9 }, maxRotation: 35 } }, y: { grid: { color: GRID_COLOR }, ticks: { color: TICK_COLOR, callback: v => 'PKR ' + (v/1000).toFixed(0) + 'K' } } }
                }
            });
            _chartInstances.push(inst);
        }
    }
    // ── Chart 10: Province Radar ───────────────────────────────
    {
        const card = makeChartCard('Province Performance Radar', 'Multi-dimensional comparison: Revenue, Volume, Deliveries, Sentiment and Chemicals per province.', 'db-ch-10', 380);
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctx = document.getElementById('db-ch-10');
        if (ctx) {
            const maxRev = Math.max(...PROVS.map(p => (analytics[p]||{}).total_revenue||0)) || 1;
            const maxQty = Math.max(...PROVS.map(p => (analytics[p]||{}).total_quantity_kg||0)) || 1;
            const maxDel = Math.max(...PROVS.map(p => (analytics[p]||{}).total_deliveries||0)) || 1;
            const colors = [PALETTE.cyan, PALETTE.gold, PALETTE.purple, PALETTE.blue];
            const datasets = PROVS.map((p, i) => {
                const a = analytics[p] || {};
                return {
                    label: p,
                    data: [
                        Math.round(((a.total_revenue||0)/maxRev)*100),
                        Math.round(((a.total_quantity_kg||0)/maxQty)*100),
                        Math.round(((a.total_deliveries||0)/maxDel)*100),
                        Math.round((a.avg_sentiment||0)*100),
                        Math.round(((a.chemical_count||0)/12)*100)
                    ],
                    borderColor: colors[i].border, backgroundColor: colors[i].bg,
                    pointBackgroundColor: colors[i].point, borderWidth: 1.5, pointRadius: 3
                };
            });
            const inst = new Chart(ctx, {
                type: 'radar',
                data: { labels: ['Revenue', 'Volume', 'Deliveries', 'Sentiment', 'Catalog'], datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { labels: { color: TICK_COLOR, font: { size: 10 }, padding: 16 } }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => c.dataset.label + ': ' + c.raw + '%' } } },
                    scales: { r: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,.06)' }, pointLabels: { color: TICK_COLOR, font: { size: 11 } }, ticks: { display: false }, angleLines: { color: 'rgba(255,255,255,.06)' } } }
                }
            });
            _chartInstances.push(inst);
        }
    }

    // ── ADVANCED CHART 3: Logistics Pipeline (DOM/CSS Funnel) ──
    {
        const card = makeChartCard('Logistics Pipeline Funnel', 'Real-time bottleneck detector. Width proportional to count.', 'adv-ch-3', 380);
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctxEl = document.getElementById('adv-ch-3');
        if (ctxEl) {
            const parent = ctxEl.parentNode;
            ctxEl.remove();
            
            let counts = { ordered: 0, processing: 0, in_transit: 0, delivered: 0 };
            deliveries.forEach(d => { if (counts[d.status] !== undefined) counts[d.status]++; });
            const stages = [
                { id: 'ordered', name: 'Ordered', count: counts.ordered, color: '#3b82f6' },
                { id: 'processing', name: 'Processing', count: counts.processing, color: '#8b5cf6' },
                { id: 'in_transit', name: 'In Transit', count: counts.in_transit, color: '#f59e0b' },
                { id: 'delivered', name: 'Delivered', count: counts.delivered, color: '#10b981' }
            ];
            
            const maxVal = Math.max(...stages.map(s => s.count), 1);
            let funnelHtml = `<div style="display:flex;flex-direction:column;align-items:center;padding:20px 0;width:100%;height:100%;box-sizing:border-box;">`;
            
            stages.forEach((st, i) => {
                const w = Math.max((st.count / maxVal) * 100, 15); // min 15% width
                // Next width for trapezoid clip-path illusion
                const nextW = i < stages.length - 1 ? Math.max((stages[i+1].count / maxVal) * 100, 15) : w * 0.8; 
                const diff = (100 - (nextW / w * 100)) / 2;
                const clipPath = `polygon(0% 0%, 100% 0%, ${100-diff}% 100%, ${diff}% 100%)`;
                
                funnelHtml += `
                    <div style="width:${w}%; height:50px; background:${st.color}; margin-bottom:4px; 
                                clip-path:${clipPath}; display:flex; align-items:center; justify-content:center;
                                color:white; font-family:var(--mono); font-size:12px; font-weight:bold; letter-spacing:1px;
                                text-shadow:0 1px 4px rgba(0,0,0,0.5); transition:0.3s; cursor:crosshair;"
                         onmouseover="this.style.filter='brightness(1.2) drop-shadow(0 0 12px ${st.color})'"
                         onmouseout="this.style.filter='none'">
                        ${st.name}: ${st.count}
                    </div>
                `;
                
                if (i < stages.length - 1) {
                    const drop = st.count - stages[i+1].count;
                    const dropPct = st.count > 0 ? ((drop / st.count) * 100).toFixed(0) : 0;
                    const dropColor = dropPct > 30 ? '#ef4444' : 'rgba(255,255,255,0.4)';
                    funnelHtml += `
                        <div style="font-size:10px; color:${dropColor}; margin:4px 0; font-family:var(--mono);">
                            ↓ Drop: ${drop} (${dropPct}%)
                        </div>
                    `;
                }
            });
            funnelHtml += `</div>`;
            
            const mapDiv = document.createElement('div');
            mapDiv.style.cssText = 'position:absolute; inset:0; border-radius:12px; overflow-y:auto; overflow-x:hidden;';
            mapDiv.innerHTML = funnelHtml;
            parent.appendChild(mapDiv);
        }
    }

    // ── ADVANCED CHART 1: Revenue Growth Velocity (Curved Area) ──
    {
        const card = makeChartCard('Revenue Growth Velocity', 'Total PKR revenue over time. Solid area indicates momentum.', 'adv-ch-1', 320);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctxEl = document.getElementById('adv-ch-1');
        if (ctxEl) {
            // Aggregate monthly trend across all provinces
            const monthMap = {};
            PROVS.forEach(p => {
                const trend = (analytics[p] || {}).monthly_trend || [];
                trend.forEach(t => { monthMap[t.month] = (monthMap[t.month] || 0) + t.rev; });
            });
            const months = Object.keys(monthMap).sort();
            const vals = months.map(m => monthMap[m]);

            const ctx = ctxEl.getContext('2d');
            const gradientLine = ctx.createLinearGradient(0, 0, ctxEl.clientWidth, 0);
            gradientLine.addColorStop(0, '#00d4ff');
            gradientLine.addColorStop(1, '#7b2ff7');

            const gradientFill = ctx.createLinearGradient(0, 0, 0, ctxEl.clientHeight);
            gradientFill.addColorStop(0, 'rgba(123, 47, 247, 0.6)');
            gradientFill.addColorStop(1, 'rgba(123, 47, 247, 0.0)');

            const inst = new Chart(ctxEl, {
                type: 'line', data: {
                    labels: months, datasets: [{
                        label: 'Total Revenue (PKR)', data: vals,
                        borderColor: gradientLine, backgroundColor: gradientFill,
                        borderWidth: 3, tension: 0.4, fill: true,
                        pointBackgroundColor: '#fff', pointBorderColor: '#7b2ff7', pointRadius: 4,
                        pointHoverRadius: 8, pointHoverBackgroundColor: '#00d4ff', pointHoverBorderColor: '#fff'
                    }]
                }, options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { x: { type: 'number', easing: 'linear', duration: 1200, from: 0 } },
                    plugins: { legend: { display: false }, tooltip: { ...CHART_TOOLTIP, callbacks: { label: c => 'PKR ' + c.raw.toLocaleString('en-PK') } } },
                    scales: {
                        x: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR } },
                        y: { grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR, callback: v => 'PKR ' + (v / 1000).toFixed(0) + 'K' } }
                    }
                }
            });
            _chartInstances.push(inst);
        }
    }

    // ── ADVANCED CHART 2: Category Performance Matrix (Bubble) ──
    {
        const card = makeChartCard('Category Performance Matrix', 'Bubble size = Customer Sentiment. X = Volume. Y = Revenue.', 'adv-ch-2', 380);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctxEl = document.getElementById('adv-ch-2');
        if (ctxEl) {
            // Aggregate metrics by category
            const catStats = {};
            chemicals.forEach(ch => {
                const cat = ch.category || 'General';
                if (!catStats[cat]) catStats[cat] = { vol: 0, rev: 0, sentSum: 0, fbCount: 0, name: cat };
                catStats[cat].vol += ch.quantity_sold;
                catStats[cat].rev += (ch.quantity_sold * ch.price_per_kg);
            });
            
            // Link sentiment from feedback back to category
            feedbacks.forEach(fb => {
                const ch = chemicals.find(c => c.name === fb.chemical);
                if (ch) {
                    const cat = ch.category || 'General';
                    if (catStats[cat]) { catStats[cat].sentSum += fb.sentiment_score; catStats[cat].fbCount++; }
                }
            });

            const catList = Object.values(catStats);
            const datasets = catList.map((cat, i) => {
                const avgSent = cat.fbCount > 0 ? (cat.sentSum / cat.fbCount) : 0.5; // default 0.5 if no feedback
                const rCalc = Math.max(Math.min(Math.sqrt(avgSent * 100) * 4, 60), 8); // Scaled non-linearly
                const hue = i * 47;
                return {
                    label: cat.name,
                    data: [{ x: cat.vol, y: cat.rev, r: rCalc, _sent: avgSent }],
                    backgroundColor: `hsla(${hue}, 80%, 60%, 0.75)`,
                    borderColor: `hsl(${hue}, 80%, 70%)`, borderWidth: 2,
                    hoverBackgroundColor: `hsla(${hue}, 100%, 70%, 1)`, hoverBorderColor: '#fff'
                };
            });

            const inst = new Chart(ctxEl, {
                type: 'bubble', data: { datasets },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { 
                        legend: { position: 'right', labels: { color: TICK_COLOR, font: { size: 10 } } }, 
                        tooltip: { ...CHART_TOOLTIP, callbacks: { 
                            label: c => `${c.dataset.label}: PKR ${(c.raw.y/1000).toFixed(1)}K | ${c.raw.x}kg | Sent: ${(c.raw._sent*100).toFixed(0)}%` 
                        }} 
                    },
                    scales: {
                        x: { type: 'logarithmic', title: { display: true, text: 'Volume (kg)', color: 'rgba(255,255,255,0.4)' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR, maxTicksLimit: 6 } },
                        y: { type: 'logarithmic', title: { display: true, text: 'Revenue (PKR)', color: 'rgba(255,255,255,0.4)' }, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR, callback: v => (v/1000).toFixed(0)+'K' } }
                    }
                }
            });
            _chartInstances.push(inst);
        }
    }

    // ── ADVANCED CHART 4: Capital Tied-In Inventory ──
    {
        const card = makeChartCard('Capital Tied-in Dashboard', 'Left Y = Total kg inside warehouse. Right Y = PKR locked in stock. Red band = Capital Risk overhead.', 'adv-ch-4', 380);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctxEl = document.getElementById('adv-ch-4');
        if (ctxEl) {
            const sorted = [...chemicals].map(c => ({
                name: c.name,
                qty: +c.amount_kg,
                cap: (+c.amount_kg) * (+c.price_per_kg)
            })).sort((a, b) => b.cap - a.cap).slice(0, 15); // Top 15 tying up most capital

            const inst = new Chart(ctxEl, {
                type: 'bar',
                data: {
                    labels: sorted.map(c => c.name.length > 15 ? c.name.substring(0,12)+'...' : c.name),
                    datasets: [
                        {
                            label: 'Capital Lock-up (PKR)', data: sorted.map(c => c.cap),
                            type: 'line', yAxisID: 'y1',
                            borderColor: '#f59e0b', backgroundColor: '#f59e0b',
                            borderWidth: 3, tension: 0.3, pointRadius: 4, pointBackgroundColor: '#f59e0b',
                        },
                        {
                            label: 'Inventory Qty (kg)', data: sorted.map(c => c.qty),
                            yAxisID: 'y',
                            backgroundColor: 'rgba(96, 180, 255, 0.4)', borderColor: 'rgba(96, 180, 255, 0.8)',
                            borderWidth: 1.5, borderRadius: { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 }
                        }
                    ]
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    plugins: { legend: { position: 'top', labels: { color: TICK_COLOR } }, tooltip: CHART_TOOLTIP },
                    scales: {
                        x: { grid: { display: false }, ticks: { color: TICK_COLOR, maxRotation: 35, minRotation: 35, font: {size: 10} } },
                        y: { 
                            type: 'linear', position: 'left', title: { display: true, text: 'Inventory Qty (kg)', color: 'rgba(96, 180, 255, 0.8)' },
                            grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR } 
                        },
                        y1: { 
                            type: 'linear', position: 'right', title: { display: true, text: 'Tied Capital (PKR)', color: '#f59e0b' },
                            grid: { display: false }, ticks: { color: TICK_COLOR, callback: v => (v/1000).toFixed(0)+'K' } 
                        }
                    }
                }
            });
            _chartInstances.push(inst);
        }
    }

    // ── ADVANCED CHART 5: Sentiment Scatter & Moving Average ──
    {
        const card = makeChartCard('Customer Sentiment Timeline', 'Individual scores vs rolling 7-score moving average over time.', 'adv-ch-5', 380);
        card.style.gridColumn = '1/-1';
        grid.appendChild(card);
        await new Promise(r => setTimeout(r, 50));
        const ctxEl = document.getElementById('adv-ch-5');
        if (ctxEl) {
            // Sort feedbacks chronologically and filter out null/undefined scores
            const fbSorted = [...feedbacks]
                .filter(f => f.sentiment_score !== null && f.sentiment_score !== undefined)
                .sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

            // If no feedback with valid scores, show a styled empty state
            if (fbSorted.length === 0) {
                const parent = ctxEl.parentNode;
                ctxEl.remove();
                const emptyDiv = document.createElement('div');
                emptyDiv.style.cssText = `
                    position:absolute; inset:0; display:flex; flex-direction:column;
                    align-items:center; justify-content:center; gap:12px;
                    color:rgba(255,255,255,0.35); font-family:var(--mono);
                `;
                emptyDiv.innerHTML = `
                    <div style="font-size:38px;opacity:0.4;">💬</div>
                    <div style="font-size:13px;letter-spacing:1px;text-transform:uppercase;">No Feedback Submitted Yet</div>
                    <div style="font-size:11px;opacity:0.6;max-width:280px;text-align:center;line-height:1.6;">
                        Sentiment scores will appear here once users rate their deliveries.
                    </div>`;
                parent.appendChild(emptyDiv);
            } else {
                // Format labels
                const labels = fbSorted.map(f => {
                    const d = new Date(f.created_at);
                    return d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
                });

                const rawScores = fbSorted.map(f => Math.round((f.sentiment_score || 0) * 100));

                // Colour-coded bars: red < 40, amber 40-69, green >= 70
                const scatterColors = rawScores.map(s => s < 40 ? 'rgba(239,68,68,0.85)' : s < 70 ? 'rgba(245,158,11,0.85)' : 'rgba(16,185,129,0.85)');

                // 7-item Simple Moving Average
                const sma = rawScores.map((_, i, arr) => {
                    const subset = arr.slice(Math.max(0, i - 6), i + 1);
                    return +(subset.reduce((a, b) => a + b, 0) / subset.length).toFixed(1);
                });

                const inst = new Chart(ctxEl, {
                    type: 'bar',
                    data: {
                        labels,
                        datasets: [
                            {
                                type: 'line', label: '7-Score Moving Avg', data: sma,
                                borderColor: 'rgba(255,255,255,0.85)', borderWidth: 2.5,
                                pointRadius: 0, tension: 0.4, fill: false, order: 1
                            },
                            {
                                type: 'bar', label: 'Sentiment Score', data: rawScores,
                                backgroundColor: scatterColors,
                                borderColor: scatterColors.map(c => c.replace('0.85', '1')),
                                borderWidth: 0, borderRadius: 3, barThickness: 'flex',
                                maxBarThickness: 20, order: 2
                            }
                        ]
                    },
                    options: {
                        responsive: true, maintainAspectRatio: false,
                        plugins: {
                            legend: { position: 'top', labels: { color: TICK_COLOR, font: { size: 10 } } },
                            tooltip: {
                                ...CHART_TOOLTIP,
                                callbacks: {
                                    title: (items) => labels[items[0].dataIndex] || '',
                                    label: c => `${c.dataset.label}: ${Number(c.raw).toFixed(0)}%`
                                }
                            }
                        },
                        scales: {
                            x: { grid: { color: 'rgba(255,255,255,0.06)' }, ticks: { color: TICK_COLOR, maxTicksLimit: 12, maxRotation: 35 } },
                            y: { min: 0, max: 100, grid: { color: 'rgba(255,255,255,0.05)' }, ticks: { color: TICK_COLOR, callback: v => v + '%' } }
                        }
                    }
                });
                _chartInstances.push(inst);
            }
        }
    }
}
function renderBar3D(ch, container, pal) {
    if (!window.THREE) {
        // Fallback if three.js not loaded
        const canvas = document.createElement('canvas');
        container.innerHTML = '';
        container.appendChild(canvas);
        if (typeof renderBar2D === 'function') renderBar2D(ch, canvas, pal);
        return;
    }
    
    container.innerHTML = ''; // remove existing canvas
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x040810, 0.04);

    const camera = new THREE.PerspectiveCamera(45, container.clientWidth / container.clientHeight, 0.1, 1000);
    camera.position.set(0, 5, 14);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);

    const amLight = new THREE.AmbientLight(0xffffff, 0.6);
    scene.add(amLight);
    const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    dirLight.position.set(5, 10, 7);
    scene.add(dirLight);

    const data = ch.data || [];
    const maxVal = Math.max(...data.map(d => d.y), 1);
    const count = data.length;
    const spacing = 1.8;
    const totalWidth = (count - 1) * spacing;
    let startX = -totalWidth / 2;

    const baseColor = new THREE.Color(pal.point || 0x00e6c3);
    const meshes = [];

    data.forEach((d, i) => {
        const height = Math.max((d.y / maxVal) * 6, 0.2);
        const geometry = new THREE.BoxGeometry(0.9, height, 0.9);
        
        const material = new THREE.MeshPhongMaterial({ 
            color: baseColor.clone().offsetHSL(0, 0, (i/count)*0.15 - 0.05),
            transparent: true,
            opacity: 0.85,
            shininess: 90
        });

        const cube = new THREE.Mesh(geometry, material);
        cube.position.set(startX + i * spacing, height / 2 - 2, 0);
        
        const edges = new THREE.EdgesGeometry(geometry);
        const line = new THREE.LineSegments(edges, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.3 }));
        cube.add(line);
        
        scene.add(cube);
        meshes.push(cube);
        
        // Label
        const canvas2d = document.createElement('canvas');
        canvas2d.width = 128; canvas2d.height = 32;
        const ctx2d = canvas2d.getContext('2d');
        ctx2d.fillStyle = 'rgba(237,245,243,0.8)';
        ctx2d.font = 'bold 20px monospace';
        ctx2d.textAlign = 'center';
        ctx2d.fillText(d.x, 64, 24);
        
        const tex = new THREE.CanvasTexture(canvas2d);
        const spriteMat = new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false });
        const sprite = new THREE.Sprite(spriteMat);
        sprite.scale.set(0.12, 0.03, 1);
        sprite.position.set(startX + i * spacing, -2.5, 0);
        scene.add(sprite);
    });

    const gridHelper = new THREE.GridHelper(15, 15, 0x00e6c3, 0x00e6c3);
    gridHelper.material.opacity = 0.05;
    gridHelper.material.transparent = true;
    gridHelper.position.y = -2;
    scene.add(gridHelper);

    let frameId;
    let angle = 0;
    function animate() {
        frameId = requestAnimationFrame(animate);
        angle += 0.005;
        camera.position.x = Math.sin(angle) * 14;
        camera.position.z = Math.cos(angle) * 14;
        camera.lookAt(0, 0, 0);
        renderer.render(scene, camera);
    }
    animate();

    const resizeObj = new ResizeObserver(() => {
        if(container.clientWidth === 0) return;
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
    resizeObj.observe(container);
}