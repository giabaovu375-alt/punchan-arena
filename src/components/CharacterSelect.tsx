import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { CHARACTERS, type CharacterDef } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  onConfirm: (char: CharacterDef, playerName: string) => void;
}

// Cache loaded models per-url to avoid re-fetching
const modelCache = new Map<string, THREE.Object3D>();

/* -------------------------------------------------------------------------- */
/*  3D Character Preview — model faces the camera (user) with idle sway       */
/* -------------------------------------------------------------------------- */
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

    const getSize = () => ({
      w: el.clientWidth || 280,
      h: el.clientHeight || 380,
    });
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

    // Lighting — cinematic 3-point
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

    // Ground glow disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.15, 64),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.22,
      }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.001;
    scene.add(disc);

    // Subtle radial floor ring (outline)
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(1.15, 1.22, 64),
      new THREE.MeshBasicMaterial({
        color: new THREE.Color(accent),
        transparent: true,
        opacity: 0.45,
        side: THREE.DoubleSide,
      }),
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.002;
    scene.add(ring);

    // Pivot — used for idle sway. Model lives inside.
    const pivot = new THREE.Group();
    scene.add(pivot);

    let modelNode: THREE.Object3D | null = null;
    let cancelled = false;

    const fitAndAdd = (source: THREE.Object3D) => {
      if (cancelled) return;
      const clone = source.clone(true);
      // Normalize to ~2 units tall
      const box = new THREE.Box3().setFromObject(clone);
      const size = box.getSize(new THREE.Vector3());
      if (size.y <= 0.0001) {
        addFallback();
        return;
      }
      const scale = 2 / size.y;
      clone.scale.setScalar(scale);
      clone.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(clone);
      clone.position.y = -box2.min.y;
      // Face the camera (front of model -> +Z toward camera)
      clone.rotation.y = Math.PI;
      pivot.add(clone);
      modelNode = clone;
    };

    const addFallback = () => {
      if (cancelled) return;
      const group = new THREE.Group();

      const mat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(color),
        roughness: 0.45,
        metalness: 0.35,
        emissive: new THREE.Color(accent),
        emissiveIntensity: 0.12,
      });

      // Body (capsule)
      const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.42, 0.85, 6, 16), mat);
      body.position.y = 1.05;
      group.add(body);

      // Head
      const head = new THREE.Mesh(
        new THREE.SphereGeometry(0.32, 24, 24),
        new THREE.MeshStandardMaterial({
          color: 0xf2d9c0,
          roughness: 0.6,
        }),
      );
      head.position.y = 1.95;
      group.add(head);

      // Shoulders / pauldrons
      const pauldronGeo = new THREE.SphereGeometry(0.22, 16, 12);
      const pauldronMat = new THREE.MeshStandardMaterial({
        color: new THREE.Color(accent),
        roughness: 0.3,
        metalness: 0.6,
      });
      const lp = new THREE.Mesh(pauldronGeo, pauldronMat);
      lp.position.set(-0.5, 1.45, 0);
      group.add(lp);
      const rp = new THREE.Mesh(pauldronGeo, pauldronMat);
      rp.position.set(0.5, 1.45, 0);
      group.add(rp);

      // Belt accent
      const belt = new THREE.Mesh(
        new THREE.TorusGeometry(0.42, 0.05, 8, 32),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(accent),
          emissive: new THREE.Color(accent),
          emissiveIntensity: 0.6,
        }),
      );
      belt.position.y = 0.85;
      belt.rotation.x = Math.PI / 2;
      group.add(belt);

      // Face plate (small visor so it looks "facing user")
      const visor = new THREE.Mesh(
        new THREE.BoxGeometry(0.36, 0.08, 0.02),
        new THREE.MeshStandardMaterial({
          color: new THREE.Color(accent),
          emissive: new THREE.Color(accent),
          emissiveIntensity: 0.9,
        }),
      );
      visor.position.set(0, 1.96, 0.3);
      group.add(visor);

      pivot.add(group);
      modelNode = group;
    };

    const loadModel = async () => {
      if (!modelUrl) {
        addFallback();
        return;
      }
      if (modelCache.has(modelUrl)) {
        fitAndAdd(modelCache.get(modelUrl)!);
        return;
      }
      try {
        await new Promise<void>((resolve, reject) => {
          new GLTFLoader().load(
            modelUrl,
            (gltf) => {
              modelCache.set(modelUrl, gltf.scene);
              fitAndAdd(gltf.scene);
              resolve();
            },
            undefined,
            reject,
          );
        });
      } catch {
        try {
          const res = await fetch(modelUrl, { mode: "cors", cache: "force-cache" });
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const buf = await res.arrayBuffer();
          await new Promise<void>((resolve, reject) => {
            new GLTFLoader().parse(
              buf,
              "",
              (gltf) => {
                modelCache.set(modelUrl, gltf.scene);
                fitAndAdd(gltf.scene);
                resolve();
              },
              (err) => reject(err),
            );
          });
        } catch (err) {
          console.warn("[CharacterPreview] model load failed, using fallback", err);
          addFallback();
        }
      }
    };

    loadModel();

    // Idle animation — gentle sway + breathing. Model stays facing camera.
    let rafId = 0;
    const start = performance.now();
    const tick = () => {
      rafId = requestAnimationFrame(tick);
      const t = (performance.now() - start) / 1000;
      // small yaw sway ±10°
      pivot.rotation.y = Math.sin(t * 0.8) * 0.18;
      // breathing
      if (modelNode) {
        modelNode.position.y = Math.sin(t * 1.6) * 0.025;
      }
      ring.rotation.z = t * 0.25;
      renderer.render(scene, camera);
    };
    tick();

    // Resize observer
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
      if (renderer.domElement.parentElement === el) {
        el.removeChild(renderer.domElement);
      }
    };
  }, [modelUrl, accent, color]);

  return (
    <div
      ref={mountRef}
      className="h-full w-full transition-opacity duration-300"
      style={{ opacity: isActive ? 1 : 0.55 }}
    />
  );
}

