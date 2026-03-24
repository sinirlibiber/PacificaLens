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
const AUTO_SPEED   = 0.0008;
const PAUSE_MS     = 15000;
const FRICTION     = 0.94;
const THROW_SCALE  = 0.012;
const ZOOM_MIN     = 1.5;
const ZOOM_MAX     = 5.0;
const ZOOM_SPEED   = 0.0012;

/* ── pushpin colors ──────────────────────────────────────────── */
const PIN_COLORS = [
  0xffcc00, // yellow
  0xff6600, // orange
  0xff1a1a, // red
  0xcc00cc, // purple
  0x00cc44, // green
  0x8B4513, // brown
  0x1a1aff, // dark blue
  0x66aaff, // light blue
  0x00bb88, // teal
  0x111111, // black
];

function buildPushpin(color: number): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshPhongMaterial({ color, shininess: 60 });

  const cap = new THREE.Mesh(new THREE.SphereGeometry(0.022, 12, 12), mat);
  cap.scale.set(1, 0.7, 1);
  cap.position.y = 0.055;

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.010, 0.032, 12), mat);
  body.position.y = 0.028;

  const needle = new THREE.Mesh(
    new THREE.ConeGeometry(0.004, 0.030, 8),
    new THREE.MeshPhongMaterial({ color: 0x888888, shininess: 80 }),
  );
  needle.position.y = 0.004;
  needle.rotation.z = Math.PI;

  group.add(cap, body, needle);
  return group;
}

