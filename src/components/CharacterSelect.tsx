import { useState, useEffect, useRef } from "react";
import { CHARACTERS, type CharacterDef, type CharacterId } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";

interface Props {
  onSelect: (char: CharacterDef) => void;
}

// Mini 3D preview per character
function CharacterPreview({ modelUrl, accent }: { modelUrl: string; accent: string }) {
  const mountRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = mountRef.current;
    if (!el) return;

    const w = el.clientWidth  || 280;
    const h = el.clientHeight || 380;

    const scene    = new THREE.Scene();
    const camera   = new THREE.PerspectiveCamera(42, w / h, 0.1, 100);
    camera.position.set(0, 1.2, 4.5);
    camera.lookAt(0, 1, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping      = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.appendChild(renderer.domElement);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 1.0));
    const key = new THREE.DirectionalLight(0xffffff, 1.6);
    key.position.set(3, 6, 4);
    scene.add(key);
    const rim = new THREE.DirectionalLight(accent, 0.8);
    rim.position.set(-3, 2, -3);
    scene.add(rim);

    // Ground glow disc
    const disc = new THREE.Mesh(
      new THREE.CircleGeometry(1.2, 48),
      new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.18 })
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.01;
    scene.add(disc);

    let model: THREE.Object3D | null = null;
    let animId = 0;
    let yaw = 0;

    new GLTFLoader().load(modelUrl, gltf => {
      model = gltf.scene;
      // Scale to ~2 units tall
      const box = new THREE.Box3().setFromObject(model);
      const h   = box.getSize(new THREE.Vector3()).y;
      model.scale.setScalar(2 / h);
      model.updateMatrixWorld(true);
      const box2 = new THREE.Box3().setFromObject(model);
      model.position.y = -box2.min.y;
      scene.add(model);
    }, undefined, () => {
      // fallback capsule
      const fb = new THREE.Mesh(
        new THREE.CapsuleGeometry(0.4, 1.2, 4, 12),
        new THREE.MeshStandardMaterial({ color: accent })
      );
      fb.position.y = 1;
      scene.add(fb);
      model = fb;
    });

    const tick = () => {
      animId = requestAnimationFrame(tick);
      yaw += 0.006;
      if (model) model.rotation.y = yaw;
      renderer.render(scene, camera);
    };
    tick();

    return () => {
      cancelAnimationFrame(animId);
      renderer.dispose();
      if (renderer.domElement.parentElement === el) el.removeChild(renderer.domElement);
    };
  }, [modelUrl, accent]);

  return <div ref={mountRef} style={{ width: "100%", height: "100%" }} />;
}

// Stat bar
function StatBar({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "#aaa", marginBottom: 3 }}>
        <span style={{ letterSpacing: "0.08em", textTransform: "uppercase" }}>{label}</span>
        <span style={{ color, fontWeight: 700 }}>{value}</span>
      </div>
      <div style={{ height: 4, background: "rgba(255,255,255,0.08)", borderRadius: 99, overflow: "hidden" }}>
        <div style={{
          height: "100%", width: `${value}%`,
          background: `linear-gradient(90deg, ${color}88, ${color})`,
          borderRadius: 99,
          transition: "width 0.6s cubic-bezier(.4,0,.2,1)",
          boxShadow: `0 0 8px ${color}66`
        }} />
      </div>
    </div>
  );
}

