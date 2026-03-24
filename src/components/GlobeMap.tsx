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
const AUTO_SPEED   = 0.0005;   // slower auto-rotation
const PAUSE_MS     = 15000;
const FRICTION     = 0.88;     // more friction = less throw
const THROW_SCALE  = 0.004;    // much slower drag
const DRAG_SPEED   = 0.0018;   // slower manual drag
const ZOOM_MIN     = 1.6;
const ZOOM_MAX     = 4.5;
const ZOOM_SPEED   = 0.001;
const MAX_LAT_RAD  = 75 * (Math.PI / 180); // clamp poles to ±75°

/* ── pin sprite (base64) ─────────────────────────────────────── */
const PIN_SPRITE_B64 = 'data:image/png;base64,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';

export default function GlobeMap() {
  const mountRef = useRef<HTMLDivElement>(null);

  const rendererRef  = useRef<THREE.WebGLRenderer | null>(null);
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
  // tiltRef holds current X rotation (latitude tilt) in radians
  const tiltRef     = useRef(0);

  const [pins,       setPins      ] = useState<Pin[]>([]);
  const [modal,      setModal     ] = useState<{ sx: number; sy: number; lat: number; lng: number } | null>(null);
  const [inputLabel, setInputLabel] = useState('');
  const [saving,     setSaving    ] = useState(false);
  const [pinError,   setPinError  ] = useState('');

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

      // Slow near poles
      const tiltFactor = Math.abs(Math.cos(tiltRef.current));
      const poleFactor = 0.25 + 0.75 * tiltFactor;

      velRef.current = { x: dx * THROW_SCALE * poleFactor, y: dy * THROW_SCALE };

      // Apply Y rotation
      globe.rotation.y     += dx * DRAG_SPEED * poleFactor;
      pinsGroup.rotation.y += dx * DRAG_SPEED * poleFactor;

      // Clamp X rotation (lat) to ±MAX_LAT_RAD
      const newTilt = tiltRef.current + dy * DRAG_SPEED;
      tiltRef.current = Math.max(-MAX_LAT_RAD, Math.min(MAX_LAT_RAD, newTilt));
      globe.rotation.x     = tiltRef.current;
      pinsGroup.rotation.x = tiltRef.current;

      prevMouse.current = { x, y };
    };

    const onUp = (e: MouseEvent | TouchEvent) => {
      if (!dragging.current) return;
      dragging.current = false;
      if (!hasMoved.current && 'clientX' in e) {
        const rect  = container.getBoundingClientRect();
        const nW = container.clientWidth;
        const nH = container.clientHeight;
        const mouse = new THREE.Vector2(
          ((e.clientX - rect.left) / nW) * 2 - 1,
         -((e.clientY - rect.top)  / nH) * 2 + 1,
        );
        const ray = new THREE.Raycaster();
        ray.setFromCamera(mouse, camera);
        const hits = ray.intersectObject(globe);
        if (hits.length > 0) {
          const { lat, lng } = hitToLatLng(hits[0].point, globe.matrixWorld);
          const sx = Math.min(e.clientX - rect.left, nW - 270);
          const sy = Math.min(e.clientY - rect.top,  nH - 160);
          setModal({ sx, sy, lat, lng });
        }
      }
    };

    /* ── scroll wheel zoom ───────────────────────────────── */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const tiltFactor = Math.abs(Math.cos(tiltRef.current));
      const poleSlow = 0.3 + 0.7 * tiltFactor;

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

      if (!dragging.current) {
        if (pausedRef.current) {
          // throw momentum decay
          velRef.current.x *= FRICTION;
          velRef.current.y *= FRICTION;

          globe.rotation.y     += velRef.current.x;
          pinsGroup.rotation.y += velRef.current.x;

          const newTilt = tiltRef.current + velRef.current.y;
          tiltRef.current = Math.max(-MAX_LAT_RAD, Math.min(MAX_LAT_RAD, newTilt));
          globe.rotation.x     = tiltRef.current;
          pinsGroup.rotation.x = tiltRef.current;
        } else {
          // auto-rotate, slow near poles
          const tiltFactor = Math.abs(Math.cos(tiltRef.current));
          const speed = AUTO_SPEED * (0.15 + 0.85 * tiltFactor);
          globe.rotation.y     += speed;
          pinsGroup.rotation.y += speed;
        }
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

  /* ── rebuild pins as sprites ─────────────────────────────── */
  useEffect(() => {
    const group = pinsGroupRef.current;
    if (!group) return;
    while (group.children.length) group.remove(group.children[0]);

    const spriteMap = new THREE.TextureLoader().load(PIN_SPRITE_B64);
    const spriteMat = new THREE.SpriteMaterial({ map: spriteMap, transparent: true, depthWrite: false });

    pins.forEach((pin) => {
      const pos = latLngToVec3(pin.lat, pin.lng, 1.08);
      const sprite = new THREE.Sprite(spriteMat.clone());
      sprite.scale.set(0.10, 0.10, 1);
      sprite.position.copy(pos);
      group.add(sprite);
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

      {/* ── Info panel — always visible, right side ─────── */}
      <div
        className="absolute z-30 rounded-2xl p-5"
        style={{
          top           : '50%',
          right         : '28px',
          transform     : 'translateY(-50%)',
          width         : '268px',
          background    : 'rgba(8,14,22,0.82)',
          border        : '1px solid rgba(0,210,210,0.28)',
          backdropFilter: 'blur(16px)',
          boxShadow     : '0 8px 32px rgba(0,0,0,0.45)',
          pointerEvents : 'none',
        }}
      >
        <p className="font-bold mb-2" style={{ color: '#e6edf3', fontSize: '13.5px', lineHeight: 1.4 }}>
          🌍 Welcome to the PacificaLens family.
        </p>
        <p style={{ color: '#8b949e', fontSize: '12px', lineHeight: '1.65' }}>
          Mark where you are in the world and let our map come alive with you.
        </p>
        <p className="mt-3" style={{ color: '#8b949e', fontSize: '12px', lineHeight: '1.65' }}>
          📍 Your pin is visible to everyone. Our goal is to bring together our
          community from all around the world on this map. Location data is used
          only for this map and is not stored for any other purpose.
        </p>
      </div>

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
        className="absolute bottom-5 left-1/2 -translate-x-1/2 text-xs px-3 py-1.5 rounded-full pointer-events-none"
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
