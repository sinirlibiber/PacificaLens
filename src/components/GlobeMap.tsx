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
  // lat: consistent with latLngToVec3 where y = cos(phi), phi = (90-lat)*PI/180
  const lat = 90 - Math.acos(Math.max(-1, Math.min(1, n.y))) * (180 / Math.PI);
  // lng: latLngToVec3 sets x=-sin(phi)*cos(theta), z=sin(phi)*sin(theta)
  // so theta=atan2(z,-x), lng=theta*(180/PI)-180, then normalise to [-180,180]
  const theta = Math.atan2(n.z, -n.x);
  let lng = theta * (180 / Math.PI) - 180;
  if (lng < -180) lng += 360;
  if (lng >  180) lng -= 360;
  return { lat, lng };
}

/* ── ocean / region name fallback ────────────────────────────── */
function getOceanOrRegion(lat: number, lng: number): string {
  // Pacific Ocean
  if (lng > 120 && lng <= 180 && lat > -60 && lat < 65) return 'Pacific Ocean';
  if (lng >= -180 && lng < -70 && lat > -60 && lat < 65) return 'Pacific Ocean';
  // Atlantic Ocean
  if (lng >= -70 && lng < 20 && lat > -60 && lat < 65) return 'Atlantic Ocean';
  // Indian Ocean
  if (lng >= 20 && lng <= 120 && lat > -60 && lat < 30) return 'Indian Ocean';
  // Arctic Ocean
  if (lat >= 65) return 'Arctic Ocean';
  // Southern Ocean
  if (lat <= -60) return 'Southern Ocean';
  // Mediterranean Sea
  if (lng >= -5 && lng <= 42 && lat >= 30 && lat <= 47) return 'Mediterranean Sea';
  return `${lat >= 0 ? lat.toFixed(1) + '°N' : (-lat).toFixed(1) + '°S'}, ${lng >= 0 ? lng.toFixed(1) + '°E' : (-lng).toFixed(1) + '°W'}`;
}