export function CharacterSelect({ onSelect }: Props) {
  const [activeIdx, setActiveIdx] = useState(0);
  const char = CHARACTERS[activeIdx];

  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "radial-gradient(ellipse at 50% 0%, #0d1020 0%, #060810 100%)",
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif",
      overflow: "hidden",
    }}>
      {/* Background grid */}
      <div style={{
        position: "absolute", inset: 0, zIndex: 0,
        backgroundImage: `linear-gradient(rgba(255,255,255,0.03) 1px, transparent 1px),
                          linear-gradient(90deg, rgba(255,255,255,0.03) 1px, transparent 1px)`,
        backgroundSize: "60px 60px",
      }} />

      {/* Title */}
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", marginBottom: 32 }}>
        <div style={{ fontSize: 11, letterSpacing: "0.3em", color: "#555", textTransform: "uppercase", marginBottom: 6 }}>
          Chọn Nhân Vật
        </div>
        <div style={{
          fontSize: "clamp(28px, 5vw, 48px)",
          fontWeight: 900,
          letterSpacing: "0.05em",
          color: "#fff",
          textShadow: `0 0 40px ${char.accent}66`,
          transition: "text-shadow 0.4s",
        }}>
          PLAY FRAME FORGE
        </div>
      </div>

      {/* Main content */}
      <div style={{
        position: "relative", zIndex: 2,
        display: "flex", gap: "clamp(12px, 3vw, 32px)",
        alignItems: "stretch",
        width: "min(1100px, 96vw)",
        maxHeight: "70vh",
      }}>

        {/* Character cards */}
        {CHARACTERS.map((c, i) => {
          const isActive = i === activeIdx;
          return (
            <div
              key={c.id}
              onClick={() => setActiveIdx(i)}
              style={{
                flex: isActive ? "1.8" : "1",
                minWidth: 0,
                borderRadius: 20,
                border: `1.5px solid ${isActive ? c.accent : "rgba(255,255,255,0.07)"}`,
                background: isActive
                  ? `radial-gradient(ellipse at 50% 100%, ${c.accent}18 0%, rgba(255,255,255,0.04) 100%)`
                  : "rgba(255,255,255,0.03)",
                cursor: "pointer",
                transition: "all 0.35s cubic-bezier(.4,0,.2,1)",
                display: "flex", flexDirection: "column",
                overflow: "hidden",
                boxShadow: isActive ? `0 0 40px ${c.accent}22, inset 0 0 0 0.5px ${c.accent}44` : "none",
              }}
            >
              {/* 3D preview */}
              <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
                <CharacterPreview modelUrl={c.modelUrl} accent={c.accent} />
                {/* Name overlay */}
                <div style={{
                  position: "absolute", bottom: 0, left: 0, right: 0,
                  padding: "32px 16px 12px",
                  background: "linear-gradient(transparent, rgba(0,0,0,0.8))",
                }}>
                  <div style={{ fontSize: isActive ? 22 : 14, fontWeight: 800, color: "#fff", transition: "font-size 0.3s" }}>
                    {c.name}
                  </div>
                  <div style={{ fontSize: 11, color: c.accent, letterSpacing: "0.06em", textTransform: "uppercase" }}>
                    {c.title}
                  </div>
                </div>
              </div>

              {/* Stats panel — only active */}
              {isActive && (
                <div style={{ padding: "16px 20px 20px", borderTop: `1px solid ${c.accent}22` }}>
                  <p style={{ fontSize: 12, color: "#888", lineHeight: 1.6, marginBottom: 14 }}>
                    {c.description}
                  </p>
                  <StatBar label="HP"  value={c.stats.hp}  color={c.accent} />
                  <StatBar label="ATK" value={c.stats.atk} color={c.accent} />
                  <StatBar label="SPD" value={c.stats.spd} color={c.accent} />
                  <StatBar label="DEF" value={c.stats.def} color={c.accent} />
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Bottom nav */}
      <div style={{
        position: "relative", zIndex: 2,
        marginTop: 28,
        display: "flex", gap: 14, alignItems: "center",
      }}>
        {/* Dot indicators */}
        {CHARACTERS.map((c, i) => (
          <div
            key={c.id}
            onClick={() => setActiveIdx(i)}
            style={{
              width: i === activeIdx ? 24 : 8,
              height: 8,
              borderRadius: 99,
              background: i === activeIdx ? char.accent : "rgba(255,255,255,0.15)",
              cursor: "pointer",
              transition: "all 0.3s",
            }}
          />
        ))}
      </div>

      {/* CTA */}
      <button
        onClick={() => onSelect(char)}
        style={{
          position: "relative", zIndex: 2,
          marginTop: 20,
          padding: "14px 48px",
          borderRadius: 12,
          border: "none", cursor: "pointer",
          fontSize: 15, fontWeight: 800,
          letterSpacing: "0.08em",
          textTransform: "uppercase",
          fontFamily: "'Segoe UI', sans-serif",
          background: `linear-gradient(135deg, ${char.accent}, ${char.accent}aa)`,
          color: "#000",
          boxShadow: `0 6px 32px ${char.accent}55`,
          transition: "all 0.2s",
        }}
        onMouseEnter={e => { (e.target as HTMLElement).style.transform = "translateY(-2px)"; (e.target as HTMLElement).style.filter = "brightness(1.1)"; }}
        onMouseLeave={e => { (e.target as HTMLElement).style.transform = "none"; (e.target as HTMLElement).style.filter = "none"; }}
      >
        ▶ CHỌN {char.name.toUpperCase()}
      </button>
    </div>
  );
}