/* -------------------------------------------------------------------------- */
/*  Stat bar                                                                  */
/* -------------------------------------------------------------------------- */
function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between text-[10px] uppercase tracking-[0.15em] text-white/50">
        <span>{label}</span>
        <span className="font-bold" style={{ color }}>
          {value}
        </span>
      </div>
      <div className="h-1 overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${value}%`,
            background: `linear-gradient(90deg, ${color}88, ${color})`,
            boxShadow: `0 0 10px ${color}88`,
          }}
        />
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  CharacterSelect                                                           */
/* -------------------------------------------------------------------------- */
export function CharacterSelect({ onConfirm }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [playerName, setPlayerName] = useState("");
  const char = CHARACTERS[activeIdx];

  // detect mobile (responsive layout switch)
  const [isMobile, setIsMobile] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 767px)");
    const onChange = () => setIsMobile(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  const prev = useCallback(
    () => setActiveIdx((i) => (i - 1 + CHARACTERS.length) % CHARACTERS.length),
    [],
  );
  const next = useCallback(
    () => setActiveIdx((i) => (i + 1) % CHARACTERS.length),
    [],
  );

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

  // Touch swipe on mobile
  const touchStartX = useRef<number | null>(null);
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (touchStartX.current == null) return;
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    if (Math.abs(dx) > 40) (dx < 0 ? next : prev)();
    touchStartX.current = null;
  };

  const accent = char.accent;

  const bgStyle = useMemo<React.CSSProperties>(
    () => ({
      background:
        "radial-gradient(ellipse at 50% -10%, #11142a 0%, #07080f 55%, #04050a 100%)",
    }),
    [],
  );

  return (
    <div
      className="fixed inset-0 flex flex-col overflow-hidden font-sans text-white"
      style={bgStyle}
    >
      {/* Background grid */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          backgroundImage: `linear-gradient(rgba(255,255,255,0.04) 1px, transparent 1px),
                            linear-gradient(90deg, rgba(255,255,255,0.04) 1px, transparent 1px)`,
          backgroundSize: "64px 64px",
          maskImage:
            "radial-gradient(ellipse at 50% 40%, rgba(0,0,0,0.9), transparent 75%)",
        }}
      />

      {/* Accent glow */}
      <div
        aria-hidden
        className="pointer-events-none absolute left-1/2 top-[28%] -translate-x-1/2 transition-colors duration-500"
        style={{
          width: 480,
          height: 480,
          borderRadius: "50%",
          background: accent,
          opacity: 0.08,
          filter: "blur(90px)",
        }}
      />

      {/* Header */}
      <header className="relative z-10 px-4 pt-4 text-center md:pt-6">
        <div className="text-[10px] uppercase tracking-[0.4em] text-white/40">
          Chọn Nhân Vật
        </div>
        <h1
          className="mt-1 font-serif text-2xl font-black tracking-[0.06em] transition-[text-shadow] duration-500 md:text-4xl"
          style={{ textShadow: `0 0 40px ${accent}55` }}
        >
          AETHER REALMS
        </h1>
      </header>

      {/* Main area */}
      <main
        className="relative z-10 flex flex-1 flex-col items-center justify-center px-3 md:px-6"
        onTouchStart={isMobile ? onTouchStart : undefined}
        onTouchEnd={isMobile ? onTouchEnd : undefined}
      >
        {isMobile ? (
          /* -------- MOBILE LAYOUT -------- */
          <div className="flex w-full max-w-md flex-col items-center">
            {/* Hero preview */}
            <div
              className="relative w-full overflow-hidden rounded-2xl border"
              style={{
                aspectRatio: "3 / 4",
                borderColor: `${accent}55`,
                background: `radial-gradient(ellipse at 50% 100%, ${accent}22 0%, rgba(255,255,255,0.02) 100%)`,
                boxShadow: `0 0 50px ${accent}33, inset 0 0 0 1px ${accent}33`,
              }}
            >
              <CharacterPreview
                modelUrl={char.modelUrl}
                accent={accent}
                color={char.color}
                isActive
              />

              {/* Name overlay */}
              <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-3 pt-10">
                <div className="text-[10px] uppercase tracking-[0.25em]" style={{ color: accent }}>
                  {char.title}
                </div>
                <div className="font-serif text-2xl font-bold">{char.name}</div>
              </div>

              {/* Arrows */}
              <button
                onClick={prev}
                aria-label="Trước"
                className="absolute left-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/40 text-xl backdrop-blur active:scale-95"
              >
                ‹
              </button>
              <button
                onClick={next}
                aria-label="Sau"
                className="absolute right-2 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full border border-white/15 bg-black/40 text-xl backdrop-blur active:scale-95"
              >
                ›
              </button>
            </div>

            {/* Dots */}
            <div className="mt-3 flex items-center gap-2">
              {CHARACTERS.map((c, i) => (
                <button
                  key={c.id}
                  aria-label={c.name}
                  onClick={() => setActiveIdx(i)}
                  className="h-2 rounded-full transition-all"
                  style={{
                    width: i === activeIdx ? 22 : 8,
                    background: i === activeIdx ? accent : "rgba(255,255,255,0.18)",
                  }}
                />
              ))}
            </div>

            {/* Description + stats */}
            <div
              className="mt-4 w-full rounded-xl border p-4"
              style={{ borderColor: `${accent}33`, background: "rgba(255,255,255,0.025)" }}
            >
              <p className="mb-3 text-xs leading-relaxed text-white/70">{char.description}</p>
              <div className="grid grid-cols-2 gap-x-4">
                <StatBar label="HP" value={char.stats.hp} color={accent} />
                <StatBar label="ATK" value={char.stats.atk} color={accent} />
                <StatBar label="SPD" value={char.stats.spd} color={accent} />
                <StatBar label="DEF" value={char.stats.def} color={accent} />
              </div>
            </div>
          </div>
        ) : (
          /* -------- DESKTOP LAYOUT -------- */
          <div
            className="grid w-full items-stretch gap-4"
            style={{
              maxWidth: 1200,
              maxHeight: "70vh",
              gridTemplateColumns: CHARACTERS.map((_, i) =>
                i === activeIdx ? "1.9fr" : "1fr",
              ).join(" "),
              transition: "grid-template-columns 0.4s cubic-bezier(.4,0,.2,1)",
            }}
          >
            {CHARACTERS.map((c, i) => {
              const isActive = i === activeIdx;
              return (
                <button
                  key={c.id}
                  onClick={() => setActiveIdx(i)}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border text-left transition-all duration-300"
                  style={{
                    borderColor: isActive ? c.accent : "rgba(255,255,255,0.08)",
                    background: isActive
                      ? `radial-gradient(ellipse at 50% 100%, ${c.accent}22 0%, rgba(255,255,255,0.03) 100%)`
                      : "rgba(255,255,255,0.025)",
                    boxShadow: isActive
                      ? `0 0 50px ${c.accent}33, inset 0 0 0 1px ${c.accent}55`
                      : "none",
                    minHeight: 460,
                  }}
                >
                  <div className="relative min-h-0 flex-1">
                    <CharacterPreview
                      modelUrl={c.modelUrl}
                      accent={c.accent}
                      color={c.color}
                      isActive={isActive}
                    />
                    <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/40 to-transparent px-4 pb-3 pt-10">
                      <div
                        className="text-[10px] uppercase tracking-[0.25em]"
                        style={{ color: c.accent }}
                      >
                        {c.title}
                      </div>
                      <div
                        className="font-serif font-bold transition-all duration-300"
                        style={{ fontSize: isActive ? 26 : 16 }}
                      >
                        {c.name}
                      </div>
                    </div>
                  </div>

                  {isActive && (
                    <div
                      className="border-t p-4"
                      style={{ borderColor: `${c.accent}33` }}
                    >
                      <p className="mb-3 line-clamp-2 text-xs leading-relaxed text-white/65">
                        {c.description}
                      </p>
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

      {/* Footer — name input + CTA */}
      <footer className="relative z-10 mx-auto flex w-full max-w-xl flex-col items-stretch gap-3 px-4 pb-5 pt-3 md:pb-7">
        <div className="flex items-center gap-2">
          <div className="relative flex-1">
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[10px] uppercase tracking-[0.25em] text-white/35">
              Tên người chơi
            </span>
            <input
              type="text"
              maxLength={20}
              value={playerName}
              onChange={(e) => setPlayerName(e.target.value)}
              placeholder=" "
              className="h-12 w-full rounded-xl border bg-white/5 px-3 pt-4 text-sm font-semibold outline-none transition placeholder:text-white/30 focus:bg-white/[0.07]"
              style={{
                borderColor: canConfirm ? `${accent}88` : "rgba(255,255,255,0.1)",
                boxShadow: canConfirm ? `0 0 0 2px ${accent}22` : "none",
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") confirm();
              }}
            />
          </div>

          <button
            onClick={confirm}
            disabled={!canConfirm}
            className="h-12 shrink-0 rounded-xl px-5 text-sm font-extrabold uppercase tracking-[0.12em] text-black transition-all disabled:cursor-not-allowed disabled:opacity-40 md:px-8"
            style={{
              background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
              boxShadow: canConfirm ? `0 8px 30px ${accent}66` : "none",
            }}
          >
            <span className="hidden md:inline">▶ Vào game với </span>
            <span>{char.name}</span>
          </button>
        </div>
        {!canConfirm && (
          <div className="text-center text-[11px] text-white/40">
            Nhập tên (tối thiểu 2 ký tự) để bắt đầu
          </div>
        )}
      </footer>
    </div>
  );
}
