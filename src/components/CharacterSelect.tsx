import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CHARACTERS, type CharacterDef } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  onConfirm: (char: CharacterDef, playerName: string) => void;
}

const modelCache = new Map<string, THREE.Object3D>();

function CharacterPreview({
  modelUrl,
  accent,
  color,
  isActive,
}: {
  modelUrl?: string;
  accent: string;
  color: number;
  isActive: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const getSize = () => ({ w: el.clientWidth || 280, h: el.clientHeight || 380 });
    const { w, h } = getSize();

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 100);
    camera.position.set(0, 1.55, 4.2);
    camera.lookAt(0, 1.2, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.55));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(3, 6, 5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 1.6);
    rim.position.set(-3.5, 3, -4);
    scene.add(rim);
    const fill = new THREE.DirectionalLight(0x8ab4ff, 0.4);
    fill.position.set(-2, 1, 4);
    scene.add(fill);

    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.22 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    scene.add(disc);

    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.22, 64),
      new THREE.MeshBasicMaterial({ color: new THREE.Color(accent), transparent: true, opacity: 0.45, side: THREE.DoubleSide })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);

    const pivot = new THREE.Group();
    scene.add(pivot);

    let modelNode: THREE.Object3D | null = null;
    let cancelled = false;

    const fitAndAdd = (source: THREE.Object3D) => {
      if (cancelled) return;
      const clone = source.clone(true);
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      if (size.y <= 0.0001) { addFallback(); return; }
      clone.scale.setScalar(2 / size.y);
      clone.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(clone);
      clone.position.y = -box2.min.y;
      clone.rotation.y = Math.PI;
      pivot.add(clone);
      modelNode = clone;
    };

    const addFallback = () => {
      if (cancelled) return;
      const group = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color), roughness: 0.45, metalness: 0.35,
        emissive: new THREE.Color(accent), emissiveIntensity: 0.12,
      });
      // Body — cylinder instead of capsule (Workers compat)
      const body = new THREE.Mesh(new THREE.CylinderGeometry(0.38, 0.42, 1.1, 16), mat);
      body.position.y = 1.05;
      group.add(body);
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 24, 24),
        new THREE.MeshStandardMaterial({ color: 0xf2d9c0, roughness: 0.6 })
      );
      head.position.y = 1.95;
      group.add(head);
      const pauldronMat = new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), roughness: 0.3, metalness: 0.6 });
      [-0.5, 0.5].forEach(x => {
        const p = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), pauldronMat);
        p.position.set(x, 1.45, 0);
        group.add(p);
      });
      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.05, 8, 32),
        new THREE.MeshStandardMaterial({ color: new THREE.Color(accent), emissive: new THREE.Color(accent), emissiveIntensity: 0.6 })
      );
      belt.position.y = 0.85;
      belt.rotation.x = Math.PI / 2;
      group.add(belt);
      pivot.add(group);
      modelNode = group;
    };

    const loadModel = async () => {
      if (!modelUrl) { addFallback(); return; }
      if (modelCache.has(modelUrl)) { fitAndAdd(modelCache.get(modelUrl)!); return; }
      try {
        await new Promise<void>((resolve, reject) => {
          new GLTFLoader().load(modelUrl, (gltf) => {
            modelCache.set(modelUrl, gltf.scene);
            fitAndAdd(gltf.scene);
            resolve();
          }, undefined, reject);
        });
      } catch {
        try {
          const res = await fetch(modelUrl, { mode: "cors", cache: "force-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          await new Promise<void>((resolve, reject) => {
            new GLTFLoader().parse(buf, "", (gltf) => {
              modelCache.set(modelUrl, gltf.scene);
              fitAndAdd(gltf.scene);
              resolve();
            }, reject);
          });
        } catch (err) {
          console.warn("[CharacterPreview] fallback", err);
          addFallback();
        }
      }
    };

    loadModel();

    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const t = (performance.now() - start) / 1000;
      pivot.rotation.y = Math.sin(t * 0.8) * 0.18;
      if (modelNode) modelNode.position.y = Math.sin(t * 1.6) * 0.025;
      ring.rotation.z = t * 0.25;
      renderer.render(scene, camera);
    };
    tick();

    const ro = new ResizeObserver(() => {
      const { w: nw, h: nh } = getSize();
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

  return (
    <div ref={mountRef} className="h-full w-full transition-opacity duration-300" style={{ opacity: isActive ? 1 : 0.55 }} />
  );
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.15em] text-white/50">
        <span>{label}</span>
        <span className="font-bold" style={{ color }}>{value}</span>
      </div>
      <div className="h-[3px] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-700"
          style={{ width: `${value}%`, background: `linear-gradient(90deg, ${color}66, ${color})`, boxShadow: `0 0 8px ${color}99` }}
        />
      </div>
    </div>
  );
}

