// Fondo 3D: rejilla de onda + partículas + anillos (Three.js r128).
(function () {
  if (typeof THREE === 'undefined') return;
  const holder = document.getElementById('bg3d');
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0x050510, 0.028);
  const cam = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, 400);
  cam.position.set(0, 14, 34);
  cam.lookAt(0, 0, 0);
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(innerWidth, innerHeight);
  holder.appendChild(renderer.domElement);

  // Rejilla de onda
  const SEG = 90, SIZE = 140;
  const geo = new THREE.PlaneGeometry(SIZE, SIZE, SEG, SEG);
  geo.rotateX(-Math.PI / 2);
  const mat = new THREE.MeshBasicMaterial({ color: 0xc026ff, wireframe: true, transparent: true, opacity: 0.28 });
  const wave = new THREE.Mesh(geo, mat);
  wave.position.y = -4;
  scene.add(wave);
  const base = geo.attributes.position.array.slice();

  // Partículas flotantes
  const N = 700;
  const pGeo = new THREE.BufferGeometry();
  const pos = new Float32Array(N * 3);
  for (let i = 0; i < N; i++) {
    pos[i * 3] = (Math.random() - 0.5) * 160;
    pos[i * 3 + 1] = Math.random() * 50 - 5;
    pos[i * 3 + 2] = (Math.random() - 0.5) * 160;
  }
  pGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const pMat = new THREE.PointsMaterial({ color: 0x22d3ee, size: 0.35, transparent: true, opacity: 0.8 });
  const dots = new THREE.Points(pGeo, pMat);
  scene.add(dots);

  // Anillos orbitales (rollo club)
  const rings = [];
  [[0xff2bd6, 26, 0.5], [0x22d3ee, 34, -0.35]].forEach(([c, r, tilt]) => {
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(r, 0.12, 8, 120),
      new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: 0.5 })
    );
    ring.rotation.x = Math.PI / 2 + tilt;
    ring.position.y = 6;
    scene.add(ring);
    rings.push(ring);
  });

  // Esfera central pulsante (la "bola de discoteca")
  const orb = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 32, 32),
    new THREE.MeshBasicMaterial({ color: 0xff2bd6, wireframe: true, transparent: true, opacity: 0.55 })
  );
  orb.position.y = 9;
  scene.add(orb);

  const mouse = { x: 0, y: 0 };
  addEventListener('pointermove', e => {
    mouse.x = (e.clientX / innerWidth - 0.5) * 2;
    mouse.y = (e.clientY / innerHeight - 0.5) * 2;
  });

  const clock = new THREE.Clock();
  let running = true;
  document.addEventListener('visibilitychange', () => { running = !document.hidden; });

  (function anim() {
    requestAnimationFrame(anim);
    if (!running) return;
    const t = clock.getElapsedTime();
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const x = base[i * 3], z = base[i * 3 + 2];
      p.array[i * 3 + 1] = Math.sin(x * 0.18 + t * 1.4) * 1.6 + Math.cos(z * 0.22 + t) * 1.6;
    }
    p.needsUpdate = true;
    dots.rotation.y = t * 0.02;
    rings.forEach((r, i) => { r.rotation.z = t * (0.1 + i * 0.06); });
    const s = 1 + Math.sin(t * 2.2) * 0.06;
    orb.scale.set(s, s, s);
    orb.rotation.y = t * 0.3;
    cam.position.x += ((mouse.x * 6) - cam.position.x) * 0.03;
    cam.position.y += ((14 - mouse.y * 4) - cam.position.y) * 0.03;
    cam.lookAt(0, 2, 0);
    renderer.render(scene, cam);
  })();

  addEventListener('resize', () => {
    cam.aspect = innerWidth / innerHeight;
    cam.updateProjectionMatrix();
    renderer.setSize(innerWidth, innerHeight);
  });
})();
