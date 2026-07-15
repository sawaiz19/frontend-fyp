// ============================================================
//  ChemTech — viz-enhancements.js
//  Features: 6 (Pakistan Province Heat Map), 7 (Chart Type Toggle)
// ============================================================
'use strict';

var VIZ_API = 'http://localhost:5000';

// ============================================================
//  FEATURE 6 — Pakistan Province Heat Map (SVG Choropleth)
// ============================================================
var PROV_PATHS = {
    Balochistan: 'M10,80 L70,58 L92,82 L112,122 L140,168 L162,232 L174,288 L144,312 L98,328 L55,312 L18,272 L6,210 L4,145 Z',
    Sindh:       'M162,232 L174,288 L194,308 L228,310 L234,278 L244,250 L226,218 L204,200 L182,196 Z',
    Punjab:      'M182,196 L204,200 L226,218 L244,250 L258,196 L268,148 L250,100 L226,82 L204,76 L192,98 L180,140 L176,185 Z',
    KPK:         'M176,185 L180,140 L192,98 L204,76 L212,50 L194,22 L170,16 L152,32 L148,72 L162,100 L172,118 Z'
};

var PROV_LABEL = {
    Balochistan: [72,  200],
    Sindh:       [200, 265],
    Punjab:      [226, 160],
    KPK:         [175, 95]
};

function buildHeatMapSVG(provData) {
    var maxRev = 1;
    Object.keys(provData).forEach(function(p) {
        if ((provData[p].revenue || 0) > maxRev) maxRev = provData[p].revenue;
    });

    var html = Object.keys(PROV_PATHS).map(function(prov) {
        var d   = provData[prov] || { revenue: 0, deliveries: 0 };
        var pct = (d.revenue || 0) / maxRev;
        var a   = (0.15 + pct * 0.70).toFixed(2);
        var lx  = PROV_LABEL[prov][0];
        var ly  = PROV_LABEL[prov][1];
        return '<path class="hmap-prov" d="' + PROV_PATHS[prov] + '"' +
               ' fill="rgba(0,230,195,' + a + ')" stroke="rgba(0,230,195,0.3)" stroke-width="1.5"' +
               ' data-prov="' + prov + '" data-rev="' + (d.revenue || 0) + '" data-del="' + (d.deliveries || 0) + '"/>' +
               '<text x="' + lx + '" y="' + ly + '" class="hmap-label">' + prov + '</text>' +
               '<text x="' + lx + '" y="' + (ly + 13) + '" class="hmap-sublabel">' + (d.deliveries || 0) + ' del</text>';
    }).join('');

    return '<svg id="prov-heatmap" viewBox="0 0 300 350" xmlns="http://www.w3.org/2000/svg">' + html + '</svg>';
}

function injectHeatMap(analytics) {
    var wrap = document.getElementById('province-heatmap-container');
    if (!wrap) return;

    var provData = {};
    ['Punjab', 'KPK', 'Sindh', 'Balochistan'].forEach(function(p) {
        var a = (analytics || {})[p] || {};
        provData[p] = { revenue: a.total_revenue || 0, deliveries: a.total_deliveries || 0 };
    });

    wrap.innerHTML = buildHeatMapSVG(provData) + '<div id="hmap-tooltip"></div>';

    var tooltip = document.getElementById('hmap-tooltip');
    wrap.querySelectorAll('.hmap-prov').forEach(function(el) {
        el.addEventListener('mouseenter', function() {
            if (!tooltip) return;
            var rev = parseFloat(el.dataset.rev) || 0;
            tooltip.innerHTML = '<strong>' + el.dataset.prov + '</strong><br>' +
                'Revenue: PKR ' + rev.toLocaleString('en-PK') + '<br>' +
                'Deliveries: ' + (el.dataset.del || 0);
            tooltip.classList.add('visible');
        });
        el.addEventListener('mousemove', function(e) {
            if (!tooltip) return;
            var r = wrap.getBoundingClientRect();
            tooltip.style.left = (e.clientX - r.left + 14) + 'px';
            tooltip.style.top  = (e.clientY - r.top  - 8)  + 'px';
        });
        el.addEventListener('mouseleave', function() {
            if (tooltip) tooltip.classList.remove('visible');
        });
    });
}

// Fetch analytics independently and render heat map
function fetchAndRenderHeatMap() {
    var u = window._currentUser;
    if (!u) return;
    var body = {};
    if (u.google_id) body.google_id = u.google_id;
    if (u.user_id)   body.caller_id = u.user_id;

    fetch(VIZ_API + '/api/analytics/regional', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    })
    .then(function(r) { return r.json(); })
    .then(function(data) { injectHeatMap(data.analytics || {}); })
    .catch(function() { /* silent fail */ });
}

