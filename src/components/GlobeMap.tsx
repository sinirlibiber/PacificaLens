'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface Pin {
  id: string;
  label: string;
  lat: number;
  lng: number;
}

/* ── helpers ─────────────────────────────────────────────── */
function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

function vec3ToLatLng(v: THREE.Vector3): { lat: number; lng: number } {
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, v.y / v.length()))) * (180 / Math.PI);
  const lng = (Math.atan2(v.z, -v.x) * (180 / Math.PI)) - 180;
  return { lat, lng };
}

/* ── main component ──────────────────────────────────────── */
export default function GlobeMap() {
  const mountRef  = useRef<HTMLDivElement>(null);
  const stateRef  = useRef<{
    renderer  : THREE.WebGLRenderer;
    scene     : THREE.Scene;
    camera    : THREE.PerspectiveCamera;
    globe     : THREE.Mesh;
    pinsGroup : THREE.Group;
    raf       : number;
    isDragging: boolean;
    autoRotate: boolean;
  } | null>(null);

  const [pins,       setPins      ] = useState<Pin[]>([]);
  const [modal,      setModal     ] = useState<{
    screenX: number; screenY: number; lat: number; lng: number
  } | null>(null);
  const [inputLabel, setInputLabel] = useState('');
  const [saving,     setSaving    ] = useState(false);
  const [hint,       setHint      ] = useState(true);

  /* ── fetch pins ─────────────────────────────────── */
  const fetchPins = useCallback(async () => {
    try {
      const res  = await fetch('/api/pins');
      const data = await res.json();
      if (Array.isArray(data)) setPins(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  /* ── hide hint after 5 s ────────────────────────── */
  useEffect(() => {
    const t = setTimeout(() => setHint(false), 5000);
    return () => clearTimeout(t);
  }, []);

  /* ── THREE.js scene ─────────────────────────────── */
  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    const W = container.clientWidth  || 800;
    const H = container.clientHeight || 600;

    /* renderer */
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);

    /* scene / camera */
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1000);
    camera.position.z = 2.6;

    /* lights */
    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0x88ccff, 1.2);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    /* globe */
    const geo = new THREE.SphereGeometry(1, 72, 72);
    const tex = new THREE.TextureLoader().load(
      'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
    );
    const mat  = new THREE.MeshPhongMaterial({ map: tex, shininess: 15 });
    const globe = new THREE.Mesh(geo, mat);
    scene.add(globe);

    /* glow ring (atmosphere) */
    const atmosGeo = new THREE.SphereGeometry(1.03, 72, 72);
    const atmosMat = new THREE.MeshPhongMaterial({
      color: 0x00b4d8, transparent: true, opacity: 0.07, side: THREE.FrontSide,
    });
    scene.add(new THREE.Mesh(atmosGeo, atmosMat));

    /* stars */
    const starPositions = new Float32Array(6000);
    for (let i = 0; i < 6000; i++) starPositions[i] = (Math.random() - 0.5) * 120;
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    /* pins group */
    const pinsGroup = new THREE.Group();
    scene.add(pinsGroup);

    const s = stateRef.current = {
      renderer, scene, camera, globe, pinsGroup,
      raf: 0, isDragging: false as boolean, autoRotate: true as boolean,
    };

    /* drag to rotate */
    let prev = { x: 0, y: 0 };
    let moved = false;

    const onDown = (e: MouseEvent | TouchEvent) => {
      s.isDragging = true; s.autoRotate = false; moved = false;
      const p = 'touches' in e ? e.touches[0] : e;
      prev = { x: p.clientX, y: p.clientY };
    };
    const onUp = () => { s.isDragging = false; };
    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!s.isDragging) return;
      const p = 'touches' in e ? e.touches[0] : e;
      const dx = (p.clientX - prev.x) * 0.005;
      const dy = (p.clientY - prev.y) * 0.005;
      if (Math.abs(dx) > 0.002 || Math.abs(dy) > 0.002) moved = true;
      globe.rotation.y     += dx; pinsGroup.rotation.y += dx;
      globe.rotation.x     += dy; pinsGroup.rotation.x += dy;
      prev = { x: p.clientX, y: p.clientY };
    };

    /* click → lat/lng */
    const onClick = (e: MouseEvent) => {
      if (moved) return;
      const rect   = container.getBoundingClientRect();
      const mouse  = new THREE.Vector2(
        ((e.clientX - rect.left) / W) * 2 - 1,
       -((e.clientY - rect.top)  / H) * 2 + 1,
      );
      const ray = new THREE.Raycaster();
      ray.setFromCamera(mouse, camera);
      const hits = ray.intersectObject(globe);
      if (!hits.length) return;

      /* un-rotate the hit point to get real lat/lng */
      const worldPoint = hits[0].point.clone();
      const inv = new THREE.Matrix4().copy(globe.matrixWorld).invert();
      const localPoint = worldPoint.clone().applyMatrix4(inv);
      const { lat, lng } = vec3ToLatLng(localPoint);

      /* clamp screen position so modal stays inside viewport */
      const sx = Math.min(e.clientX - rect.left, W - 260);
      const sy = Math.min(e.clientY - rect.top,  H - 150);
      setModal({ screenX: sx, screenY: sy, lat, lng });
    };

    container.addEventListener('mousedown',  onDown as EventListener);
    container.addEventListener('touchstart', onDown as EventListener, { passive: true });
    window.addEventListener('mouseup',   onUp);
    window.addEventListener('touchend',  onUp);
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('touchmove', onMove as EventListener, { passive: true });
    container.addEventListener('click', onClick);

    /* resize */
    const onResize = () => {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      renderer.setSize(nW, nH);
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    /* animation loop */
    const animate = () => {
      s.raf = requestAnimationFrame(animate);
      if (s.autoRotate) { globe.rotation.y += 0.0008; pinsGroup.rotation.y += 0.0008; }
      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(s.raf);
      container.removeEventListener('mousedown',  onDown as EventListener);
      container.removeEventListener('touchstart', onDown as EventListener);
      window.removeEventListener('mouseup',   onUp);
      window.removeEventListener('touchend',  onUp);
      window.removeEventListener('mousemove', onMove as EventListener);
      window.removeEventListener('touchmove', onMove as EventListener);
      container.removeEventListener('click', onClick);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── rebuild 3-D pins when list changes ─────────── */
  useEffect(() => {
    const s = stateRef.current;
    if (!s) return;

    while (s.pinsGroup.children.length) s.pinsGroup.remove(s.pinsGroup.children[0]);

    pins.forEach((pin) => {
      const pos = latLngToVec3(pin.lat, pin.lng, 1.0);

      /* stick */
      const stickGeo = new THREE.CylinderGeometry(0.004, 0.004, 0.09, 8);
      const stickMat = new THREE.MeshPhongMaterial({ color: 0x00b4d8 });
      const stick    = new THREE.Mesh(stickGeo, stickMat);

      /* head */
      const headGeo = new THREE.SphereGeometry(0.018, 10, 10);
      const headMat = new THREE.MeshPhongMaterial({ color: 0x00e5ff, emissive: 0x003d4d });
      const head    = new THREE.Mesh(headGeo, headMat);
      head.position.y = 0.05;

      /* glow halo */
      const haloGeo = new THREE.SphereGeometry(0.03, 10, 10);
      const haloMat = new THREE.MeshBasicMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.25 });
      const halo    = new THREE.Mesh(haloGeo, haloMat);
      halo.position.y = 0.05;

      const pinGroup = new THREE.Group();
      pinGroup.add(stick, head, halo);
      pinGroup.position.copy(pos);
      pinGroup.lookAt(pos.clone().multiplyScalar(2));
      s.pinsGroup.add(pinGroup);
    });
  }, [pins]);

  /* ── save new pin ───────────────────────────────── */
  const savePin = async () => {
    if (!modal || !inputLabel.trim()) return;
    setSaving(true);
    try {
      const res = await fetch('/api/pins', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ label: inputLabel.trim(), lat: modal.lat, lng: modal.lng }),
      });
      if (res.ok) { setInputLabel(''); setModal(null); await fetchPins(); }
    } finally { setSaving(false); }
  };

  /* ── render ─────────────────────────────────────── */
  return (
    <div className="relative w-full h-full select-none">
      {/* Three.js canvas */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Floating hint */}
      {hint && (
        <div
          className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2
                     px-5 py-2.5 rounded-full text-xs font-medium pointer-events-none
                     transition-opacity duration-700"
          style={{
            background: 'rgba(0,180,216,0.12)',
            border    : '1px solid rgba(0,180,216,0.3)',
            color     : 'var(--accent)',
            opacity   : hint ? 1 : 0,
          }}
        >
          🌍 Küreyi sürükle · Herhangi bir yere tıkla
        </div>
      )}

      {/* Pin modal */}
      {modal && (
        <div
          className="absolute z-50 rounded-2xl p-4 shadow-2xl w-64"
          style={{
            left      : modal.screenX,
            top       : modal.screenY,
            background: 'var(--surface)',
            border    : '1px solid var(--border1)',
          }}
        >
          <p className="text-xs mb-3" style={{ color: 'var(--text3)' }}>
            📍 {modal.lat.toFixed(2)}°&nbsp;&nbsp;{modal.lng.toFixed(2)}°
          </p>
          <input
            autoFocus
            className="w-full rounded-xl px-3 py-2 text-sm mb-3 outline-none"
            style={{
              background  : 'var(--surface2)',
              border      : '1px solid var(--border2)',
              color       : 'var(--text1)',
            }}
            placeholder="Şehrin veya adın…"
            value={inputLabel}
            onChange={e => setInputLabel(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && savePin()}
          />
          <div className="flex gap-2">
            <button
              onClick={savePin}
              disabled={saving || !inputLabel.trim()}
              className="flex-1 text-sm font-semibold rounded-xl py-2 transition-all"
              style={{
                background: saving ? 'var(--surface2)' : 'var(--accent)',
                color     : '#fff',
                opacity   : !inputLabel.trim() ? 0.5 : 1,
              }}
            >
              {saving ? '…' : '📌 İğne Ekle'}
            </button>
            <button
              onClick={() => { setModal(null); setInputLabel(''); }}
              className="px-3 text-sm rounded-xl transition-all"
              style={{ background: 'var(--surface2)', color: 'var(--text2)' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Bottom-left counter */}
      <div
        className="absolute bottom-5 left-5 text-xs px-3 py-1.5 rounded-full font-medium"
        style={{
          background: 'rgba(0,0,0,0.55)',
          border    : '1px solid var(--border1)',
          color     : 'var(--text2)',
          backdropFilter: 'blur(8px)',
        }}
      >
        🌐 {pins.length} ziyaretçi iğnesi
      </div>

      {/* Bottom-right tip */}
      <div
        className="absolute bottom-5 right-5 text-xs px-3 py-1.5 rounded-full"
        style={{
          background: 'rgba(0,0,0,0.45)',
          border    : '1px solid var(--border1)',
          color     : 'var(--text3)',
          backdropFilter: 'blur(8px)',
        }}
      >
        Sürükle · Tıkla
      </div>
    </div>
  );
}