/* ── reverse geocode via Nominatim ───────────────────────────── */
async function reverseGeocode(lat: number, lng: number): Promise<string> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&zoom=6&addressdetails=1`,
      { headers: { 'Accept-Language': 'en', 'User-Agent': 'PacificaLens/1.0' } }
    );
    const data = await res.json();
    // Nominatim returns error key when nothing is found (e.g. ocean)
    if (data.error) return getOceanOrRegion(lat, lng);
    const a = data.address ?? {};
    const city    = a.city || a.town || a.village || a.county || a.state_district || a.suburb || a.municipality || '';
    const state   = a.state || a.region || '';
    const country = a.country_code ? a.country_code.toUpperCase() : (a.country || '');
    if (city && country) return `${city}, ${country}`;
    if (state && country) return `${state}, ${country}`;
    if (country)         return country;
    if (data.display_name) {
      // Take last meaningful part (usually country) from display_name
      const parts = data.display_name.split(',').map((s: string) => s.trim()).filter(Boolean);
      if (parts.length >= 2) return `${parts[0]}, ${parts[parts.length - 1]}`;
      return parts[0] ?? getOceanOrRegion(lat, lng);
    }
    return getOceanOrRegion(lat, lng);
  } catch {
    return getOceanOrRegion(lat, lng);
  }
}

/* ── constants ───────────────────────────────────────────────── */
const AUTO_SPEED   = 0.0005;
const PAUSE_MS     = 15000;
const FRICTION     = 0.88;
const THROW_SCALE  = 0.004;
const DRAG_SPEED   = 0.0018;
const ZOOM_MIN     = 1.6;
const ZOOM_MAX     = 4.5;
const ZOOM_SPEED   = 0.001;
const MAX_LAT_RAD  = 75 * (Math.PI / 180);

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
  const zoomRef     = useRef(3.90);
  const tiltRef     = useRef(0);

  const [pins,      setPins    ] = useState<Pin[]>([]);
  const [modal,     setModal   ] = useState<{
    sx: number; sy: number; lat: number; lng: number;
    label: string | null; // null = loading
  } | null>(null);
  const [saving,    setSaving  ] = useState(false);
  const [pinError,  setPinError] = useState('');
  const [showInfo,  setShowInfo] = useState(true);

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

    // Deep space background
    scene.background = new THREE.Color(0x020610);

    // Lighting — sun from upper-right, cool rim from left
    scene.add(new THREE.AmbientLight(0x1a2a4a, 0.9));
    const sun = new THREE.DirectionalLight(0xaad4ff, 1.6);
    sun.position.set(6, 4, 5);
    scene.add(sun);
    const rimLight = new THREE.DirectionalLight(0x002244, 0.4);
    rimLight.position.set(-5, -2, -3);
    scene.add(rimLight);

    // High-res earth
    const geo = new THREE.SphereGeometry(1, 96, 96);
    const loader = new THREE.TextureLoader();
    const tex = loader.load('https://unpkg.com/three-globe/example/img/earth-blue-marble.jpg');
    tex.anisotropy = 4;
    const mat = new THREE.MeshPhongMaterial({ map: tex, shininess: 35, specular: new THREE.Color(0x223366) });
    const globe = new THREE.Mesh(geo, mat);
    scene.add(globe);
    globeRef.current = globe;

    // Atmosphere glow — inner
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.02, 72, 72),
      new THREE.MeshPhongMaterial({ color: 0x0088cc, transparent: true, opacity: 0.12, side: THREE.FrontSide }),
    ));
    // Atmosphere glow — outer halo
    scene.add(new THREE.Mesh(
      new THREE.SphereGeometry(1.08, 72, 72),
      new THREE.MeshPhongMaterial({ color: 0x0055aa, transparent: true, opacity: 0.05, side: THREE.BackSide }),
    ));

    // Stars — layered for depth
    const addStars = (count: number, spread: number, size: number, opacity: number) => {
      const pos = new Float32Array(count * 3);
      for (let i = 0; i < count * 3; i++) pos[i] = (Math.random() - 0.5) * spread;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      scene.add(new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size, transparent: true, opacity })));
    };
    addStars(4000, 160, 0.12, 0.9);  // far bright stars
    addStars(2000, 80,  0.07, 0.6);  // mid stars
    addStars(800,  40,  0.05, 0.4);  // near dim stars

    const pinsGroup = new THREE.Group();
    scene.add(pinsGroup);
    pinsGroupRef.current = pinsGroup;

    // Pin pulse animation ring — rendered as sprite overlay in CSS
    // (actual pulse done via CSS on HTML overlays, Three.js handles 3D positioning)

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

      const tiltFactor = Math.abs(Math.cos(tiltRef.current));
      const poleFactor = 0.25 + 0.75 * tiltFactor;

      velRef.current = { x: dx * THROW_SCALE * poleFactor, y: dy * THROW_SCALE };

      globe.rotation.y     += dx * DRAG_SPEED * poleFactor;
      pinsGroup.rotation.y += dx * DRAG_SPEED * poleFactor;

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
        // Force matrix update so we get the exact current rotation
        globe.updateMatrixWorld(true);
        const ray = new THREE.Raycaster();
        ray.setFromCamera(mouse, camera);
        const hits = ray.intersectObject(globe);
        if (hits.length > 0) {
          const { lat, lng } = hitToLatLng(hits[0].point, globe.matrixWorld);
          const sx = Math.min(e.clientX - rect.left, nW - 260);
          const sy = Math.min(e.clientY - rect.top,  nH - 130);
          // Open modal immediately with loading state, then fetch location
          setModal({ sx, sy, lat, lng, label: null });
          setPinError('');
          reverseGeocode(lat, lng).then(label => {
            setModal(prev => prev ? { ...prev, label } : null);
          });
        }
      }
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const tiltFactor = Math.abs(Math.cos(tiltRef.current));
      const poleSlow = 0.3 + 0.7 * tiltFactor;
      zoomRef.current = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoomRef.current + e.deltaY * ZOOM_SPEED * poleSlow));
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
          velRef.current.x *= FRICTION;
          velRef.current.y *= FRICTION;
          globe.rotation.y     += velRef.current.x;
          pinsGroup.rotation.y += velRef.current.x;
          const newTilt = tiltRef.current + velRef.current.y;
          tiltRef.current = Math.max(-MAX_LAT_RAD, Math.min(MAX_LAT_RAD, newTilt));
          globe.rotation.x     = tiltRef.current;
          pinsGroup.rotation.x = tiltRef.current;
        } else {
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

  /* ── rebuild pins as map-pin sprites ────────────────────── */
  useEffect(() => {
    const group = pinsGroupRef.current;
    if (!group) return;
    while (group.children.length) group.remove(group.children[0]);

    const spriteMap = new THREE.TextureLoader().load(PIN_SPRITE_B64);
    const spriteMat = new THREE.SpriteMaterial({
      map: spriteMap,
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
      color: 0x00e5ff,  // neon cyan
    });

    pins.forEach((pin) => {
      const pos = latLngToVec3(pin.lat, pin.lng, 1.04);
      const sprite = new THREE.Sprite(spriteMat.clone());
      const sw = 0.052;
      const sh = sw * (160 / 128);
      sprite.scale.set(sw, sh, 1);
      const dir = pos.clone().normalize();
      sprite.position.copy(pos.clone().add(dir.multiplyScalar(sh * 0.22)));
      group.add(sprite);
    });
  }, [pins]);

  /* ── save pin ────────────────────────────────────────────── */
  const savePin = async () => {
    if (!modal || !modal.label) return;
    setSaving(true);
    setPinError('');
    try {
      const res = await fetch('/api/pins', {
        method : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body   : JSON.stringify({ label: modal.label, lat: modal.lat, lng: modal.lng }),
      });
      if (res.ok) {
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
    <div className="relative w-full h-full select-none overflow-hidden" style={{ background: '#020610' }}>

      {/* Nebula / deep space background */}
      <div className="absolute inset-0 pointer-events-none" style={{ zIndex: 0 }}>
        {/* Purple nebula cloud top-left */}
        <div style={{
          position: 'absolute', top: '-10%', left: '-5%',
          width: '55%', height: '60%',
          background: 'radial-gradient(ellipse at 30% 40%, rgba(80,20,140,0.35) 0%, rgba(40,10,80,0.15) 45%, transparent 70%)',
          filter: 'blur(40px)',
        }} />
        {/* Blue nebula right */}
        <div style={{
          position: 'absolute', top: '10%', right: '-10%',
          width: '50%', height: '55%',
          background: 'radial-gradient(ellipse at 70% 30%, rgba(0,60,140,0.3) 0%, rgba(0,30,80,0.12) 50%, transparent 70%)',
          filter: 'blur(50px)',
        }} />
        {/* Cyan accent center */}
        <div style={{
          position: 'absolute', top: '30%', left: '20%',
          width: '60%', height: '40%',
          background: 'radial-gradient(ellipse at 50% 50%, rgba(0,100,180,0.08) 0%, transparent 60%)',
          filter: 'blur(30px)',
        }} />
        {/* Bottom purple */}
        <div style={{
          position: 'absolute', bottom: '-5%', right: '10%',
          width: '45%', height: '50%',
          background: 'radial-gradient(ellipse at 60% 70%, rgba(100,20,160,0.2) 0%, transparent 65%)',
          filter: 'blur(45px)',
        }} />
      </div>

      <style>{`
        @keyframes pinPulse {
          0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.8; }
          50%  { transform: translate(-50%,-50%) scale(1.6); opacity: 0.3; }
          100% { transform: translate(-50%,-50%) scale(1);   opacity: 0.8; }
        }
        @keyframes pinPulseOuter {
          0%   { transform: translate(-50%,-50%) scale(1);   opacity: 0.4; }
          50%  { transform: translate(-50%,-50%) scale(2.2); opacity: 0;   }
          100% { transform: translate(-50%,-50%) scale(1);   opacity: 0.4; }
        }
      `}</style>

      <div ref={mountRef} className="w-full h-full" style={{ position: 'relative', zIndex: 1 }} />

      {/* ── Info panel ──────────────────────────────────── */}
      {showInfo && (
        <div
          className="absolute z-30 rounded-2xl"
          style={{
            top           : '50%',
            right         : '28px',
            transform     : 'translateY(-50%)',
            width         : '300px',
            background    : 'rgba(8,14,22,0.86)',
            border        : '1px solid rgba(0,210,210,0.30)',
            backdropFilter: 'blur(18px)',
            boxShadow     : '0 8px 40px rgba(0,0,0,0.55)',
          }}
        >
          <button
            onClick={() => setShowInfo(false)}
            className="absolute flex items-center justify-center rounded-full transition-all"
            style={{
              top: '-11px', right: '-11px',
              width: '26px', height: '26px',
              background: '#c0392b',
              border: '2px solid rgba(255,255,255,0.15)',
              color: '#fff', fontSize: '13px', fontWeight: 700,
              lineHeight: 1, cursor: 'pointer', zIndex: 10,
            }}
            aria-label="Close"
          >✕</button>
          <div className="p-6">
            <p className="font-bold mb-3" style={{ color: '#e6edf3', fontSize: '15px', lineHeight: 1.5 }}>
              🌍 Welcome to the PacificaLens family.
            </p>
            <p style={{ color: '#a0adb8', fontSize: '13.5px', lineHeight: '1.7' }}>
              Mark where you are in the world and let our map come alive with you.
            </p>
            <p className="mt-3" style={{ color: '#a0adb8', fontSize: '13.5px', lineHeight: '1.7' }}>
              📍 Your pin is visible to everyone. Our goal is to bring together our
              community from all around the world on this map. Location data is used
              only for this map and is not stored for any other purpose.
            </p>
          </div>
        </div>
      )}

      {/* ── Pin confirm modal ────────────────────────────── */}
      {modal && (
        <div
          className="absolute z-50 rounded-2xl p-4 shadow-2xl"
          style={{
            left          : modal.sx,
            top           : modal.sy,
            width         : '248px',
            background    : 'rgba(13,17,23,0.96)',
            border        : '1px solid rgba(0,180,216,0.3)',
            backdropFilter: 'blur(12px)',
          }}
        >
          {modal.label === null ? (
            /* Loading state */
            <div className="flex items-center gap-3 py-1">
              <div
                className="w-5 h-5 rounded-full border-2 animate-spin flex-shrink-0"
                style={{ borderColor: 'rgba(0,180,216,0.25)', borderTopColor: '#00b4d8' }}
              />
              <p className="text-sm" style={{ color: '#8b949e' }}>Finding location…</p>
            </div>
          ) : (
            /* Location found */
            <>
              <div className="flex items-center gap-2 mb-3">
                <span style={{ fontSize: '18px' }}>📍</span>
                <p className="font-semibold text-sm" style={{ color: '#e6edf3' }}>
                  {modal.label}
                </p>
              </div>
              <p className="text-xs mb-3" style={{ color: '#656d76' }}>
                {modal.lat.toFixed(2)}°, {modal.lng.toFixed(2)}°
              </p>
              {pinError && (
                <p className="text-xs mb-2" style={{ color: '#f85149' }}>{pinError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={savePin}
                  disabled={saving}
                  className="flex-1 text-sm font-semibold rounded-xl py-2 transition-all"
                  style={{
                    background: saving ? 'rgba(0,180,216,0.3)' : '#00b4d8',
                    color: '#fff',
                    cursor: saving ? 'not-allowed' : 'pointer',
                  }}
                >
                  {saving ? 'Saving…' : '📌 Add my pin'}
                </button>
                <button
                  onClick={() => { setModal(null); setPinError(''); }}
                  className="px-3 text-sm rounded-xl transition-all"
                  style={{ background: 'rgba(255,255,255,0.07)', color: '#8b949e', cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            </>
          )}
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
