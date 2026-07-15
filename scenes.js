// ============================================================
//  ChemTech — scenes.js v1
//  Immersive Three.js 3D backgrounds for each panel
//  + video frame fallback system
// ============================================================
'use strict';

const SCENES = {};
let _mouse3d = { x: 0, y: 0 };
document.addEventListener('mousemove', e => {
    _mouse3d.x = (e.clientX / innerWidth) * 2 - 1;
    _mouse3d.y = -(e.clientY / innerHeight) * 2 + 1;
});

// ---- Utility: Check if frame folder has content ----
async function checkFrameFolderExists(folder) {
    try {
        const r = await fetch(`${folder}/frame_000_delay-0.041s.jpg`, { method: 'HEAD' });
        return r.ok;
    } catch (_) { return false; }
}

// ---- Shared: Create renderer + scene + camera ----
function makeRenderer(canvas) {
    canvas.width = innerWidth;
    canvas.height = innerHeight;
    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    renderer.setSize(innerWidth, innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    return renderer;
}

// ============================================================
//  SCENE 1 — CHEMICALS: Rotating Molecular Wire Structure
//  Deep cyan-teal, floating atom spheres, glowing bonds
// ============================================================
function initChemicalsScene(canvas) {
    if (SCENES.chemicals) { disposeScene('chemicals'); }
    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 0, 28);

    // Ambient + point lights
    scene.add(new THREE.AmbientLight(0x0a2a3a, 3));
    const light1 = new THREE.PointLight(0x00e6c3, 4, 60);
    light1.position.set(10, 10, 10);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x0066ff, 2, 40);
    light2.position.set(-15, -8, 5);
    scene.add(light2);

    // Build molecular graph (nodes + edge bonds)
    const nodeCount = 22;
    const positions = [];
    const nodeMeshes = [];
    const bondLines = [];

    const sphereGeo = new THREE.SphereGeometry(0.38, 12, 12);
    const atomColors = [0x00e6c3, 0x60b4ff, 0xa78bfa, 0x34d399];
    for (let i = 0; i < nodeCount; i++) {
        const r = 7 + Math.random() * 6;
        const theta = Math.random() * Math.PI * 2;
        const phi = Math.acos(2 * Math.random() - 1);
        const pos = new THREE.Vector3(
            r * Math.sin(phi) * Math.cos(theta),
            r * Math.sin(phi) * Math.sin(theta),
            r * Math.cos(phi)
        );
        positions.push(pos);
        const mat = new THREE.MeshStandardMaterial({
            color: atomColors[i % atomColors.length],
            emissive: atomColors[i % atomColors.length],
            emissiveIntensity: 0.6,
            roughness: 0.2, metalness: 0.5
        });
        const mesh = new THREE.Mesh(sphereGeo, mat);
        mesh.position.copy(pos);
        mesh.userData.basePos = pos.clone();
        mesh.userData.phase = Math.random() * Math.PI * 2;
        mesh.userData.speed = 0.006 + Math.random() * 0.008;
        scene.add(mesh);
        nodeMeshes.push(mesh);
    }

    // Bonds between nearby nodes
    const bondMat = new THREE.LineBasicMaterial({ color: 0x00e6c3, transparent: true, opacity: 0.25 });
    for (let i = 0; i < nodeCount; i++) {
        for (let j = i + 1; j < nodeCount; j++) {
            if (positions[i].distanceTo(positions[j]) < 8.5) {
                const pts = [positions[i], positions[j]];
                const geo = new THREE.BufferGeometry().setFromPoints(pts);
                const line = new THREE.Line(geo, bondMat.clone());
                scene.add(line);
                bondLines.push({ line, i, j });
            }
        }
    }

    // Outer wireframe dodecahedron
    const dodecGeo = new THREE.DodecahedronGeometry(14, 0);
    const dodecMat = new THREE.MeshBasicMaterial({ color: 0x00e6c3, wireframe: true, transparent: true, opacity: 0.05 });
    const dodec = new THREE.Mesh(dodecGeo, dodecMat);
    scene.add(dodec);

    // Particle field
    const partCount = 700;
    const partPositions = new Float32Array(partCount * 3);
    for (let i = 0; i < partCount * 3; i++) partPositions[i] = (Math.random() - 0.5) * 80;
    const partGeo = new THREE.BufferGeometry();
    partGeo.setAttribute('position', new THREE.BufferAttribute(partPositions, 3));
    const partMat = new THREE.PointsMaterial({ color: 0x00e6c3, size: 0.08, transparent: true, opacity: 0.4 });
    scene.add(new THREE.Points(partGeo, partMat));

    let t = 0;
    const raf = { id: null };
    const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', resize);

    function animate() {
        raf.id = requestAnimationFrame(animate);
        t += 0.007;
        // Rotate whole scene gently
        scene.rotation.y = t * 0.12 + _mouse3d.x * 0.18;
        scene.rotation.x = _mouse3d.y * 0.10;
        dodec.rotation.y = -t * 0.05;
        dodec.rotation.z = t * 0.03;
        // Breathing node animation
        nodeMeshes.forEach(m => {
            const s = 1 + 0.12 * Math.sin(t * 2 + m.userData.phase);
            m.scale.setScalar(s);
        });
        // Update bond positions dynamically
        bondLines.forEach(({ line, i, j }) => {
            const pts = [nodeMeshes[i].position, nodeMeshes[j].position];
            line.geometry.setFromPoints(pts);
            line.geometry.attributes.position.needsUpdate = true;
        });
        light1.position.x = Math.sin(t * 0.7) * 12;
        light1.position.y = Math.cos(t * 0.5) * 8;
        renderer.render(scene, camera);
    }
    animate();
    SCENES.chemicals = { renderer, scene, camera, raf, resize };
}

