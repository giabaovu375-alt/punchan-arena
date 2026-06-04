import { useState, useEffect, useRef, useCallback } from "react";
import { CHARACTERS, type CharacterDef } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";

interface Props {
  onConfirm: (char: CharacterDef, playerName: string) => void;
}

const modelCache = new Map<string, THREE.Group>();

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

function CharacterPreview({ modelUrl, accent, color, active }: {
  modelUrl?: string; accent: string; color: number; active: boolean;
}) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;
    const w = el.clientWidth || 260, h = el.clientHeight || 360;

    const scene  = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(36, w / h, 0.1, 100);
    camera.position.set(0, 1.5, 3.8);
    camera.lookAt(0, 1.1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    scene.add(new THREE.AmbientLight(0xffffff, 0.5));
    const key = new THREE.DirectionalLight(0xffffff, 1.8);
    key.position.set(2, 5, 4); scene.add(key);
    const rim = new THREE.DirectionalLight(new THREE.Color(accent), 2.0);
    rim.position.set(-3, 2, -3); scene.add(rim);
    const btm = new THREE.DirectionalLight(new THREE.Color(accent), 0.4);
    btm.position.set(0, -2, 2); scene.add(btm);

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
            new GLTFLoader().load(modelUrl, gltf => {
              modelCache.set(modelUrl, gltf.scene as THREE.Group);
              res();
            }, undefined, rej);
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
      } catch { addFallback(); }
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
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  return <div ref={mountRef} className="h-full w-full" />;
}

function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className="mb-2">
      <div className="mb-1 flex justify-between" style={{ fontSize: 9, textTransform: "uppercase", letterSpacing: "0.18em", color: "rgba(255,255,255,0.4)" }}>
        <span>{label}</span>
        <span style={{ color, fontWeight: 900 }}>{value}</span>
      </div>
      <div style={{ height: 2, borderRadius: 999, background: "rgba(255,255,255,0.1)", overflow: "hidden" }}>
        <div style={{
          height: "100%", borderRadius: 999,
          width: `${value}%`,
          background: `linear-gradient(90deg, ${color}55, ${color})`,
          boxShadow: `0 0 6px ${color}`,
          transition: "width 0.7s ease",
        }} />
      </div>
    </div>
  );
}

