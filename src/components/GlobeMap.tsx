'use client';

import { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';

interface Pin { id: string; label: string; lat: number; lng: number; }

/* ── coordinate helpers ──────────────────────────────────────── */
function latLngToVec3(lat: number, lng: number, r: number): THREE.Vector3 {
  const phi   = (90 - lat)  * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -r * Math.sin(phi) * Math.cos(theta),
     r * Math.cos(phi),
     r * Math.sin(phi) * Math.sin(theta),
  );
}

function hitToLatLng(hit: THREE.Vector3, globeMatrix: THREE.Matrix4) {
  const local = hit.clone().applyMatrix4(new THREE.Matrix4().copy(globeMatrix).invert());
  const n = local.clone().normalize();
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, n.y))) * (180 / Math.PI);
  const lng = (Math.atan2(n.z, -n.x) * (180 / Math.PI)) - 180;
  return { lat, lng };
}

/* ── constants ───────────────────────────────────────────────── */
const AUTO_SPEED   = 0.0008;   // base auto-rotation speed (rad/frame)
const PAUSE_MS     = 15000;    // pause duration after touch (ms)
const FRICTION     = 0.94;     // velocity damping per frame
const THROW_SCALE  = 0.012;    // mouse-delta → angular velocity

export default function GlobeMap() {
  const mountRef = useRef<HTMLDivElement>(null);

  /* Three.js refs — stable across renders */
  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef     = useRef<THREE.Mesh | null>(null);
  const pinsGroupRef = useRef<THREE.Group | null>(null);
  const rafRef       = useRef<number>(0);

  /* physics */
  const velRef      = useRef({ x: 0, y: 0 }); // angular velocity (rad/frame)
  const dragging    = useRef(false);
  const hasMoved    = useRef(false);
  const prevMouse   = useRef({ x: 0, y: 0 });
  const pauseTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef   = useRef(false);   // true while 15-sec pause is active

  /* UI state */
  const [pins,       setPins      ] = useState<Pin[]>([]);
  const [modal,      setModal     ] = useState<{ sx: number; sy: number; lat: number; lng: number } | null>(null);
  const [inputLabel, setInputLabel] = useState('');
  const [saving,     setSaving    ] = useState(false);
  const [pinError,   setPinError  ] = useState('');

  /* ── fetch pins ─────────────────────────────────────────── */
  const fetchPins = useCallback(async () => {
    try {
      const res  = await fetch('/api/pins');
      const data = await res.json();
      if (Array.isArray(data)) setPins(data);
    } catch { /* network error — ignore */ }
  }, []);

  useEffect(() => { fetchPins(); }, [fetchPins]);

  /* ── pause helper ────────────────────────────────────────── */
  const startPause = useCallback(() => {
    pausedRef.current = true;
    if (pauseTimer.current) clearTimeout(pauseTimer.current);
    pauseTimer.current = setTimeout(() => { pausedRef.current = false; }, PAUSE_MS);
  }, []);

  /* ── Three.js setup ─────────────────────────────────────── */
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
    rendererRef.current = renderer;

    /* scene + camera */
    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1000);
    camera.position.z = 2.6;
    sceneRef.current  = scene;
    cameraRef.current = camera;

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
    const mat   = new THREE.MeshPhongMaterial({ map: tex, shininess: 15 });
    const globe = new THREE.Mesh(geo, mat);
    scene.add(globe);
    globeRef.current = globe;

    /* atmosphere glow */
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.03, 72, 72),
      new THREE.MeshPhongMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.07, side: THREE.FrontSide }),
    ));

    /* stars */
    const starPos = new Float32Array(6000).map(() => (Math.random() - 0.5) * 120);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

    /* pins group */
    const pinsGroup = new THREE.Group();
    scene.add(pinsGroup);
    pinsGroupRef.current = pinsGroup;

    /* ── pointer events ──────────────────────────────────── */
    const getXY = (e: MouseEvent | TouchEvent) => {
      const p = 'touches' in e ? e.touches[0] : e;
      return { x: p.clientX, y: p.clientY };
    };

    const onDown = (e: MouseEvent | TouchEvent) => {
      const { x, y } = getXY(e);
      dragging.current  = true;
      hasMoved.current  = false;
      prevMouse.current = { x, y };
      velRef.current    = { x: 0, y: 0 };  // kill momentum on grab
      startPause();
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const { x, y } = getXY(e);
      const dx = x - prevMouse.current.x;
      const dy = y - prevMouse.current.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) hasMoved.current = true;

      /* accumulate velocity for throw */
      velRef.current = { x: dx * THROW_SCALE, y: dy * THROW_SCALE };

      globe.rotation.y     += dx * 0.005;
      globe.rotation.x     += dy * 0.005;
      pinsGroup.rotation.y += dx * 0.005;
      pinsGroup.rotation.x += dy * 0.005;
      prevMouse.current = { x, y };
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      /* click → open pin modal */
      if (!hasMoved.current && 'clientX' in e) {
        const rect  = container.getBoundingClientRect();
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / W) * 2 - 1,
         -((e.clientY - rect.top)  / H) * 2 + 1,
        );
        const ray = new THREE.Raycaster();
        ray.setFromCamera(mouse, camera);
        const hits = ray.intersectObject(globe);
        if (hits.length > 0) {
          const { lat, lng } = hitToLatLng(hits[0].point, globe.matrixWorld);
          const sx = Math.min(e.clientX - rect.left, W - 270);
          const sy = Math.min(e.clientY - rect.top,  H - 160);
          setModal({ sx, sy, lat, lng });
        }
      }
    };

    container.addEventListener('mousedown',  onDown as EventListener);
    container.addEventListener('touchstart', onDown as EventListener, { passive: true });
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('touchmove', onMove as EventListener, { passive: true });
    window.addEventListener('mouseup',   onUp   as EventListener);
    window.addEventListener('touchend',  onUp   as EventListener);

    /* resize */
    const onResize = () => {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      renderer.setSize(nW, nH);
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    /* ── animation loop ──────────────────────────────────── */
    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      if (dragging.current) {
        /* user is actively dragging — no auto anything */
      } else if (pausedRef.current) {
        /* throw momentum — decay velocity */
        velRef.current.x *= FRICTION;
        velRef.current.y *= FRICTION;
        globe.rotation.y     += velRef.current.x;
        globe.rotation.x     += velRef.current.y;
        pinsGroup.rotation.y += velRef.current.x;
        pinsGroup.rotation.x += velRef.current.y;
      } else {
        /* auto rotate */
        globe.rotation.y     += AUTO_SPEED;
        pinsGroup.rotation.y += AUTO_SPEED;
      }

      renderer.render(scene, camera);
    };
    animate();

    return () => {
      cancelAnimationFrame(rafRef.current);
      if (pauseTimer.current) clearTimeout(pauseTimer.current);
      container.removeEventListener('mousedown',  onDown as EventListener);
      container.removeEventListener('touchstart', onDown as EventListener);
      window.removeEventListener('mousemove', onMove as EventListener);
      window.removeEventListener('touchmove', onMove as EventListener);
      window.removeEventListener('mouseup',   onUp   as EventListener);
      window.removeEventListener('touchend',  onUp   as EventListener);
      window.removeEventListener('resize', onResize);
      renderer.dispose();
      if (container.contains(renderer.domElement)) container.removeChild(renderer.domElement);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ── rebuild 3-D pins ────────────────────────────────────── */
  useEffect(() => {
    const group = pinsGroupRef.current;
    if (!group) return;
    while (group.children.length) group.remove(group.children[0]);

    pins.forEach((pin) => {
      const pos = latLngToVec3(pin.lat, pin.lng, 1.01);

      const stick = new THREE.Mesh(
        new THREE.CylinderGeometry(0.004, 0.004, 0.09, 8),
        new THREE.MeshPhongMaterial({ color: 0x00b4d8 }),
      );
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.018, 10, 10),
        new THREE.MeshPhongMaterial({ color: 0x00e5ff, emissive: 0x003d4d }),
      );
      head.position.y = 0.05;

      const halo = new THREE.Mesh(
        new THREE.SphereGeometry(0.03, 10, 10),
        new THREE.MeshBasicMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.22 }),
      );
      halo.position.y = 0.05;

      const pinGroup = new THREE.Group();
      pinGroup.add(stick, head, halo);
      pinGroup.position.copy(pos);
      pinGroup.lookAt(pos.clone().multiplyScalar(2));
      group.add(pinGroup);
    });
  }, [pins]);

  /* ── save pin ────────────────────────────────────────────── */
  const savePin = async () => {
    if (!modal || !inputLabel.trim()) return;
    setSaving(true);
    setPinError('');
    try {
      const res = await fetch('/api/pins', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ label: inputLabel.trim(), lat: modal.lat, lng: modal.lng }),
      });
      if (res.ok) {
        setInputLabel('');
        setModal(null);
        await fetchPins();
      } else {
        const err = await res.json();
        setPinError(err.error ?? 'Failed to save pin');
      }
    } catch {
      setPinError('Network error — please try again');
    } finally {
      setSaving(false);
    }
  };

  /* ── render ─────────────────────────────────────────────── */
  return (
    <div className="relative w-full h-full select-none overflow-hidden">
      {/* Three.js canvas mount */}
      <div ref={mountRef} className="w-full h-full" />

      {/* Pin modal */}
      {modal && (
        <div
          className="absolute z-50 w-64 rounded-2xl p-4 shadow-2xl"
          style={{
            left      : modal.sx,
            top       : modal.sy,
            background: 'rgba(13,17,23,0.96)',
            border    : '1px solid rgba(0,180,216,0.3)',
            backdropFilter: 'blur(12px)',
          }}
        >
          <p className="text-xs font-mono mb-3" style={{ color: '#8b949e' }}>
            📍 {modal.lat.toFixed(2)}° &nbsp; {modal.lng.toFixed(2)}°
          </p>
          <input
            autoFocus
            className="w-full rounded-xl px-3 py-2 text-sm mb-1 outline-none"
            style={{
              background: 'rgba(255,255,255,0.06)',
              border    : '1px solid rgba(0,180,216,0.35)',
              color     : '#e6edf3',
            }}
            placeholder="Your city or name…"
            value={inputLabel}
            onChange={e => { setInputLabel(e.target.value); setPinError(''); }}
            onKeyDown={e => e.key === 'Enter' && savePin()}
            maxLength={80}
          />
          {pinError && (
            <p className="text-xs mb-2" style={{ color: '#f85149' }}>{pinError}</p>
          )}
          <div className="flex gap-2 mt-2">
            <button
              onClick={savePin}
              disabled={saving || !inputLabel.trim()}
              className="flex-1 text-sm font-semibold rounded-xl py-2 transition-all"
              style={{
                background: saving || !inputLabel.trim() ? 'rgba(0,180,216,0.3)' : '#00b4d8',
                color     : '#fff',
                cursor    : saving || !inputLabel.trim() ? 'not-allowed' : 'pointer',
              }}
            >
              {saving ? 'Saving…' : '📌 Add Pin'}
            </button>
            <button
              onClick={() => { setModal(null); setInputLabel(''); setPinError(''); }}
              className="px-3 text-sm rounded-xl transition-all"
              style={{ background: 'rgba(255,255,255,0.07)', color: '#8b949e' }}
            >
              ✕
            </button>
          </div>
        </div>
      )}

      {/* Visitor count */}
      <div
        className="absolute bottom-5 left-5 text-xs px-3 py-1.5 rounded-full font-medium pointer-events-none"
        style={{
          background    : 'rgba(0,0,0,0.55)',
          border        : '1px solid rgba(255,255,255,0.08)',
          color         : '#8b949e',
          backdropFilter: 'blur(8px)',
        }}
      >
        🌐 {pins.length} visitor {pins.length === 1 ? 'pin' : 'pins'}
      </div>

      {/* Usage hint */}
      <div
        className="absolute bottom-5 right-5 text-xs px-3 py-1.5 rounded-full pointer-events-none"
        style={{
          background    : 'rgba(0,0,0,0.45)',
          border        : '1px solid rgba(255,255,255,0.06)',
          color         : '#656d76',
          backdropFilter: 'blur(8px)',
        }}
      >
        Drag · Click to pin
      </div>
    </div>
  );
}