// ============================================================
//  SCENE 2 — DELIVERIES: 3D Animated Logistics Network
//  Orange-amber, moving data packets along edges
// ============================================================
function initDeliveryScene(canvas) {
    if (SCENES.delivery) { disposeScene('delivery'); }
    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 8, 32);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x1a0a00, 4));
    const light1 = new THREE.PointLight(0xff8c00, 5, 80);
    light1.position.set(0, 20, 10);
    scene.add(light1);
    const light2 = new THREE.PointLight(0xf59e0b, 3, 50);
    light2.position.set(-20, -5, 0);
    scene.add(light2);

    // Hub nodes
    const hubPositions = [
        new THREE.Vector3(0, 0, 0),
        new THREE.Vector3(8, 3, -4), new THREE.Vector3(-8, 2, -4),
        new THREE.Vector3(5, -4, 3), new THREE.Vector3(-5, -5, 2),
        new THREE.Vector3(0, 7, -6), new THREE.Vector3(12, -2, 0),
        new THREE.Vector3(-11, 0, 2)
    ];

    const hubGeo = new THREE.OctahedronGeometry(0.7, 0);
    const hubColors = [0xff8c00, 0xf59e0b, 0xfbbf24, 0xfcd34d];
    const hubMeshes = hubPositions.map((pos, i) => {
        const mat = new THREE.MeshStandardMaterial({
            color: hubColors[i % hubColors.length],
            emissive: hubColors[i % hubColors.length],
            emissiveIntensity: 0.8, metalness: 0.7, roughness: 0.2
        });
        const m = new THREE.Mesh(hubGeo, mat);
        m.position.copy(pos);
        scene.add(m);
        return m;
    });

    // Edges
    const edges = [];
    const edgeMat = new THREE.LineBasicMaterial({ color: 0xf59e0b, transparent: true, opacity: 0.2 });
    for (let i = 0; i < hubPositions.length; i++) {
        for (let j = i + 1; j < hubPositions.length; j++) {
            if (hubPositions[i].distanceTo(hubPositions[j]) < 14) {
                const geo = new THREE.BufferGeometry().setFromPoints([hubPositions[i], hubPositions[j]]);
                scene.add(new THREE.Line(geo, edgeMat));
                edges.push({ from: hubPositions[i].clone(), to: hubPositions[j].clone(), t: Math.random() });
            }
        }
    }

    // Moving packets (small spheres)
    const packetGeo = new THREE.SphereGeometry(0.18, 6, 6);
    const packetMat = new THREE.MeshStandardMaterial({ color: 0xfbbf24, emissive: 0xfbbf24, emissiveIntensity: 1.5, roughness: 0.1 });
    const packets = edges.map(e => {
        const m = new THREE.Mesh(packetGeo, packetMat.clone());
        scene.add(m);
        return { mesh: m, edge: e, speed: 0.004 + Math.random() * 0.005 };
    });

    // Grid floor
    const gridHelper = new THREE.GridHelper(60, 20, 0xf59e0b, 0x3a1a00);
    gridHelper.position.y = -8;
    gridHelper.material.opacity = 0.12;
    gridHelper.material.transparent = true;
    scene.add(gridHelper);

    // Particles
    const pCount = 500;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i++) pPos[i] = (Math.random() - 0.5) * 80;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xf59e0b, size: 0.06, transparent: true, opacity: 0.35 })));

    let t = 0;
    const raf = { id: null };
    const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', resize);

    function animate() {
        raf.id = requestAnimationFrame(animate);
        t += 0.005;
        scene.rotation.y = t * 0.08 + _mouse3d.x * 0.15;
        scene.rotation.x = _mouse3d.y * 0.06;
        hubMeshes.forEach((m, i) => { m.rotation.y = t * (0.5 + i * 0.1); });
        packets.forEach(p => {
            p.edge.t = (p.edge.t + p.speed) % 1;
            p.mesh.position.lerpVectors(p.edge.from, p.edge.to, p.edge.t);
            const s = 1 + 0.3 * Math.sin(t * 8 + p.edge.t * Math.PI * 4);
            p.mesh.scale.setScalar(s);
        });
        light1.position.x = Math.sin(t * 0.4) * 15;
        renderer.render(scene, camera);
    }
    animate();
    SCENES.delivery = { renderer, scene, camera, raf, resize };
}

