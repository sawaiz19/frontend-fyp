// ============================================================
//  ChemTech — enhancements.js  (< 300 lines)
//  Features: 1 (CountUp), 3 (Skeleton), 4 (Stagger),
//            12 (Title Reveal), 15 (Role Badge Anim)
// ============================================================
'use strict';

// ============================================================
//  FEATURE 1 — Animated Number Counters
// ============================================================
function countUp(el, target, duration, prefix, suffix) {
    duration = duration || 1200;
    prefix   = prefix   || '';
    suffix   = suffix   || '';
    const start = performance.now();
    function step(ts) {
        const p = Math.min((ts - start) / duration, 1);
        const eased = 1 - Math.pow(1 - p, 3);
        const val = Math.round(target * eased);
        el.textContent = prefix + val.toLocaleString('en-PK') + suffix;
        if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
}

function animateDashNumbers() {
    document.querySelectorAll('.dash-card-value, .kpi-value-premium').forEach(function(el) {
        if (el._counted) return;
        el._counted = true;
        const raw = el.textContent.trim();
        if (raw.startsWith('PKR')) {
            const n = parseFloat(raw.replace(/[^0-9.]/g, '')) || 0;
            countUp(el, n, 1500, 'PKR ', '');
        } else if (raw.endsWith('%')) {
            countUp(el, parseFloat(raw) || 0, 1000, '', '%');
        } else {
            countUp(el, parseFloat(raw) || 0, 900, '', '');
        }
    });
}

// Watch #dashboard-cards and #analytics-panel for injected content
window.addEventListener('DOMContentLoaded', function() {
    const observer = new MutationObserver(function() {
        setTimeout(animateDashNumbers, 120);
    });
    
    const cardsEl = document.getElementById('dashboard-cards');
    if (cardsEl) observer.observe(cardsEl, { childList: true, subtree: true });
    
    const anPanel = document.getElementById('analytics-panel');
    if (anPanel) observer.observe(anPanel, { childList: true, subtree: true });
});

// ============================================================
//  FEATURE 3 — Skeleton Loading Screens
// ============================================================
function skRepeat(n, fn) { return Array.from({ length: n }, fn).join(''); }

function chemSkeleton() {
    return skRepeat(6, function() {
        return '<div class="sk-card">' +
            '<div class="sk-line sk-title"></div>' +
            '<div class="sk-line sk-sub"></div>' +
            '<div class="sk-grid-2">' +
                '<div class="sk-block"></div><div class="sk-block"></div>' +
                '<div class="sk-block"></div><div class="sk-block"></div>' +
            '</div>' +
            '<div class="sk-line sk-btn"></div>' +
        '</div>';
    });
}

function deliverySkeleton() {
    return skRepeat(3, function() {
        return '<div class="sk-delivery-card">' +
            '<div class="sk-row">' +
                '<div class="sk-line sk-title" style="width:55%"></div>' +
                '<div class="sk-badge"></div>' +
            '</div>' +
            '<div class="sk-line" style="width:30%;margin-top:8px"></div>' +
            '<div class="sk-progress-bar"></div>' +
        '</div>';
    });
}

function dashSkeleton() {
    return skRepeat(4, function() {
        return '<div class="sk-dash-card">' +
            '<div class="sk-line" style="width:60%;height:10px"></div>' +
            '<div class="sk-line sk-big-num"></div>' +
            '<div class="sk-line" style="width:45%;height:10px"></div>' +
        '</div>';
    });
}

// Map container IDs to their skeleton generator and grid class
var SKELETON_MAP = {
    'chemicals-grid':   { fn: chemSkeleton,    cls: 'chemicals-grid' },
    'deliveries-list':  { fn: deliverySkeleton, cls: 'deliveries-list' },
    'dashboard-cards':  { fn: dashSkeleton,     cls: 'dashboard-cards' }
};

window.addEventListener('DOMContentLoaded', function() {
    Object.keys(SKELETON_MAP).forEach(function(id) {
        var el = document.getElementById(id);
        if (!el) return;
        var cfg = SKELETON_MAP[id];
        new MutationObserver(function() {
            var loading = el.querySelector('.fp-loading');
            if (loading && !el.querySelector('.sk-card, .sk-delivery-card, .sk-dash-card')) {
                el.innerHTML = cfg.fn();
            }
        }).observe(el, { childList: true });
    });
});

// ============================================================
//  FEATURE 4 — Staggered Card Entry Animations
// ============================================================
function staggerCards(containerId, cardSel, baseDelay) {
    baseDelay = baseDelay || 55;
    var container = document.getElementById(containerId);
    if (!container) return;
    var cards = container.querySelectorAll(cardSel);
    cards.forEach(function(card, i) {
        card.style.opacity = '0';
        card.style.transform = 'translateY(22px)';
        card.style.transition =
            'opacity 0.42s ease ' + (i * baseDelay) + 'ms, ' +
            'transform 0.42s cubic-bezier(0.175,0.885,0.32,1.2) ' + (i * baseDelay) + 'ms';
        requestAnimationFrame(function() {
            setTimeout(function() {
                card.style.opacity = '1';
                card.style.transform = 'translateY(0)';
            }, 20);
        });
    });
}

window.addEventListener('DOMContentLoaded', function() {
    var chemGrid = document.getElementById('chemicals-grid');
    if (chemGrid) {
        new MutationObserver(function(muts) {
            var hasCards = muts.some(function(m) {
                return Array.from(m.addedNodes).some(function(n) {
                    return n.classList && (n.classList.contains('chem-card') || n.querySelector && n.querySelector('.chem-card'));
                });
            });
            if (hasCards) setTimeout(function() { staggerCards('chemicals-grid', '.chem-card', 55); }, 30);
        }).observe(chemGrid, { childList: true });
    }

    var delivList = document.getElementById('deliveries-list');
    if (delivList) {
        new MutationObserver(function(muts) {
            var hasCards = muts.some(function(m) {
                return Array.from(m.addedNodes).some(function(n) {
                    return n.classList && (n.classList.contains('delivery-card') || n.querySelector && n.querySelector('.delivery-card'));
                });
            });
            if (hasCards) setTimeout(function() { staggerCards('deliveries-list', '.delivery-card', 80); }, 30);
        }).observe(delivList, { childList: true });
    }
});

// ============================================================
//  FEATURE 12 — Panel Title Split-Text Reveal
// ============================================================
function revealPanelTitle(panelId) {
    var panel = document.getElementById(panelId);
    if (!panel) return;
    var h2 = panel.querySelector('.fp-header h2');
    if (!h2 || h2._revealed) return;
    h2._revealed = true;
    var text = h2.textContent.trim();
    h2.innerHTML = text.split('').map(function(ch, i) {
        var delay = i * 32;
        var c = ch === ' ' ? '&nbsp;' : ch;
        return '<span class="title-char" style="animation-delay:' + delay + 'ms">' + c + '</span>';
    }).join('');
}

window.addEventListener('DOMContentLoaded', function() {
    var _orig = window.showFullPanelCinematic;
    if (_orig) {
        window.showFullPanelCinematic = function(panelId, initFn) {
            _orig.call(this, panelId, initFn);
            setTimeout(function() { revealPanelTitle(panelId); }, 350);
        };
    }
});

// ============================================================
//  FEATURE 15 — Role Badge Glow Animation on Login
// ============================================================
function animateRoleBadge(role) {
    var roleIdMap = {
        admin:          'role-pill-admin',
        regional_admin: 'role-pill-regional',
        user:           'role-pill-user'
    };
    setTimeout(function() {
        document.querySelectorAll('.role-pill').forEach(function(b) {
            b.classList.remove('role-reveal');
            void b.offsetWidth; // force reflow
            b.classList.add('role-reveal');
        });
        var targetId = roleIdMap[role];
        if (targetId) {
            var target = document.getElementById(targetId);
            if (target) {
                target.classList.add('role-active-glow');
                setTimeout(function() { target.classList.remove('role-active-glow'); }, 3600);
            }
        }
    }, 450);
}

(function() {
    var _origLogin = window.onLoginSuccess;
    window.onLoginSuccess = function(user) {
        if (_origLogin) _origLogin.call(this, user);
        if (user && user.role) animateRoleBadge(user.role);
        
        // Premium Wow Feature B: Scramble Hero Text Reveal
        const heroTitle = document.getElementById('hero-title');
        if (heroTitle) scrambleTextReveal(heroTitle);
    };
})();

function scrambleTextReveal(el) {
    const originalHTML = el.innerHTML;
    // Extract text content only for scrambling calculation
    const tempDiv = document.createElement('div');
    tempDiv.innerHTML = originalHTML;
    const originalText = tempDiv.textContent;
    
    const chars = '!<>-_\\\\/[]{}—=+*^?#_';
    let iteration = 0;
    
    // We only scramble the text nodes, leaving HTML intact is complex.
    // simpler approach: replace entire innerHTML temporarily with scrambled text,
    // then pop the original HTML back in at the end.
    
    const interval = setInterval(() => {
        el.innerHTML = originalText.split('').map((char, index) => {
            if (index < iteration) {
                return originalText[index];
            }
            return chars[Math.floor(Math.random() * chars.length)];
        }).join('');
        
        if (iteration >= originalText.length) {
            clearInterval(interval);
            el.innerHTML = originalHTML; // restore formatting (bold tags, br)
        }
        iteration += 1 / 3;
    }, 25);
}

// ============================================================
//  Premium Wow Feature D: 3D Card Tilt
// ============================================================
window.addEventListener('mousemove', (e) => {
    // Only apply tilt to chem cards if they are hovered
    const card = e.target.closest('.chem-card');
    if (!card) return;
    
    const rect = card.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    
    const rotateX = ((y - centerY) / centerY) * -10; // max tilt 10deg
    const rotateY = ((x - centerX) / centerX) * 10;
    
    card.style.transform = `perspective(1000px) rotateX(${rotateX}deg) rotateY(${rotateY}deg) translateY(-4px)`;
    card.style.transition = 'transform 0.1s ease-out';
});

// Reset tilt when leaving the document body or grid
window.addEventListener('mouseout', (e) => {
    const card = e.target.closest('.chem-card');
    if (card && !card.contains(e.relatedTarget)) {
        card.style.transform = '';
        card.style.transition = 'transform 0.5s ease';
    }
});

// ============================================================
//  Premium Wow Feature I: Sliding Tab Underline
// ============================================================
window.addEventListener('DOMContentLoaded', () => {
    const tabContainers = document.querySelectorAll('.province-tabs');
    
    tabContainers.forEach(container => {
        const slider = document.createElement('div');
        slider.className = 'tab-slider-pill';
        container.appendChild(slider);
        container.style.position = 'relative';
        
        const updateSlider = () => {
            const activeTab = container.querySelector('.prov-tab.active');
            if (activeTab) {
                slider.style.width = activeTab.offsetWidth + 'px';
                slider.style.height = activeTab.offsetHeight + 'px';
                slider.style.left = activeTab.offsetLeft + 'px';
                slider.style.top = activeTab.offsetTop + 'px';
            }
        };
        
        container.addEventListener('click', (e) => {
            if (e.target.classList.contains('prov-tab')) {
                setTimeout(updateSlider, 50); // wait for .active class to be applied by features.js
            }
        });
        
        // Initial setup
        setTimeout(updateSlider, 100);
        window.addEventListener('resize', updateSlider);
    });
});
