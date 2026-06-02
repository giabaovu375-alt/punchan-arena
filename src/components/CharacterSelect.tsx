import { useState, useEffect, useRef, useCallback } from "react";
import { CHARACTERS, type CharacterDef } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  onConfirm: (char: CharacterDef, playerName: string) => void;
}

// Cache raw scenes — CharacterPreview clone riêng để tránh nhầm model
const modelCache = new Map<string, THREE.Group>();

// ─── Deep clone + rebind skeleton (giống GameCanvas) ─────────────────────────
function cloneModel(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  const srcBones: THREE.Bone[] = [];
  const clnBones: THREE.Bone[] = [];
  source.traverse(n => { if ((n as THREE.Bone).isBone) srcBones.push(n as THREE.Bone); });
  clone.traverse(n  => { if ((n as THREE.Bone).isBone) clnBones.push(n as THREE.Bone); });
  clone.traverse(n => {
    if (!(n as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mesh = n as THREE.SkinnedMesh;
    const newBones = mesh.skeleton.bones.map(b => {
      const i = srcBones.indexOf(b);
      return i !== -1 ? clnBones[i] : b;
    });
    mesh.bind(new THREE.Skeleton(newBones, mesh.skeleton.boneInverses), mesh.matrixWorld);
  });
  return clone;
}

// ─── 3D Preview ──────────────────────────────────────────────────────────────
function CharacterPreview({ modelUrl, accent, color }: { modelUrl?: string; accent: string; color: number }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 260, h = el.clientHeight || 360;

    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);
    camera.position.set(0, 1.5, 3.8);
    camera.lookAt(0, 1.1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    // Lighting
    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 2.0);
    rim.position.set(-3, 2, -3); scene.add(rim);
    const btm = new THREE.DirectionalLight(new THREE.Color(accent), 0.4);
    btm.position.set(0, -2, 2); scene.add(btm);

    // Ground disc + ring
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.1, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.18 })
    );
    disc.rotation.x = -Math.PI / 2; disc.position.y = 0.001; scene.add(disc);
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.1, 1.18, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.5, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.002; scene.add(ring);

    const pivot = new THREE.Group();
    scene.add(pivot);

    let cancelled = false;

    const addFallback = () => {
      if (cancelled) return;
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.4, emissive: new THREE.Color(accent), emissiveIntensity: 0.1 });
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.4, 1.0, 16), mat);
      body.position.y = 1.0; g.add(body);
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.3, 24, 24), new THREE.MeshStandardMaterial({ color: 0xf2d9c0, roughness: 0.6 }));
      head.position.y = 1.85; g.add(head);
      pivot.add(g);
    };

    const load = async () => {
      if (!modelUrl) { addFallback(); return; }
      try {
        if (!modelCache.has(modelUrl)) {
          await new Promise<void>((res, rej) => {
            new GLTFLoader().load(modelUrl, gltf => { modelCache.set(modelUrl, gltf.scene as THREE.Group); res(); }, undefined, rej);
          });
        }
        if (cancelled) return;
        const clone = cloneModel(modelCache.get(modelUrl)!);
        const box = new THREE.Box3().setFromObject(clone);
        const sy = box.getSize(new THREE.Vector3()).y;
        if (sy > 0.001) {
          clone.scale.setScalar(2 / sy);
          clone.updateMatrixWorld(true);
          const box2 = new THREE.Box3().setFromObject(clone);
          clone.position.y = -box2.min.y;
          clone.rotation.y = Math.PI;
        }
        pivot.add(clone);
      } catch {
        addFallback();
      }
    };
    load();

    let rafId = 0;
    const t0 = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const t = (performance.now() - t0) / 1000;
      pivot.rotation.y = Math.sin(t * 0.7) * 0.2;
      ring.rotation.z = t * 0.3;
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const nw = el.clientWidth, nh = el.clientHeight;
      renderer.setSize(nw, nh);
      camera.aspect = nw / nh;
      camera.updateProjectionMatrix();
    });
    ro.observe(el);

    return () => {
      cancelled = true;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [modelUrl, accent, color]);

  return <div ref={mountRef} className="h-full w-full" />;
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[9px] uppercase tracking-[0.18em] text-white/40">
        <span>{label}</span>
        <span className="font-black" style={{ color }}>{value}</span>
      </div>
      <div className="h-[2px] overflow-hidden rounded-full bg-white/10">
        <div className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}55, ${color})`, boxShadow: `0 0 6px ${color}` }}
        />
      </div>
    </div>
  );
}

// ─── Main ─────────────────────────────────────────────────────────────────────
export function CharacterSelect({ onConfirm }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [playerName, setPlayerName] = useState("");

  const char   = CHARACTERS[activeIdx];
  const accent = char.accent;

  const prev = useCallback(() => setActiveIdx(i => (i - 1 + CHARACTERS.length) % CHARACTERS.length), []);
  const next = useCallback(() => setActiveIdx(i => (i + 1) % CHARACTERS.length), []);

  const trimmed    = playerName.trim();
  const canConfirm = trimmed.length >= 2;

  const confirm = useCallback(() => {
    if (canConfirm) onConfirm(char, trimmed);
  }, [canConfirm, char, onConfirm, trimmed]);

  // Keyboard nav
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft")  prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prev, next, confirm]);

  // Swipe
  const touchX = useRef<number | null>(null);

  return (
    <div
      className="fixed inset-0 flex overflow-hidden text-white select-none"
      style={{
        background: "radial-gradient(ellipse at 50% 0%, #0d1230 0%, #05060e 55%, #020308 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
    >
      {/* Grid bg */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0 opacity-40"
        style={{
          backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 50% 30%, black 10%, transparent 70%)",
        }}
      />

      {/* Accent glow */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-0 transition-all duration-700"
        style={{ width: 600, height: 600, borderRadius: "50%", background: accent, opacity: 0.06, filter: "blur(120px)" }}
      />

      {/* ── MOBILE: landscape layout ─────────────────────────────────────── */}
      <div className="relative z-10 flex h-full w-full md:hidden"
        onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
        onTouchEnd={e => {
          if (touchX.current == null) return;
          const dx = e.changedTouches[0].clientX - touchX.current;
          if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
          touchX.current = null;
        }}
      >
        {/* Left: 3D model */}
        <div className="relative flex-shrink-0" style={{ width: "42%" }}>
          <CharacterPreview modelUrl={char.modelUrl} accent={accent} color={char.color} />

          {/* Corner brackets */}
          {["top-2 left-2 border-t-2 border-l-2", "top-2 right-2 border-t-2 border-r-2",
            "bottom-2 left-2 border-b-2 border-l-2", "bottom-2 right-2 border-b-2 border-r-2"].map((cls, i) => (
            <div key={i} className={`absolute w-4 h-4 ${cls} transition-colors duration-500`} style={{ borderColor: accent }} />
          ))}

          {/* Nav arrows */}
          <button onClick={prev} className="absolute left-1 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/60 text-xl backdrop-blur active:scale-90 transition-transform">‹</button>
          <button onClick={next} className="absolute right-1 top-1/2 -translate-y-1/2 grid h-9 w-9 place-items-center rounded-full border border-white/15 bg-black/60 text-xl backdrop-blur active:scale-90 transition-transform">›</button>

          {/* Dots */}
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 flex gap-1.5">
            {CHARACTERS.map((_, i) => (
              <button key={i} onClick={() => setActiveIdx(i)}
                className="h-1.5 rounded-full transition-all duration-300"
                style={{ width: i === activeIdx ? 18 : 6, background: i === activeIdx ? accent : "rgba(255,255,255,0.2)" }}
              />
            ))}
          </div>
        </div>

        {/* Right: info */}
        <div className="flex flex-1 flex-col justify-between px-4 py-3 overflow-hidden">
          {/* Title */}
          <div>
            <div className="text-[8px] uppercase tracking-[0.5em] text-white/30 mb-0.5">Chọn nhân vật</div>
            <div className="text-[10px] uppercase tracking-[0.3em] mb-1 transition-colors duration-500" style={{ color: accent }}>{char.title}</div>
            <div className="text-2xl font-black tracking-wider leading-none mb-1"
              style={{ textShadow: `0 0 30px ${accent}88` }}
            >{char.name}</div>
            <p className="text-[10px] leading-relaxed text-white/50 line-clamp-2 mb-3">{char.description}</p>
          </div>

          {/* Stats */}
          <div className="rounded-xl border p-3 mb-3 transition-all duration-500"
            style={{ borderColor: `${accent}25`, background: "rgba(255,255,255,0.03)" }}
          >
            <div className="grid grid-cols-2 gap-x-4">
              <StatBar label="HP"  value={char.stats.hp}  color={accent} />
              <StatBar label="ATK" value={char.stats.atk} color={accent} />
              <StatBar label="SPD" value={char.stats.spd} color={accent} />
              <StatBar label="DEF" value={char.stats.def} color={accent} />
            </div>
          </div>

          {/* Input + confirm */}
          <div className="flex gap-2">
            <input
              type="text" maxLength={20} value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirm()}
              placeholder="Tên người chơi..."
              className="h-10 flex-1 min-w-0 rounded-xl border bg-white/5 px-3 text-xs font-semibold outline-none transition-all placeholder:text-white/20"
              style={{ borderColor: canConfirm ? `${accent}88` : "rgba(255,255,255,0.1)" }}
            />
            <button onClick={confirm} disabled={!canConfirm}
              className="h-10 shrink-0 rounded-xl px-4 text-xs font-black uppercase tracking-wider text-black transition-all disabled:opacity-25"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}bb)`, boxShadow: canConfirm ? `0 4px 20px ${accent}55` : "none", minWidth: 80 }}
            >▶ GO</button>
          </div>
          {!canConfirm && (
            <div className="mt-1 text-[9px] text-white/25 tracking-wider uppercase text-center">Nhập tối thiểu 2 ký tự</div>
          )}
        </div>
      </div>

      {/* ── DESKTOP ──────────────────────────────────────────────────────── */}
      <div className="relative z-10 hidden h-full w-full flex-col md:flex">
        {/* Header */}
        <header className="flex-shrink-0 px-6 pt-6 text-center">
          <div className="text-[9px] uppercase tracking-[0.5em] text-white/25 mb-1">Chọn nhân vật</div>
          <h1 className="text-4xl font-black tracking-[0.12em] uppercase transition-all duration-500"
            style={{ textShadow: `0 0 60px ${accent}66` }}
          >PUNCHAN ARENA</h1>
          <div className="mx-auto mt-2 flex items-center justify-center gap-3">
            <div className="h-px w-20 transition-all duration-500" style={{ background: `linear-gradient(to right, transparent, ${accent}66)` }} />
            <div className="h-1.5 w-1.5 rounded-full transition-all duration-500" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
            <div className="h-px w-20 transition-all duration-500" style={{ background: `linear-gradient(to left, transparent, ${accent}66)` }} />
          </div>
        </header>

        {/* Cards */}
        <main className="flex flex-1 items-stretch justify-center gap-4 px-6 py-4 min-h-0"
          style={{ maxHeight: "calc(100vh - 160px)" }}
        >
          {CHARACTERS.map((c, i) => {
            const active = i === activeIdx;
            return (
              <button key={c.id} onClick={() => setActiveIdx(i)}
                className="relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-400 cursor-pointer"
                style={{
                  flex: active ? "2 1 0" : "1 1 0",
                  transition: "flex 0.4s cubic-bezier(.4,0,.2,1), border-color 0.3s, box-shadow 0.3s",
                  borderColor: active ? c.accent : "rgba(255,255,255,0.06)",
                  background: active
                    ? `radial-gradient(ellipse at 50% 100%, ${c.accent}22 0%, rgba(255,255,255,0.02) 65%)`
                    : "rgba(255,255,255,0.02)",
                  boxShadow: active ? `0 0 50px ${c.accent}22, inset 0 0 0 1px ${c.accent}33` : "none",
                }}
              >
                {/* Corner brackets on active */}
                {active && <>
                  <div className="absolute top-2.5 left-2.5 w-4 h-4 border-t-2 border-l-2 z-10" style={{ borderColor: c.accent }} />
                  <div className="absolute top-2.5 right-2.5 w-4 h-4 border-t-2 border-r-2 z-10" style={{ borderColor: c.accent }} />
                </>}

                {/* 3D preview */}
                <div className="relative min-h-0 flex-1">
                  <CharacterPreview modelUrl={c.modelUrl} accent={c.accent} color={c.color} />
                  {/* Name overlay */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/40 to-transparent px-4 pb-3 pt-10">
                    <div className="text-[8px] uppercase tracking-[0.3em] mb-0.5 transition-colors duration-300" style={{ color: c.accent }}>{c.title}</div>
                    <div className="font-black transition-all duration-300" style={{ fontSize: active ? 22 : 14 }}>{c.name}</div>
                  </div>
                </div>

                {/* Stats panel — only active */}
                {active && (
                  <div className="flex-shrink-0 border-t px-4 py-3" style={{ borderColor: `${c.accent}25` }}>
                    <p className="mb-2 line-clamp-1 text-[10px] leading-relaxed text-white/50">{c.description}</p>
                    <div className="grid grid-cols-2 gap-x-5">
                      <StatBar label="HP"  value={c.stats.hp}  color={c.accent} />
                      <StatBar label="ATK" value={c.stats.atk} color={c.accent} />
                      <StatBar label="SPD" value={c.stats.spd} color={c.accent} />
                      <StatBar label="DEF" value={c.stats.def} color={c.accent} />
                    </div>
                  </div>
                )}
              </button>
            );
          })}
        </main>

        {/* Footer */}
        <footer className="flex-shrink-0 mx-auto flex w-full max-w-lg flex-col gap-2 px-6 pb-6">
          <div className="flex gap-2">
            <input
              type="text" maxLength={20} value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirm()}
              placeholder="Nhập tên người chơi..."
              className="h-12 flex-1 rounded-xl border bg-white/5 px-4 text-sm font-semibold outline-none transition-all placeholder:text-white/20"
              style={{ borderColor: canConfirm ? `${accent}99` : "rgba(255,255,255,0.1)", boxShadow: canConfirm ? `0 0 0 2px ${accent}22` : "none" }}
            />
            <button onClick={confirm} disabled={!canConfirm}
              className="h-12 shrink-0 rounded-xl px-6 text-sm font-black uppercase tracking-[0.1em] text-black transition-all disabled:opacity-25 disabled:cursor-not-allowed"
              style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)`, boxShadow: canConfirm ? `0 6px 28px ${accent}55` : "none", minWidth: 130 }}
            >▶ {char.name}</button>
          </div>
          {!canConfirm && (
            <div className="text-center text-[10px] text-white/25 tracking-wider uppercase">Nhập tên tối thiểu 2 ký tự để bắt đầu</div>
          )}
        </footer>
      </div>
    </div>
  );
}