// ============================================================
//  SCENE 3 — AI ANALYTICS: Flowing Neural Mesh
//  Indigo-violet, pulsing neural network, data streams
// ============================================================
function initAnalyticsScene(canvas) {
    if (SCENES.analytics) { disposeScene('analytics'); }
    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 200);
    camera.position.set(0, 5, 30);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x080018, 5));
    const light1 = new THREE.PointLight(0x7c3aed, 6, 80);
    light1.position.set(10, 15, 5);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x00e6c3, 3, 50);
    light2.position.set(-15, -5, 10);
    scene.add(light2);
    const light3 = new THREE.PointLight(0xa855f7, 4, 60);
    light3.position.set(5, -15, -5);
    scene.add(light3);

    // Neural nodes in a 3D grid-like layout
    const layers = [5, 8, 8, 6, 4];
    const layerSpacing = 6;
    const nodeGroups = [];
    const allNodes = [];

    layers.forEach((count, layerIdx) => {
        const layerNodes = [];
        for (let i = 0; i < count; i++) {
            const y = (i - (count - 1) / 2) * 2.4;
            const z = (layerIdx - layers.length / 2) * layerSpacing;
            const x = (Math.random() - 0.5) * 1.5;
            const pos = new THREE.Vector3(x, y, z);
            const size = 0.25 + Math.random() * 0.2;
            const geo = new THREE.SphereGeometry(size, 12, 12);
            const colors = [0x7c3aed, 0xa855f7, 0xc4b5fd, 0x00e6c3];
            const col = colors[Math.floor(Math.random() * colors.length)];
            const mat = new THREE.MeshStandardMaterial({
                color: col, emissive: col, emissiveIntensity: 0.9,
                roughness: 0.1, metalness: 0.6
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.copy(pos);
            mesh.userData.phase = Math.random() * Math.PI * 2;
            mesh.userData.baseEmissive = 0.9;
            scene.add(mesh);
            layerNodes.push({ mesh, pos: pos.clone() });
            allNodes.push({ mesh, pos: pos.clone() });
        }
        nodeGroups.push(layerNodes);
    });

    // Connect adjacent layers
    const connectionMat = new THREE.LineBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.15 });
    const connections = [];
    for (let l = 0; l < nodeGroups.length - 1; l++) {
        nodeGroups[l].forEach(a => {
            nodeGroups[l + 1].forEach(b => {
                if (Math.random() > 0.4) {
                    const geo = new THREE.BufferGeometry().setFromPoints([a.pos, b.pos]);
                    const line = new THREE.Line(geo, connectionMat.clone());
                    scene.add(line);
                    connections.push({ line, from: a.pos, to: b.pos, active: Math.random() > 0.5 });
                }
            });
        });
    }

    // Flowing data along connections (glowing dots)
    const flowGeo = new THREE.SphereGeometry(0.1, 4, 4);
    const flowMeshes = connections.slice(0, 20).map(c => {
        const mat = new THREE.MeshStandardMaterial({ color: 0x00e6c3, emissive: 0x00e6c3, emissiveIntensity: 2 });
        const m = new THREE.Mesh(flowGeo, mat);
        m.userData.t = Math.random();
        m.userData.speed = 0.005 + Math.random() * 0.008;
        m.userData.conn = c;
        scene.add(m);
        return m;
    });

    // Background torus (abstract AI ring)
    const torusGeo = new THREE.TorusGeometry(18, 0.3, 6, 60);
    const torusMat = new THREE.MeshBasicMaterial({ color: 0x7c3aed, transparent: true, opacity: 0.06, wireframe: true });
    const torus = new THREE.Mesh(torusGeo, torusMat);
    torus.rotation.x = Math.PI / 3;
    scene.add(torus);
    const torus2 = torus.clone();
    torus2.rotation.x = -Math.PI / 4;
    torus2.rotation.z = Math.PI / 6;
    scene.add(torus2);

    // Star particles
    const pCount = 800;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i++) pPos[i] = (Math.random() - 0.5) * 100;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xa78bfa, size: 0.07, transparent: true, opacity: 0.5 })));

    let t = 0;
    const raf = { id: null };
    const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', resize);

    function animate() {
        raf.id = requestAnimationFrame(animate);
        t += 0.006;
        scene.rotation.y = t * 0.06 + _mouse3d.x * 0.12;
        scene.rotation.x = _mouse3d.y * 0.08;
        torus.rotation.z = t * 0.04;
        torus2.rotation.y = t * 0.03;
        // Pulse nodes
        allNodes.forEach(n => {
            const pulse = 0.7 + 0.4 * Math.sin(t * 2.5 + n.mesh.userData.phase);
            n.mesh.material.emissiveIntensity = pulse;
            n.mesh.scale.setScalar(0.8 + 0.25 * Math.sin(t * 1.8 + n.mesh.userData.phase));
        });
        // Move flow dots
        flowMeshes.forEach(m => {
            m.userData.t = (m.userData.t + m.userData.speed) % 1;
            m.position.lerpVectors(m.userData.conn.from, m.userData.conn.to, m.userData.t);
            m.material.emissiveIntensity = 1.5 + Math.sin(t * 10) * 0.5;
        });
        // Pulse connection opacities
        connections.forEach((c, i) => {
            c.line.material.opacity = 0.05 + 0.12 * Math.abs(Math.sin(t * 1.5 + i * 0.3));
        });
        light1.position.x = Math.sin(t * 0.5) * 12;
        light1.position.z = Math.cos(t * 0.3) * 8;
        renderer.render(scene, camera);
    }
    animate();
    SCENES.analytics = { renderer, scene, camera, raf, resize };
}