export function CharacterSelect({ onConfirm }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const [playerName, setPlayerName] = useState("");
  // Detect landscape on mobile
  const [isLandscape, setIsLandscape] = useState(
    () => window.innerWidth > window.innerHeight
  );

  useEffect(() => {
    const update = () => setIsLandscape(window.innerWidth > window.innerHeight);
    window.addEventListener("resize", update);
    window.addEventListener("orientationchange", update);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("orientationchange", update);
    };
  }, []);

  const char   = CHARACTERS[activeIdx];
  const accent = char.accent;
  const isDesktop = window.innerWidth >= 768;

  const prev = useCallback(() => setActiveIdx(i => (i - 1 + CHARACTERS.length) % CHARACTERS.length), []);
  const next = useCallback(() => setActiveIdx(i => (i + 1) % CHARACTERS.length), []);

  const trimmed    = playerName.trim();
  const canConfirm = trimmed.length >= 2;

  const confirm = useCallback(() => {
    if (canConfirm) onConfirm(char, trimmed);
  }, [canConfirm, char, onConfirm, trimmed]);

  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      if (e.key === "ArrowLeft")       prev();
      else if (e.key === "ArrowRight") next();
      else if (e.key === "Enter")      confirm();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [prev, next, confirm]);

  const touchX = useRef<number | null>(null);

  // ── PORTRAIT mobile — yêu cầu xoay ─────────────────────────────────────────
  if (!isDesktop && !isLandscape) {
    return (
      <div style={{
        position: "fixed", inset: 0, background: "#05060e",
        display: "flex", flexDirection: "column",
        alignItems: "center", justifyContent: "center", gap: 16,
        color: "white", fontFamily: "sans-serif", textAlign: "center", padding: 24,
      }}>
        <div style={{ fontSize: 48 }}>📱↔️</div>
        <div style={{ fontSize: 18, fontWeight: 700 }}>Xoay ngang màn hình</div>
        <div style={{ fontSize: 13, color: "rgba(255,255,255,0.4)", lineHeight: 1.6 }}>
          Game yêu cầu chế độ ngang<br />để hiển thị đúng
        </div>
      </div>
    );
  }

  // ── DESKTOP layout ──────────────────────────────────────────────────────────
  if (isDesktop) {
    return (
      <div style={{
        position: "fixed", inset: 0, display: "flex", flexDirection: "column",
        overflow: "hidden", color: "white", userSelect: "none",
        background: "radial-gradient(ellipse at 50% 0%, #0d1230 0%, #05060e 55%, #020308 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}>
        {/* Grid bg */}
        <div aria-hidden style={{
          pointerEvents: "none", position: "absolute", inset: 0, zIndex: 0, opacity: 0.4,
          backgroundImage: "linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px), linear-gradient(90deg,rgba(255,255,255,0.03) 1px,transparent 1px)",
          backgroundSize: "48px 48px",
          maskImage: "radial-gradient(ellipse at 50% 30%, black 10%, transparent 70%)",
        }} />
        <div aria-hidden style={{
          pointerEvents: "none", position: "absolute", left: "50%", top: "50%",
          transform: "translate(-50%,-50%)", zIndex: 0,
          width: 600, height: 600, borderRadius: "50%",
          background: accent, opacity: 0.06, filter: "blur(120px)",
          transition: "background 0.5s",
        }} />

        {/* Header */}
        <header style={{ flexShrink: 0, padding: "24px 24px 0", textAlign: "center", position: "relative", zIndex: 1 }}>
          <div style={{ fontSize: 9, letterSpacing: "0.5em", color: "rgba(255,255,255,0.25)", textTransform: "uppercase", marginBottom: 4 }}>Chọn nhân vật</div>
          <h1 style={{ fontSize: 36, fontWeight: 900, letterSpacing: "0.12em", textTransform: "uppercase", textShadow: `0 0 60px ${accent}66`, margin: 0 }}>
            PUNCHAN ARENA
          </h1>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: 12, marginTop: 8 }}>
            <div style={{ height: 1, width: 80, background: `linear-gradient(to right, transparent, ${accent}66)`, transition: "background 0.5s" }} />
            <div style={{ height: 6, width: 6, borderRadius: "50%", background: accent, boxShadow: `0 0 8px ${accent}`, transition: "background 0.5s" }} />
            <div style={{ height: 1, width: 80, background: `linear-gradient(to left, transparent, ${accent}66)`, transition: "background 0.5s" }} />
          </div>
        </header>

        {/* Cards */}
        <main style={{
          flex: 1, display: "flex", alignItems: "stretch", justifyContent: "center",
          gap: 16, padding: "16px 24px", minHeight: 0, position: "relative", zIndex: 1,
          maxHeight: "calc(100vh - 160px)",
        }}>
          {CHARACTERS.map((c, i) => {
            const active = i === activeIdx;
            return (
              <button key={c.id} onClick={() => setActiveIdx(i)} style={{
                flex: active ? "2 1 0" : "1 1 0",
                transition: "flex 0.4s cubic-bezier(.4,0,.2,1), border-color 0.3s, box-shadow 0.3s",
                borderRadius: 16, border: `1px solid ${active ? c.accent : "rgba(255,255,255,0.06)"}`,
                background: active
                  ? `radial-gradient(ellipse at 50% 100%, ${c.accent}22 0%, rgba(255,255,255,0.02) 65%)`
                  : "rgba(255,255,255,0.02)",
                boxShadow: active ? `0 0 50px ${c.accent}22, inset 0 0 0 1px ${c.accent}33` : "none",
                cursor: "pointer", display: "flex", flexDirection: "column",
                overflow: "hidden", textAlign: "left", position: "relative",
              }}>
                {active && <>
                  <div style={{ position: "absolute", top: 10, left: 10, width: 16, height: 16, borderTop: `2px solid ${c.accent}`, borderLeft: `2px solid ${c.accent}`, zIndex: 10 }} />
                  <div style={{ position: "absolute", top: 10, right: 10, width: 16, height: 16, borderTop: `2px solid ${c.accent}`, borderRight: `2px solid ${c.accent}`, zIndex: 10 }} />
                </>}
                <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                  <CharacterPreview modelUrl={c.modelUrl} accent={c.accent} color={c.color} active={active} />
                  <div style={{
                    pointerEvents: "none", position: "absolute", inset: "auto 0 0 0",
                    background: "linear-gradient(to top, rgba(0,0,0,0.95), rgba(0,0,0,0.4), transparent)",
                    padding: "40px 16px 12px",
                  }}>
                    <div style={{ fontSize: 8, letterSpacing: "0.3em", textTransform: "uppercase", color: c.accent, marginBottom: 2 }}>{c.title}</div>
                    <div style={{ fontWeight: 900, fontSize: active ? 22 : 14, transition: "font-size 0.3s", color: "white" }}>{c.name}</div>
                  </div>
                </div>
                {active && (
                  <div style={{ flexShrink: 0, borderTop: `1px solid ${c.accent}25`, padding: "12px 16px" }}>
                    <p style={{ fontSize: 10, color: "rgba(255,255,255,0.5)", lineHeight: 1.6, marginBottom: 8, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 1, WebkitBoxOrient: "vertical" }}>{c.description}</p>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 20 }}>
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
        <footer style={{ flexShrink: 0, padding: "0 24px 24px", display: "flex", flexDirection: "column", gap: 8, maxWidth: 520, margin: "0 auto", width: "100%", position: "relative", zIndex: 1 }}>
          <div style={{ display: "flex", gap: 8 }}>
            <input
              type="text" maxLength={20} value={playerName}
              onChange={e => setPlayerName(e.target.value)}
              onKeyDown={e => e.key === "Enter" && confirm()}
              placeholder="Nhập tên người chơi..."
              style={{
                flex: 1, height: 48, borderRadius: 12, padding: "0 16px",
                background: "rgba(255,255,255,0.05)", fontSize: 14, fontWeight: 600,
                color: "white", outline: "none",
                border: `1px solid ${canConfirm ? accent + "99" : "rgba(255,255,255,0.1)"}`,
                boxShadow: canConfirm ? `0 0 0 2px ${accent}22` : "none",
                transition: "border-color 0.3s, box-shadow 0.3s",
              }}
            />
            <button onClick={confirm} disabled={!canConfirm} style={{
              height: 48, minWidth: 130, borderRadius: 12, padding: "0 24px",
              background: `linear-gradient(135deg, ${accent}, ${accent}cc)`,
              boxShadow: canConfirm ? `0 6px 28px ${accent}55` : "none",
              border: "none", cursor: canConfirm ? "pointer" : "not-allowed",
              color: "black", fontWeight: 900, fontSize: 14,
              letterSpacing: "0.1em", textTransform: "uppercase",
              opacity: canConfirm ? 1 : 0.25, transition: "all 0.3s",
            }}>▶ {char.name}</button>
          </div>
          {!canConfirm && (
            <div style={{ textAlign: "center", fontSize: 10, color: "rgba(255,255,255,0.25)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
              Nhập tên tối thiểu 2 ký tự để bắt đầu
            </div>
          )}
        </footer>
      </div>
    );
  }

  // ── MOBILE LANDSCAPE layout ─────────────────────────────────────────────────
  return (
    <div
      style={{
        position: "fixed", inset: 0, display: "flex", overflow: "hidden",
        color: "white", userSelect: "none",
        background: "radial-gradient(ellipse at 50% 0%, #0d1230 0%, #05060e 55%, #020308 100%)",
        fontFamily: "'Segoe UI', system-ui, sans-serif",
      }}
      onTouchStart={e => { touchX.current = e.touches[0].clientX; }}
      onTouchEnd={e => {
        if (touchX.current == null) return;
        const dx = e.changedTouches[0].clientX - touchX.current;
        if (Math.abs(dx) > 40) dx < 0 ? next() : prev();
        touchX.current = null;
      }}
    >
      {/* Accent glow */}
      <div aria-hidden style={{
        pointerEvents: "none", position: "absolute", left: "50%", top: "50%",
        transform: "translate(-50%,-50%)", zIndex: 0,
        width: 400, height: 400, borderRadius: "50%",
        background: accent, opacity: 0.07, filter: "blur(80px)", transition: "background 0.5s",
      }} />

      {/* LEFT — 3D model */}
      <div style={{ position: "relative", flexShrink: 0, width: "40%", zIndex: 1 }}>
        <CharacterPreview modelUrl={char.modelUrl} accent={accent} color={char.color} active={true} />

        {/* Corner brackets */}
        {[
          { top: 8, left: 8, borderTop: `2px solid ${accent}`, borderLeft: `2px solid ${accent}` },
          { top: 8, right: 8, borderTop: `2px solid ${accent}`, borderRight: `2px solid ${accent}` },
          { bottom: 8, left: 8, borderBottom: `2px solid ${accent}`, borderLeft: `2px solid ${accent}` },
          { bottom: 8, right: 8, borderBottom: `2px solid ${accent}`, borderRight: `2px solid ${accent}` },
        ].map((s, i) => (
          <div key={i} style={{ position: "absolute", width: 16, height: 16, transition: "border-color 0.5s", ...s }} />
        ))}

        {/* Nav arrows */}
        <button onClick={prev} style={{
          position: "absolute", left: 4, top: "50%", transform: "translateY(-50%)",
          width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.6)", color: "white", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>‹</button>
        <button onClick={next} style={{
          position: "absolute", right: 4, top: "50%", transform: "translateY(-50%)",
          width: 36, height: 36, borderRadius: "50%", border: "1px solid rgba(255,255,255,0.15)",
          background: "rgba(0,0,0,0.6)", color: "white", fontSize: 20, cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}>›</button>

        {/* Dots */}
        <div style={{ position: "absolute", bottom: 8, left: "50%", transform: "translateX(-50%)", display: "flex", gap: 6 }}>
          {CHARACTERS.map((_, i) => (
            <button key={i} onClick={() => setActiveIdx(i)} style={{
              height: 6, borderRadius: 999, border: "none", cursor: "pointer", padding: 0,
              width: i === activeIdx ? 18 : 6,
              background: i === activeIdx ? accent : "rgba(255,255,255,0.2)",
              transition: "all 0.3s",
            }} />
          ))}
        </div>
      </div>

      {/* RIGHT — info */}
      <div style={{
        flex: 1, display: "flex", flexDirection: "column", justifyContent: "space-between",
        padding: "12px 16px 12px 8px", overflow: "hidden", position: "relative", zIndex: 1,
      }}>
        {/* Top: name + desc */}
        <div>
          <div style={{ fontSize: 8, letterSpacing: "0.5em", color: "rgba(255,255,255,0.3)", textTransform: "uppercase", marginBottom: 2 }}>Chọn nhân vật</div>
          <div style={{ fontSize: 10, letterSpacing: "0.3em", textTransform: "uppercase", color: accent, marginBottom: 4, transition: "color 0.5s" }}>{char.title}</div>
          <div style={{ fontSize: 22, fontWeight: 900, letterSpacing: "0.05em", lineHeight: 1, marginBottom: 6, textShadow: `0 0 30px ${accent}88` }}>{char.name}</div>
          <p style={{ fontSize: 10, lineHeight: 1.6, color: "rgba(255,255,255,0.5)", marginBottom: 0, overflow: "hidden", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical" }}>{char.description}</p>
        </div>

        {/* Stats */}
        <div style={{
          borderRadius: 12, border: `1px solid ${accent}25`, padding: "10px 12px",
          background: "rgba(255,255,255,0.03)", transition: "border-color 0.5s",
        }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", columnGap: 16 }}>
            <StatBar label="HP"  value={char.stats.hp}  color={accent} />
            <StatBar label="ATK" value={char.stats.atk} color={accent} />
            <StatBar label="SPD" value={char.stats.spd} color={accent} />
            <StatBar label="DEF" value={char.stats.def} color={accent} />
          </div>
        </div>

        {/* Input + confirm */}
        <div style={{ display: "flex", gap: 8 }}>
          <input
            type="text" maxLength={20} value={playerName}
            onChange={e => setPlayerName(e.target.value)}
            onKeyDown={e => e.key === "Enter" && confirm()}
            placeholder="Tên người chơi..."
            style={{
              flex: 1, height: 40, borderRadius: 10, padding: "0 12px",
              background: "rgba(255,255,255,0.05)", fontSize: 12, fontWeight: 600,
              color: "white", outline: "none",
              border: `1px solid ${canConfirm ? accent + "88" : "rgba(255,255,255,0.1)"}`,
              transition: "border-color 0.3s", minWidth: 0,
            }}
          />
          <button onClick={confirm} disabled={!canConfirm} style={{
            height: 40, minWidth: 80, borderRadius: 10, padding: "0 16px",
            background: `linear-gradient(135deg, ${accent}, ${accent}bb)`,
            boxShadow: canConfirm ? `0 4px 20px ${accent}55` : "none",
            border: "none", cursor: canConfirm ? "pointer" : "not-allowed",
            color: "black", fontWeight: 900, fontSize: 12,
            letterSpacing: "0.05em", textTransform: "uppercase",
            opacity: canConfirm ? 1 : 0.25, transition: "all 0.3s",
            flexShrink: 0,
          }}>▶ GO</button>
        </div>

        {!canConfirm && (
          <div style={{ fontSize: 9, color: "rgba(255,255,255,0.25)", letterSpacing: "0.05em", textTransform: "uppercase", textAlign: "center", marginTop: -4 }}>
            Nhập tối thiểu 2 ký tự
          </div>
        )}
      </div>
    </div>
  );
}
