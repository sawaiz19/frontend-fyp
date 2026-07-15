import sys

with open('features.js', 'r', encoding='utf-8') as f:
    content = f.read()

start_idx = content.find('    // Build context + call AI')
end_idx = content.find('    // Restore button')
if start_idx == -1 or end_idx == -1:
    print('Could not find fetch block')
    sys.exit(1)

new_fetch_block = """    // Build context + call AI
    const thinking = block.querySelector('[id^="an-thinking-"]');
    try {
        const body = authBody({ query });
        const data = await api('/api/ai/graph-query', body);
        if (!data.success) throw new Error(data.error || 'API failed');

        const answerText = data.summary || 'Analysis complete.';
        const charts = data.charts || [];
        const followups = data.followups || [];

        if (thinking) thinking.remove();

        // Render answer text
        const answerDiv = document.createElement('div');
        answerDiv.className = 'an-answer-area';
        answerDiv.innerHTML = `
            <div class="an-answer-header">
                <span class="an-answer-chip">◈ ChemTech AI</span>
            </div>
            <div class="an-answer-text">${formatAnswerText(answerText)}</div>`;
        block.appendChild(answerDiv);

        // Render charts
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
    }

"""

content = content[:start_idx] + new_fetch_block + content[end_idx:]

target_render = """        if (ch.type === 'line') renderLine(ch, canvas, pal);
        else if (ch.type === 'doughnut' || ch.type === 'pie') renderDoughnut(ch, canvas);
        else if (ch.type === 'radar') renderRadar(ch, canvas, pal);
        else if (ch.type === 'bubble') renderBubble(ch, canvas);
        else renderBar2D(ch, canvas, pal);"""
        
new_render = """        if (ch.type === 'line') renderLine(ch, canvas, pal);
        else if (ch.type === 'doughnut' || ch.type === 'pie') renderDoughnut(ch, canvas);
        else if (ch.type === 'radar') renderRadar(ch, canvas, pal);
        else if (ch.type === 'bubble') renderBubble(ch, canvas);
        else if (ch.type === 'bar3d') renderBar3D(ch, canvas.parentElement, pal);
        else renderBar2D(ch, canvas, pal);"""

content = content.replace(target_render, new_render)

bar3d_func = """
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
"""

content += bar3d_func

with open('features.js', 'w', encoding='utf-8') as f:
    f.write(content)

print('Success!')