// Floating particle background
function Particles({ accent }: { accent: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;

    const particles = Array.from({ length: 38 }, () => ({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      r: Math.random() * 1.8 + 0.4,
      vx: (Math.random() - 0.5) * 0.3,
      vy: -Math.random() * 0.5 - 0.2,
      alpha: Math.random() * 0.5 + 0.1,
    }));

    let rafId = 0;
    const draw = () => {
      rafId = requestAnimationFrame(draw);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      for (const p of particles) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = accent + Math.floor(p.alpha * 255).toString(16).padStart(2, "0");
        ctx.fill();
        p.x += p.vx;
        p.y += p.vy;
        if (p.y < -10) { p.y = canvas.height + 10; p.x = Math.random() * canvas.width; }
        if (p.x < -10 || p.x > canvas.width + 10) p.x = Math.random() * canvas.width;
      }
    };
    draw();
    return () => cancelAnimationFrame(rafId);
  }, [accent]);

  return <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-0 opacity-60" />;
}

export function CharacterSelect({ onConfirm }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const char = CHARACTERS[activeIdx];

  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const prev = useCallback(() => setActiveIdx((i) => (i - 1 + CHARACTERS.length) % CHARACTERS.length), []);
  const next = useCallback(() => setActiveIdx((i) => (i + 1) % CHARACTERS.length), []);

  const trimmedName = playerName.trim();
  const canConfirm = trimmedName.length >= 2;

  const confirm = useCallback(() => {
    if (!canConfirm) return;
    onConfirm(char, trimmedName);
  }, [canConfirm, char, onConfirm, trimmedName]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft") prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Enter") confirm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [prev, next, confirm]);

  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => { touchStartX.current = e.touches[0].clientX; };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
    touchStartX.current = null;
  };

  const accent = char.accent;

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden text-white"
      style={{ background: "radial-gradient(ellipse at 50% -10%, #0e1128 0%, #06070e 60%, #030408 100%)", fontFamily: "'Segoe UI', system-ui, sans-serif" }}
    >
      {/* Grid */}
      <div aria-hidden className="pointer-events-none absolute inset-0 z-0"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
          backgroundSize: "56px 56px",
          maskImage: "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0.85), transparent 72%)",
        }}
      />

      {/* Particles */}
      <Particles accent={accent} />

      {/* Accent glow blob */}
      <div aria-hidden className="pointer-events-none absolute left-1/2 top-1/3 -translate-x-1/2 -translate-y-1/2 transition-all duration-700 z-0"
        style={{ width: 560, height: 560, borderRadius: "50%", background: accent, opacity: 0.07, filter: "blur(100px)" }}
      />

      {/* Header */}
      <header className="relative z-10 px-4 pt-5 text-center md:pt-7">
        <div className="text-[9px] uppercase tracking-[0.5em] text-white/30 mb-1">Chọn Nhân Vật</div>
        <h1 className="text-3xl font-black tracking-[0.08em] transition-all duration-500 md:text-5xl"
          style={{ textShadow: `0 0 60px ${accent}88, 0 2px 0 rgba(0,0,0,0.5)`, letterSpacing: "0.1em" }}
        >
          PUNCHAN ARENA
        </h1>
        {/* Decorative line */}
        <div className="mx-auto mt-3 flex items-center gap-3 justify-center">
          <div className="h-px flex-1 max-w-[80px] transition-colors duration-500" style={{ background: `linear-gradient(to right, transparent, ${accent}88)` }} />
          <div className="h-1.5 w-1.5 rounded-full transition-colors duration-500" style={{ background: accent, boxShadow: `0 0 8px ${accent}` }} />
          <div className="h-px flex-1 max-w-[80px] transition-colors duration-500" style={{ background: `linear-gradient(to left, transparent, ${accent}88)` }} />
        </div>
      </header>

      {/* Main */}
      <main
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-3 md:px-6"
        onTouchStart={isMobile ? onTouchStart : undefined}
        onTouchEnd={isMobile ? onTouchEnd : undefined}
      >
        {isMobile ? (
          <div className="flex w-full max-w-sm flex-col items-center gap-3">
            {/* Hero card */}
            <div className="relative w-full overflow-hidden rounded-3xl border transition-all duration-500"
              style={{
                aspectRatio: "3 / 4",
                borderColor: `${accent}66`,
                background: `radial-gradient(ellipse at 50% 110%, ${accent}28 0%, rgba(255,255,255,0.02) 65%)`,
                boxShadow: `0 0 60px ${accent}28, 0 0 0 1px ${accent}33`,
              }}
            >
              <CharacterPreview modelUrl={char.modelUrl} accent={accent} color={char.color} isActive />

              {/* Corner accents */}
              <div className="absolute top-3 left-3 w-5 h-5 border-t-2 border-l-2 rounded-tl-lg transition-colors duration-500" style={{ borderColor: accent }} />
              <div className="absolute top-3 right-3 w-5 h-5 border-t-2 border-r-2 rounded-tr-lg transition-colors duration-500" style={{ borderColor: accent }} />
              <div className="absolute bottom-3 left-3 w-5 h-5 border-b-2 border-l-2 rounded-bl-lg transition-colors duration-500" style={{ borderColor: accent }} />
              <div className="absolute bottom-3 right-3 w-5 h-5 border-b-2 border-r-2 rounded-br-lg transition-colors duration-500" style={{ borderColor: accent }} />

              {/* Name overlay */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black via-black/60 to-transparent px-4 pb-4 pt-12">
                <div className="text-[9px] uppercase tracking-[0.3em] mb-0.5 transition-colors duration-500" style={{ color: accent }}>{char.title}</div>
                <div className="text-2xl font-black tracking-wide">{char.name}</div>
              </div>

              {/* Arrows */}
              <button onClick={prev} aria-label="Trước"
                className="absolute left-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/50 text-2xl backdrop-blur-sm active:scale-90 transition-transform"
              >‹</button>
              <button onClick={next} aria-label="Sau"
                className="absolute right-3 top-1/2 grid h-11 w-11 -translate-y-1/2 place-items-center rounded-full border border-white/20 bg-black/50 text-2xl backdrop-blur-sm active:scale-90 transition-transform"
              >›</button>
            </div>

            {/* Dots */}
            <div className="flex items-center gap-2">
              {CHARACTERS.map((c, i) => (
                <button key={c.id} onClick={() => setActiveIdx(i)}
                  className="h-2 rounded-full transition-all duration-300"
                  style={{ width: i === activeIdx ? 24 : 8, background: i === activeIdx ? accent : "rgba(255,255,255,0.2)", boxShadow: i === activeIdx ? `0 0 8px ${accent}` : "none" }}
                />
              ))}
            </div>

            {/* Stats */}
            <div className="w-full rounded-2xl border p-4 transition-all duration-500"
              style={{ borderColor: `${accent}33`, background: `linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.01))`, backdropFilter: "blur(10px)" }}
            >
              <p className="mb-3 text-xs leading-relaxed text-white/60 line-clamp-2">{char.description}</p>
              <div className="grid grid-cols-2 gap-x-5">
                <StatBar label="HP" value={char.stats.hp} color={accent} />
                <StatBar label="ATK" value={char.stats.atk} color={accent} />
                <StatBar label="SPD" value={char.stats.spd} color={accent} />
                <StatBar label="DEF" value={char.stats.def} color={accent} />
              </div>
            </div>
          </div>
        ) : (
          /* Desktop */
          <div className="grid w-full items-stretch gap-4"
            style={{
              maxWidth: 1200, maxHeight: "70vh",
              gridTemplateColumns: CHARACTERS.map((_, i) => i === activeIdx ? "2fr" : "1fr").join(" "),
              transition: "grid-template-columns 0.4s cubic-bezier(.4,0,.2,1)",
            }}
          >
            {CHARACTERS.map((c, i) => {
              const isActive = i === activeIdx;
              return (
                <button key={c.id} onClick={() => setActiveIdx(i)}
                  className="relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300"
                  style={{
                    borderColor: isActive ? c.accent : "rgba(255,255,255,0.07)",
                    background: isActive ? `radial-gradient(ellipse at 50% 110%, ${c.accent}28 0%, rgba(255,255,255,0.03) 70%)` : "rgba(255,255,255,0.02)",
                    boxShadow: isActive ? `0 0 60px ${c.accent}28, inset 0 0 0 1px ${c.accent}44` : "none",
                    minHeight: 460,
                  }}
                >
                  {/* Corner accents for active */}
                  {isActive && <>
                    <div className="absolute top-3 left-3 w-4 h-4 border-t-2 border-l-2 rounded-tl" style={{ borderColor: c.accent }} />
                    <div className="absolute top-3 right-3 w-4 h-4 border-t-2 border-r-2 rounded-tr" style={{ borderColor: c.accent }} />
                  </>}

                  <div className="relative min-h-0 flex-1">
                    <CharacterPreview modelUrl={c.modelUrl} accent={c.accent} color={c.color} isActive={isActive} />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/95 via-black/50 to-transparent px-4 pb-3 pt-12">
                      <div className="text-[9px] uppercase tracking-[0.3em] mb-0.5" style={{ color: c.accent }}>{c.title}</div>
                      <div className="font-bold transition-all duration-300" style={{ fontSize: isActive ? 24 : 15 }}>{c.name}</div>
                    </div>
                  </div>

                  {isActive && (
                    <div className="border-t p-4" style={{ borderColor: `${c.accent}33` }}>
                      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-white/60">{c.description}</p>
                      <div className="grid grid-cols-2 gap-x-5">
                        <StatBar label="HP" value={c.stats.hp} color={c.accent} />
                        <StatBar label="ATK" value={c.stats.atk} color={c.accent} />
                        <StatBar label="SPD" value={c.stats.spd} color={c.accent} />
                        <StatBar label="DEF" value={c.stats.def} color={c.accent} />
                      </div>
                    </div>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </main>

      {/* Footer */}
      <footer className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-stretch gap-2 px-4 pb-6 pt-3">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <input
              type="text"
              maxLength={20}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder="Nhập tên người chơi..."
              className="h-12 w-full rounded-xl border bg-white/5 px-4 text-sm font-semibold outline-none transition-all placeholder:text-white/25"
              style={{
                borderColor: canConfirm ? `${accent}99` : "rgba(255,255,255,0.1)",
                boxShadow: canConfirm ? `0 0 0 2px ${accent}22, 0 0 20px ${accent}11` : "none",
                backdropFilter: "blur(10px)",
              }}
              onKeyDown={(e) => { if (e.key === "Enter") confirm(); }}
            />
          </div>

          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="h-12 shrink-0 rounded-xl px-6 text-sm font-extrabold uppercase tracking-[0.1em] text-black transition-all disabled:cursor-not-allowed disabled:opacity-30"
            style={{
              background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
              boxShadow: canConfirm ? `0 6px 30px ${accent}66` : "none",
              minWidth: 120,
            }}
          >
            ▶ {char.name}
          </button>
        </div>
        {!canConfirm && (
          <div className="text-center text-[10px] text-white/30 tracking-wider uppercase">
            Nhập tên tối thiểu 2 ký tự để bắt đầu
          </div>
        )}
      </footer>
    </div>
  );
}