// ============================================================
//  SCENE 4 — DASHBOARD: Topographic Terrain + Province Glows
//  Gold-emerald, undulating mesh, province highlight waves
// ============================================================
function initDashboardScene(canvas) {
    if (SCENES.dashboard) { disposeScene('dashboard'); }
    const renderer = makeRenderer(canvas);
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 300);
    camera.position.set(0, 22, 35);
    camera.lookAt(0, 0, 0);

    scene.add(new THREE.AmbientLight(0x020a04, 5));
    const light1 = new THREE.PointLight(0xd97706, 5, 80);
    light1.position.set(15, 20, 10);
    scene.add(light1);
    const light2 = new THREE.PointLight(0x10b981, 4, 70);
    light2.position.set(-20, 10, -5);
    scene.add(light2);
    const light3 = new THREE.PointLight(0xfbbf24, 3, 60);
    light3.position.set(0, -10, 20);
    scene.add(light3);

    // Terrain mesh
    const terrainW = 60, terrainH = 60, segs = 48;
    const terrainGeo = new THREE.PlaneGeometry(terrainW, terrainH, segs, segs);
    terrainGeo.rotateX(-Math.PI / 2);
    const posAttr = terrainGeo.attributes.position;
    const baseHeights = [];
    for (let i = 0; i < posAttr.count; i++) {
        const x = posAttr.getX(i) / terrainW;
        const z = posAttr.getZ(i) / terrainH;
        const h = Math.sin(x * Math.PI * 3.2) * Math.cos(z * Math.PI * 2.8) * 3.5
                + Math.sin(x * Math.PI * 6 + 1.2) * Math.sin(z * Math.PI * 5 + 0.8) * 1.8
                + Math.cos(x * Math.PI * 9 + z * Math.PI * 7) * 0.9;
        posAttr.setY(i, h);
        baseHeights.push(h);
    }
    terrainGeo.computeVertexNormals();
    const terrainMat = new THREE.MeshStandardMaterial({
        color: 0x064e3b, wireframe: false, roughness: 0.8, metalness: 0.1,
        transparent: true, opacity: 0.85
    });
    const terrain = new THREE.Mesh(terrainGeo, terrainMat);
    scene.add(terrain);

    // Wireframe overlay
    const wireMat = new THREE.MeshBasicMaterial({ color: 0x10b981, wireframe: true, transparent: true, opacity: 0.08 });
    const wireFrame = new THREE.Mesh(terrainGeo.clone(), wireMat);
    scene.add(wireFrame);

    // Province glow points (4 provinces)
    const provincePositions = [
        new THREE.Vector3(-10, 5, -8),   // Punjab
        new THREE.Vector3(8, 4, -10),    // KPK
        new THREE.Vector3(-5, 3, 8),     // Sindh
        new THREE.Vector3(12, 6, 6),     // Balochistan
    ];
    const provinceColors = [0xfbbf24, 0x10b981, 0x60b4ff, 0xf59e0b];
    const glowMeshes = provincePositions.map((pos, i) => {
        const geo = new THREE.SphereGeometry(0.6, 16, 16);
        const mat = new THREE.MeshStandardMaterial({
            color: provinceColors[i], emissive: provinceColors[i], emissiveIntensity: 2.5,
            roughness: 0.1, metalness: 0.9
        });
        const m = new THREE.Mesh(geo, mat);
        m.position.copy(pos);
        m.userData.phase = i * Math.PI * 0.5;
        scene.add(m);
        // Pulse ring
        const ringGeo = new THREE.RingGeometry(1.5, 2.5, 32);
        const ringMat = new THREE.MeshBasicMaterial({ color: provinceColors[i], transparent: true, opacity: 0.2, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.copy(pos);
        ring.position.y -= 1;
        scene.add(ring);
        return { mesh: m, ring, baseY: pos.y };
    });

    // Floating data bars
    const barGeo = new THREE.BoxGeometry(0.4, 1, 0.4);
    const bars = provincePositions.map((pos, i) => {
        const mat = new THREE.MeshStandardMaterial({
            color: provinceColors[i], emissive: provinceColors[i],
            emissiveIntensity: 0.5, roughness: 0.3
        });
        const m = new THREE.Mesh(barGeo, mat);
        m.position.set(pos.x + 2, pos.y + 3, pos.z);
        m.userData.phase = i * 1.5;
        scene.add(m);
        return m;
    });

    // Star particles
    const pCount = 600;
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i++) pPos[i] = (Math.random() - 0.5) * 120;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
    scene.add(new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xd97706, size: 0.08, transparent: true, opacity: 0.4 })));

    let t = 0;
    const raf = { id: null };
    const resize = () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); };
    window.addEventListener('resize', resize);

    function animate() {
        raf.id = requestAnimationFrame(animate);
        t += 0.005;
        // Gentle terrain undulation
        for (let i = 0; i < posAttr.count; i++) {
            const x = posAttr.getX(i) / terrainW;
            const z = posAttr.getZ(i) / terrainH;
            const wave = Math.sin(x * 4 + t) * Math.cos(z * 3 + t * 0.7) * 0.6;
            posAttr.setY(i, baseHeights[i] + wave);
        }
        posAttr.needsUpdate = true;
        terrainGeo.computeVertexNormals();
        scene.rotation.y = t * 0.05 + _mouse3d.x * 0.1;
        scene.rotation.x = _mouse3d.y * 0.05;
        // Glow province pulsing
        glowMeshes.forEach(({ mesh, ring }, i) => {
            const pulse = 2 + 1.5 * Math.sin(t * 2.5 + mesh.userData.phase);
            mesh.material.emissiveIntensity = pulse;
            const s = 1 + 0.2 * Math.sin(t * 3 + mesh.userData.phase);
            mesh.scale.setScalar(s);
            ring.material.opacity = 0.1 + 0.15 * Math.abs(Math.sin(t * 1.8 + mesh.userData.phase));
            ring.scale.setScalar(1 + 0.3 * Math.abs(Math.sin(t * 1.2 + mesh.userData.phase)));
        });
        bars.forEach(b => {
            const hs = 1 + 0.8 * Math.abs(Math.sin(t * 1.5 + b.userData.phase));
            b.scale.y = hs;
            b.material.emissiveIntensity = 0.5 + 0.8 * Math.abs(Math.sin(t * 2 + b.userData.phase));
        });
        light1.position.x = Math.sin(t * 0.4) * 15;
        light2.position.z = Math.cos(t * 0.3) * 10;
        renderer.render(scene, camera);
    }
    animate();
    SCENES.dashboard = { renderer, scene, camera, raf, resize };
}