// Watch for the dashboard panel becoming visible
window.addEventListener('DOMContentLoaded', function() {
    var dashPanel = document.getElementById('dashboard-panel');
    if (!dashPanel) return;
    new MutationObserver(function() {
        if (dashPanel.classList.contains('visible')) {
            setTimeout(fetchAndRenderHeatMap, 600);
        }
    }).observe(dashPanel, { attributes: true, attributeFilter: ['class'] });
});

window.injectHeatMap    = injectHeatMap;
window.refreshHeatMap   = function(analytics) { injectHeatMap(analytics); };

// ============================================================
//  FEATURE 7 — Chart Type Toggle  (uses Chart.getChart)
// ============================================================
var TOOLTIP_CFG = {
    backgroundColor: 'rgba(6,14,26,.97)',
    borderColor: 'rgba(0,230,195,0.4)', borderWidth: 1,
    titleColor: '#f0f8ff', bodyColor: 'rgba(220,240,255,0.9)',
    padding: 14, cornerRadius: 10
};
var SCALE_CFG = {
    x: { grid: { color: 'rgba(200,230,255,0.07)' }, ticks: { color: 'rgba(220,240,255,0.80)' } },
    y: { grid: { color: 'rgba(200,230,255,0.07)' }, ticks: { color: 'rgba(220,240,255,0.80)' } }
};

window.switchChartType = function(canvasId, newType) {
    var canvas = document.getElementById(canvasId);
    if (!canvas) return;
    var inst = Chart.getChart(canvas);
    if (!inst) return;

    // Update button states
    var wrap = canvas.closest('.dash-section-chart-wrap');
    if (wrap) {
        wrap.querySelectorAll('.ctt-btn').forEach(function(b) {
            b.classList.toggle('active', b.dataset.type === newType);
        });
    }

    var origData    = inst.data;
    var origIndexAxis = inst.options.indexAxis || 'x';

    inst.destroy();

    var isHBar = (newType === 'hbar');
    var chartType = isHBar ? 'bar' : newType;

    new Chart(canvas, {
        type: chartType,
        data: origData,
        options: {
            indexAxis: isHBar ? 'y' : 'x',
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: (newType === 'radar' || newType === 'doughnut'),
                    labels: { color: 'rgba(220,240,255,0.80)', font: { size: 11 } }
                },
                tooltip: TOOLTIP_CFG
            },
            scales: (newType === 'radar' || newType === 'doughnut') ? {} : SCALE_CFG
        }
    });
};

// Inject toggle buttons after a chart canvas is created inside a dash-section-chart-wrap
function injectToggleButtons(canvas) {
    var wrap = canvas.closest('.dash-section-chart-wrap');
    if (!wrap || wrap.querySelector('.chart-type-toggle')) return;

    var inst = Chart.getChart(canvas);
    if (!inst) return;

    var origType = inst.config.type;
    var initBtn  = (inst.options.indexAxis === 'y') ? 'hbar' : origType;

    var types = [
        { id: 'hbar', label: '⟺ H-Bar' },
        { id: 'bar',  label: '↕ V-Bar'  },
        { id: 'line', label: '〜 Line'   },
        { id: 'radar',label: '⬡ Radar'  }
    ];

    var bar = document.createElement('div');
    bar.className = 'chart-type-toggle';
    bar.style.cssText = 'display:flex;gap:6px;padding:8px 16px 4px;justify-content:flex-end;';
    bar.innerHTML = types.map(function(t) {
        var active = t.id === initBtn ? ' active' : '';
        return '<button class="ctt-btn' + active + '" data-type="' + t.id + '"' +
               ' onclick="switchChartType(\'' + canvas.id + '\',\'' + t.id + '\')">' +
               t.label + '</button>';
    }).join('');

    wrap.insertBefore(bar, wrap.firstChild);
}

// Observe dash chart wrappers for canvas creation
window.addEventListener('DOMContentLoaded', function() {
    var dashContent = document.getElementById('dashboard-panel');
    if (!dashContent) return;

    new MutationObserver(function(muts) {
        muts.forEach(function(m) {
            m.addedNodes.forEach(function(node) {
                if (!node.querySelectorAll) return;
                node.querySelectorAll('canvas').forEach(function(canvas) {
                    if (!canvas.id) return;
                    setTimeout(function() { injectToggleButtons(canvas); }, 120);
                });
                if (node.tagName === 'CANVAS' && node.id) {
                    setTimeout(function() { injectToggleButtons(node); }, 120);
                }
            });
        });
    }).observe(dashContent, { childList: true, subtree: true });
});