export default function GlobeMap() {
  const mountRef = useRef<HTMLDivElement>(null);

  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
  const sceneRef     = useRef<THREE.Scene | null>(null);
  const cameraRef    = useRef<THREE.PerspectiveCamera | null>(null);
  const globeRef     = useRef<THREE.Mesh | null>(null);
  const pinsGroupRef = useRef<THREE.Group | null>(null);
  const rafRef       = useRef<number>(0);

  const velRef      = useRef({ x: 0, y: 0 });
  const dragging    = useRef(false);
  const hasMoved    = useRef(false);
  const prevMouse   = useRef({ x: 0, y: 0 });
  const pauseTimer  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pausedRef   = useRef(false);
  const zoomRef     = useRef(2.6);

  const [pins,       setPins      ] = useState<Pin[]>([]);
  const [modal,      setModal     ] = useState<{ sx: number; sy: number; lat: number; lng: number } | null>(null);
  const [inputLabel, setInputLabel] = useState('');
  const [saving,     setSaving    ] = useState(false);
  const [pinError,   setPinError  ] = useState('');
  const [showInfo,   setShowInfo  ] = useState(false);

  const fetchPins = useCallback(async () => {
    try {
      const res  = await fetch('/api/pins');
      const data = await res.json();
      if (Array.isArray(data)) setPins(data);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { fetchPins(); }, [fetchPins]);

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

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setSize(W, H);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(renderer.domElement);
    rendererRef.current = renderer;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, W / H, 0.1, 1000);
    camera.position.z = zoomRef.current;
    sceneRef.current  = scene;
    cameraRef.current = camera;

    scene.add(new THREE.AmbientLight(0xffffff, 0.7));
    const sun = new THREE.DirectionalLight(0x88ccff, 1.2);
    sun.position.set(5, 3, 5);
    scene.add(sun);

    const geo = new THREE.SphereGeometry(1, 72, 72);
    const tex = new THREE.TextureLoader().load(
      'https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg'
    );
    const mat   = new THREE.MeshPhongMaterial({ map: tex, shininess: 15 });
    const globe = new THREE.Mesh(geo, mat);
    scene.add(globe);
    globeRef.current = globe;

    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.03, 72, 72),
      new THREE.MeshPhongMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.07, side: THREE.FrontSide }),
    ));

    const starPos = new Float32Array(6000).map(() => (Math.random() - 0.5) * 120);
    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
    scene.add(new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 0.08 })));

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
      velRef.current    = { x: 0, y: 0 };
      startPause();
    };

    const onMove = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      const { x, y } = getXY(e);
      const dx = x - prevMouse.current.x;
      const dy = y - prevMouse.current.y;
      if (Math.abs(dx) > 1 || Math.abs(dy) > 1) hasMoved.current = true;

      velRef.current = { x: dx * THROW_SCALE, y: dy * THROW_SCALE };

      // Slow horizontal rotation near poles
      const tiltFactor = Math.abs(Math.cos(globe.rotation.x));
      const poleFactor = 0.3 + 0.7 * tiltFactor;

      globe.rotation.y     += dx * 0.005 * poleFactor;
      globe.rotation.x     += dy * 0.005;
      pinsGroup.rotation.y += dx * 0.005 * poleFactor;
      pinsGroup.rotation.x += dy * 0.005;
      prevMouse.current = { x, y };
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
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

    /* ── scroll wheel zoom ───────────────────────────────── */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      // Zoom slows down near poles
      const tiltFactor = Math.abs(Math.cos(globe.rotation.x));
      const poleSlow = 0.25 + 0.75 * tiltFactor;

      zoomRef.current = Math.max(
        ZOOM_MIN,
        Math.min(ZOOM_MAX, zoomRef.current + e.deltaY * ZOOM_SPEED * poleSlow)
      );
      camera.position.z = zoomRef.current;
    };

    container.addEventListener('mousedown',  onDown as EventListener);
    container.addEventListener('touchstart', onDown as EventListener, { passive: true });
    window.addEventListener('mousemove', onMove as EventListener);
    window.addEventListener('touchmove', onMove as EventListener, { passive: true });
    window.addEventListener('mouseup',   onUp   as EventListener);
    window.addEventListener('touchend',  onUp   as EventListener);
    container.addEventListener('wheel', onWheel, { passive: false });

    const onResize = () => {
      const nW = container.clientWidth;
      const nH = container.clientHeight;
      renderer.setSize(nW, nH);
      camera.aspect = nW / nH;
      camera.updateProjectionMatrix();
    };
    window.addEventListener('resize', onResize);

    const animate = () => {
      rafRef.current = requestAnimationFrame(animate);

      if (dragging.current) {
        // user dragging
      } else if (pausedRef.current) {
        velRef.current.x *= FRICTION;
        velRef.current.y *= FRICTION;
        globe.rotation.y     += velRef.current.x;
        globe.rotation.x     += velRef.current.y;
        pinsGroup.rotation.y += velRef.current.x;
        pinsGroup.rotation.x += velRef.current.y;
      } else {
        // auto-rotate, slow near poles
        const tiltFactor = Math.abs(Math.cos(globe.rotation.x));
        const speed = AUTO_SPEED * (0.2 + 0.8 * tiltFactor);
        globe.rotation.y     += speed;
        pinsGroup.rotation.y += speed;
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
      container.removeEventListener('wheel', onWheel);
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
      // Deterministic color per pin id
      const colorIndex = pin.id
        ? pin.id.split('').reduce((acc, c) => acc + c.charCodeAt(0), 0) % PIN_COLORS.length
        : Math.floor(Math.random() * PIN_COLORS.length);

      const pinGroup = buildPushpin(PIN_COLORS[colorIndex]);
      pinGroup.scale.setScalar(0.55); // small pins
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
      {/* Three.js canvas */}
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

      {/* Info button (bottom-right above usage hint) */}
      <button
        onClick={() => setShowInfo(v => !v)}
        className="absolute z-30 flex items-center justify-center rounded-full transition-all"
        style={{
          bottom    : '52px',
          right     : '18px',
          width     : '26px',
          height    : '26px',
          background: showInfo ? 'rgba(0,180,216,0.25)' : 'rgba(0,0,0,0.50)',
          border    : '1px solid rgba(0,180,216,0.40)',
          color     : '#00b4d8',
          fontSize  : '12px',
          fontWeight: 700,
          cursor    : 'pointer',
        }}
        aria-label="About this map"
      >
        i
      </button>

      {/* Info panel */}
      {showInfo && (
        <div
          className="absolute z-40 rounded-2xl p-4 shadow-2xl"
          style={{
            bottom        : '82px',
            right         : '14px',
            width         : '292px',
            background    : 'rgba(13,17,23,0.97)',
            border        : '1px solid rgba(0,180,216,0.28)',
            backdropFilter: 'blur(14px)',
            color         : '#8b949e',
            fontSize      : '12px',
            lineHeight    : '1.65',
          }}
        >
          <p className="font-semibold mb-2" style={{ color: '#e6edf3', fontSize: '13px' }}>
            🌍 Welcome to the PacificaLens family.
          </p>
          <p>
            Mark where you are in the world and let our map come alive with you.
          </p>
          <p className="mt-2">
            📍 Your pin is visible to everyone. Our goal is to bring together our
            community from all around the world on this map. Location data is used
            only for this map and is not stored for any other purpose.
          </p>
          <button
            onClick={() => setShowInfo(false)}
            className="mt-3 text-xs"
            style={{ color: '#00b4d8', cursor: 'pointer' }}
          >
            Close ✕
          </button>
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
        Scroll to zoom · Drag · Click to pin
      </div>
    </div>
  );
}
