'use strict';
/**
 * ChemTech — lightweight celebration burst (canvas, no dependencies).
 * Fires when a delivery reaches "delivered" for demo / delight factor.
 */
(function () {
    const PALETTE = ['#00e6c3', '#22d3ee', '#38bdf8', '#a855f7', '#f472b6', '#fbbf24', '#ffffff'];

    function burst() {
        const existing = document.getElementById('chemtech-celebration-layer');
        if (existing) existing.remove();

        const wrap = document.createElement('div');
        wrap.id = 'chemtech-celebration-layer';
        wrap.setAttribute('aria-hidden', 'true');
        Object.assign(wrap.style, {
            position: 'fixed',
            inset: '0',
            zIndex: '2147483646',
            pointerEvents: 'none',
            overflow: 'hidden',
        });

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        wrap.appendChild(canvas);
        document.body.appendChild(wrap);

        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        let W = 0;
        let H = 0;

        function resize() {
            W = window.innerWidth;
            H = window.innerHeight;
            canvas.width = Math.floor(W * dpr);
            canvas.height = Math.floor(H * dpr);
            canvas.style.width = W + 'px';
            canvas.style.height = H + 'px';
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        }
        resize();
        window.addEventListener('resize', resize);

        const N = Math.min(140, Math.floor((W * H) / 18000));
        const parts = [];
        for (let i = 0; i < N; i++) {
            const side = Math.random() < 0.5 ? 0 : 1;
            const x0 = side === 0 ? -20 : W + 20;
            const aimX = W * (0.25 + Math.random() * 0.5);
            const aimY = H * (0.15 + Math.random() * 0.35);
            const dx = aimX - x0;
            const dy = aimY - H * 0.85;
            const mag = Math.sqrt(dx * dx + dy * dy) || 1;
            const speed = 10 + Math.random() * 14;
            parts.push({
                x: x0,
                y: H * (0.75 + Math.random() * 0.22),
                vx: (dx / mag) * speed * (0.85 + Math.random() * 0.35),
                vy: (dy / mag) * speed * (0.85 + Math.random() * 0.35) - 6 - Math.random() * 8,
                g: 0.22 + Math.random() * 0.12,
                drag: 0.988 + Math.random() * 0.008,
                rot: Math.random() * Math.PI * 2,
                vr: (Math.random() - 0.5) * 0.35,
                w: 5 + Math.random() * 7,
                h: 3 + Math.random() * 5,
                life: 1,
                decay: 0.004 + Math.random() * 0.004,
                color: PALETTE[(Math.random() * PALETTE.length) | 0],
            });
        }

        const t0 = performance.now();
        const DURATION = 2800;

        function tick(now) {
            const t = now - t0;
            ctx.clearRect(0, 0, W, H);

            let alive = 0;
            for (const p of parts) {
                if (p.life <= 0) continue;
                alive++;
                p.vx *= p.drag;
                p.vy = p.vy * p.drag + p.g;
                p.x += p.vx;
                p.y += p.vy;
                p.rot += p.vr;
                p.life -= p.decay;

                ctx.save();
                ctx.globalAlpha = Math.max(0, Math.min(1, p.life));
                ctx.translate(p.x, p.y);
                ctx.rotate(p.rot);
                ctx.fillStyle = p.color;
                ctx.shadowColor = p.color;
                ctx.shadowBlur = 8;
                ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
                ctx.restore();
            }

            if (t < DURATION && alive > 0) {
                requestAnimationFrame(tick);
            } else {
                window.removeEventListener('resize', resize);
                wrap.remove();
            }
        }

        requestAnimationFrame(tick);
    }

    window.chemtechCelebrationDelivered = burst;
})();