// ============================================================
//  SCENE LIFECYCLE
// ============================================================
function disposeScene(key) {
    const s = SCENES[key];
    if (!s) return;
    cancelAnimationFrame(s.raf.id);
    window.removeEventListener('resize', s.resize);
    s.renderer.dispose();
    delete SCENES[key];
}

// ============================================================
//  HOOK INTO PANEL OPEN SYSTEM
// ============================================================
// Wait for features.js to define openPanel, then wrap it
(function () {
    const _waitForOpen = setInterval(() => {
        if (typeof openPanel === 'function') {
            clearInterval(_waitForOpen);
            const _origOpen = openPanel;
            window.openPanel = function (id) {
                _origOpen(id);
                setTimeout(() => initSceneForPanel(id), 120);
            };
        }
    }, 50);
})();

async function initSceneForPanel(panelId) {
    const map = {
        'chemicals-panel': { key: 'chemicals', canvas: 'chem-bg-canvas', init: initChemicalsScene, folder: 'frames_chemicals' },
        'delivery-panel': { key: 'delivery', canvas: 'delivery-bg-canvas', init: initDeliveryScene, folder: 'frames_deliveries' },
        'analytics-panel': { key: 'analytics', canvas: 'analytics-bg-canvas', init: initAnalyticsScene, folder: 'frames_analytics' },
        'dashboard-panel': { key: 'dashboard', canvas: 'dashboard-bg-canvas', init: initDashboardScene, folder: 'frames_dashboard' },
    };
    const cfg = map[panelId];
    if (!cfg) return;
    if (SCENES[cfg.key]) return; // already running

    const canvas = document.getElementById(cfg.canvas);
    if (!canvas) return;

    // Check if video frames exist — if so, skip Three.js and use frame player
    const hasFrames = await checkFrameFolderExists(cfg.folder);
    if (hasFrames) {
        initFramePlayer(canvas, cfg.folder, panelId);
    } else {
        cfg.init(canvas);
    }
}

// Stop scene when panel closes
(function () {
    const _waitForClose = setInterval(() => {
        if (typeof closePanel === 'function') {
            clearInterval(_waitForClose);
            const _origClose = closePanel;
            window.closePanel = function () {
                // Dispose all active panel scenes
                ['chemicals', 'delivery', 'analytics', 'dashboard'].forEach(k => disposeScene(k));
                _origClose();
            };
        }
    }, 50);
})();

// ============================================================
//  FRAME PLAYER (Video folder fallback)
// ============================================================
function initFramePlayer(canvas, folder, panelId) {
    const FRAME_COUNT = 192;
    const ctx = canvas.getContext('2d');
    const imgs = [];
    let loaded = 0;
    let frameIdx = 0;
    let rafId = null;
    let isScrollDriven = panelId === 'analytics-panel';

    canvas.width = innerWidth;
    canvas.height = innerHeight;

    for (let i = 0; i < FRAME_COUNT; i++) {
        const img = new Image();
        const name = `${folder}/frame_${String(i).padStart(3, '0')}_delay-0.041s.jpg`;
        img.onload = () => loaded++;
        img.onerror = () => loaded++;
        img.src = name;
        imgs.push(img);
    }

    function drawFrame(idx) {
        const img = imgs[Math.max(0, Math.min(imgs.length - 1, Math.round(idx)))];
        if (!img || !img.complete) return;
        const cw = canvas.width, ch = canvas.height;
        const scale = Math.max(cw / img.naturalWidth, ch / img.naturalHeight);
        const iw = img.naturalWidth * scale, ih = img.naturalHeight * scale;
        ctx.clearRect(0, 0, cw, ch);
        ctx.drawImage(img, (cw - iw) / 2, (ch - ih) / 2, iw, ih);
    }

    if (isScrollDriven) {
        // Analytics: scroll inside the content column drives frame index
        const scrollEl = document.getElementById('analytics-thread');
        if (scrollEl) {
            scrollEl.addEventListener('scroll', () => {
                const pct = scrollEl.scrollTop / (scrollEl.scrollHeight - scrollEl.clientHeight || 1);
                frameIdx = Math.round(pct * (FRAME_COUNT - 1));
                drawFrame(frameIdx);
            });
        }
        drawFrame(0);
    } else {
        // Auto-play loop
        let lastTs = 0;
        function loop(ts) {
            rafId = requestAnimationFrame(loop);
            if (ts - lastTs > 40) { // ~25fps
                lastTs = ts;
                frameIdx = (frameIdx + 1) % FRAME_COUNT;
                drawFrame(frameIdx);
            }
        }
        loop(0);
        SCENES[panelId] = { raf: { id: rafId }, resize: () => {}, renderer: { dispose: () => cancelAnimationFrame(rafId) } };
    }
}
