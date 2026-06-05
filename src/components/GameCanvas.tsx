import { useEffect, useRef, useState } from "react";
import { GameEngine, type AnimKey, type AnimClipMap } from "@/game/GameEngine";
import { CharacterSelect } from "@/components/CharacterSelect";
import { CHARACTERS, type CharacterDef, type CharacterId } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";

type Stage = "preload" | "select" | "loading" | "playing";

const ANIM_MAP: Record<AnimKey, string> = {
  idle:             "/animation/Idle.fbx",
  walk:             "/animation/Walking.fbx",
  run:              "/animation/Running.fbx",
  jump:             "/animation/Jumping.fbx",
  punch:            "/animation/Hook Punch.fbx",
  kick:             "/animation/Kicking.fbx",
  uppercut:         "/animation/Uppercut Jab.fbx",
  dropKick:         "/animation/Drop Kick.fbx",
  mmaKick:          "/animation/Mma Kick.fbx",
  elbow:            "/animation/Elbow Uppercut Combo.fbx",
  sideKick:         "/animation/Side Kick.fbx",
  pain:             "/animation/Pain Gesture.fbx",
  death:            "/animation/Crouch Death.fbx",
  gettingUp:        "/animation/Getting Up.fbx",
  breakdanceEnd:    "/animation/Breakdance Ending 3.fbx",
  breakdanceFreeze: "/animation/Breakdance Freezes.fbx",
  sitting:          "/animation/Sitting.fbx",
  sittingIdle:      "/animation/Sitting Idle.fbx",
};

const modelCache = new Map<string, THREE.Group>();
const clipCache  = new Map<string, THREE.AnimationClip>();

async function preloadAllAssets(onProgress: (pct: number, label: string) => void) {
  const gltfLoader  = new GLTFLoader();
  const fbxLoader   = new FBXLoader();
  const animEntries = Object.entries(ANIM_MAP) as [AnimKey, string][];
  const total = CHARACTERS.length + animEntries.length;
  let done = 0;
  const tick = (label: string) => { done++; onProgress(Math.round(done / total * 100), label); };

  await Promise.all(CHARACTERS.map((c) =>
    new Promise<void>((res) => {
      if (modelCache.has(c.modelUrl)) { tick(c.name); res(); return; }
      gltfLoader.load(c.modelUrl,
        (gltf) => { modelCache.set(c.modelUrl, gltf.scene as THREE.Group); tick(c.name); res(); },
        undefined,
        () => { tick(c.name + " (lỗi)"); res(); },
      );
    })
  ));

  await Promise.all(animEntries.map(([key, path]) =>
    new Promise<void>((res) => {
      if (clipCache.has(key)) { tick(key); res(); return; }
      fbxLoader.load(path,
        (fbx) => {
          if (fbx.animations[0]) {
            const clip = fbx.animations[0];
            clip.name = key;
            clipCache.set(key, clip);
          }
          tick(key); res();
        },
        undefined,
        () => { tick(key + " (lỗi)"); res(); },
      );
    })
  ));
}

function cloneModel(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);
  const sourceBones: THREE.Bone[] = [];
  const cloneBones:  THREE.Bone[] = [];
  source.traverse((n) => { if ((n as THREE.Bone).isBone) sourceBones.push(n as THREE.Bone); });
  clone.traverse((n)  => { if ((n as THREE.Bone).isBone) cloneBones.push(n as THREE.Bone); });
  clone.traverse((n) => {
    if (!(n as THREE.SkinnedMesh).isSkinnedMesh) return;
    const mesh    = n as THREE.SkinnedMesh;
    const oldSkel = mesh.skeleton;
    const newBones = oldSkel.bones.map((b) => {
      const i = sourceBones.indexOf(b);
      return i !== -1 ? cloneBones[i] : b;
    });
    mesh.bind(new THREE.Skeleton(newBones, oldSkel.boneInverses), mesh.matrixWorld);
  });
  return clone;
}

// ─────────────────────────────────────────────────────────────────────────────
export function GameCanvas() {
  const [stage, setStage]               = useState<Stage>("preload");
  const [selectedId, setSelectedId]     = useState<CharacterId | null>(null);
  const [preloadPct, setPreloadPct]     = useState(0);
  const [preloadLabel, setPreloadLabel] = useState("Đang khởi động...");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    preloadAllAssets((pct, label) => {
      setPreloadPct(pct);
      setPreloadLabel(label);
    }).then(() => setStage("select"));
  }, []);

  useEffect(() => {
    if (stage !== "playing" || !ref.current || !selectedId) return;
    let isCancelled = false;
    let engine: GameEngine | null = null;
    const initEngine = async () => {
      const char        = CHARACTERS.find((c) => c.id === selectedId)!;
      const cachedModel = modelCache.get(char.modelUrl);
      const model       = cachedModel ? cloneModel(cachedModel) : null;
      const clips: AnimClipMap = {};
      for (const key of Object.keys(ANIM_MAP) as AnimKey[]) {
        const clip = clipCache.get(key);
        if (clip) clips[key] = clip;
      }
      const instance = await GameEngine.create(ref.current!, char, model, clips);
      if (isCancelled) { instance.dispose(); } else { engine = instance; }
    };
    initEngine().catch((err) => console.error("Lỗi khởi tạo Engine:", err));
    return () => { isCancelled = true; engine?.dispose(); };
  }, [stage, selectedId]);

  const handleSelect = (c: CharacterDef) => {
    setSelectedId(c.id);
    setStage("loading");
    setTimeout(() => setStage("playing"), 1200);
  };

  if (stage === "preload") return <PreloadScreen pct={preloadPct} label={preloadLabel} />;
  if (stage === "select")  return <CharacterSelect onConfirm={handleSelect} />;
  if (stage === "loading") {
    const c = CHARACTERS.find((x) => x.id === selectedId)!;
    return <LoadingScreen accent={c.accent} name={c.name} title={c.title} />;
  }

  const c = CHARACTERS.find((x) => x.id === selectedId)!;
  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
      <div ref={ref} className="h-full w-full" />
      <Hud character={c} onExit={() => setStage("select")} />
    </div>
  );
}

// ── PRELOAD ───────────────────────────────────────────────────────────────────
function PreloadScreen({ pct, label }: { pct: number; label: string }) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center",
      fontFamily: "'Segoe UI', sans-serif",
      color: "white",
    }}>
      <img
        src="/assets/ui/loading-bg.png"
        alt="Loading"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover", zIndex: 0 }}
      />
      <div style={{
        position: "absolute", inset: 0, zIndex: 1,
        background: "linear-gradient(to bottom, rgba(0,0,0,0.2), rgba(0,0,0,0.65))",
      }} />

      {/* Title */}
      <div style={{ position: "relative", zIndex: 2, textAlign: "center", marginBottom: 52 }}>
        <div style={{ fontSize: 10, letterSpacing: "0.45em", color: "rgba(255,255,255,0.55)", textTransform: "uppercase", marginBottom: 14 }}>
          Hệ thống đang nạp cấu trúc
        </div>
        <div style={{
          fontSize: "clamp(30px,5.5vw,52px)", fontWeight: 900,
          letterSpacing: "0.08em", color: "#fff",
          textShadow: "0 4px 24px rgba(0,0,0,0.9)", textTransform: "uppercase",
        }}>
          PUNCHAN — ARENA
        </div>
        <div style={{ marginTop: 6, fontSize: 11, color: "rgba(255,255,255,0.45)", letterSpacing: "0.22em", textTransform: "uppercase" }}>
          3D Action RPG
        </div>
      </div>

      {/* Progress */}
      <div style={{ position: "relative", zIndex: 2, width: "min(380px,78vw)" }}>
        <div style={{ height: 3, background: "rgba(255,255,255,0.12)", borderRadius: 99, overflow: "hidden", marginBottom: 14 }}>
          <div style={{
            height: "100%", width: `${pct}%`,
            background: "linear-gradient(90deg,#00f5d4,#00a8ff)",
            borderRadius: 99, transition: "width 0.2s ease",
          }} />
        </div>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{
            fontSize: 10, color: "rgba(255,255,255,0.55)", letterSpacing: "0.06em",
            maxWidth: "72%", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
          }}>{label}</div>
          <div style={{ fontSize: 12, fontWeight: 700, color: "#00f5d4", fontVariantNumeric: "tabular-nums" }}>{pct}%</div>
        </div>
      </div>

      {/* Dots */}
      <div style={{ position: "relative", zIndex: 2, marginTop: 44, display: "flex", gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{
            width: 5, height: 5, borderRadius: "50%", background: "#00f5d4",
            animation: `dotpulse 1.2s ease-in-out ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
      <style>{`@keyframes dotpulse{0%,100%{opacity:.2;transform:scale(1)}50%{opacity:1;transform:scale(1.5)}}`}</style>
    </div>
  );
}

// ── LOADING CHARACTER ─────────────────────────────────────────────────────────
function LoadingScreen({ accent, name, title }: { accent: string; name: string; title: string }) {
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      <div className="absolute inset-0 opacity-40"
        style={{ background: `radial-gradient(circle at 50% 50%,${accent}55,transparent 60%)` }} />
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10" />
      <div className="relative z-10 text-center">
        <div className="text-xs uppercase tracking-[0.5em] text-white/40">Đang triệu hồi</div>
        <div className="mt-4 font-serif text-6xl font-bold tracking-tight text-white"
          style={{ textShadow: `0 0 30px ${accent}` }}>{name}</div>
        <div className="mt-2 text-sm uppercase tracking-[0.4em]" style={{ color: accent }}>{title}</div>
        <div className="mx-auto mt-10 h-px w-64 overflow-hidden bg-white/10">
          <div className="h-full animate-[loadbar_1.2s_ease-in-out_forwards]"
            style={{ background: accent, width: "0%" }} />
        </div>
      </div>
      <style>{`@keyframes loadbar{from{width:0%}to{width:100%}}`}</style>
    </div>
  );
}

// ── HUD – gọn, sạch, không rác ───────────────────────────────────────────────
function Hud({ character, onExit }: { character: CharacterDef; onExit: () => void }) {
  return (
    <>
      {/* ── Góc trên-trái: Avatar + tên + thanh HP/Stamina ── */}
      <div className="pointer-events-none absolute left-3 top-3"
        style={{ display: "flex", alignItems: "flex-start", gap: 10 }}>

        {/* Avatar tròn */}
        <div style={{
          width: 48, height: 48, flexShrink: 0,
          borderRadius: "50%",
          border: `2px solid ${character.accent}`,
          background: `${character.accent}22`,
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, fontWeight: 800, color: "#fff",
          boxShadow: `0 0 18px ${character.accent}55`,
          backdropFilter: "blur(8px)",
        }}>
          {character.name[0]}
        </div>

        {/* Info panel */}
        <div style={{
          background: "rgba(0,0,0,0.52)",
          border: "1px solid rgba(255,255,255,0.1)",
          borderRadius: 10,
          backdropFilter: "blur(14px)",
          padding: "8px 14px 10px",
          minWidth: 170,
        }}>
          {/* Name + class */}
          <div style={{ display: "flex", alignItems: "baseline", gap: 7, marginBottom: 7 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: "#fff", letterSpacing: "0.02em" }}>
              {character.name}
            </span>
            <span style={{ fontSize: 9, color: character.accent, letterSpacing: "0.18em", textTransform: "uppercase", fontWeight: 600 }}>
              LV.1 · {character.title}
            </span>
          </div>

          {/* HP bar */}
          <div style={{ marginBottom: 5 }}>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>HP</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>100 / 100</span>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "100%", borderRadius: 99, background: "linear-gradient(90deg,#f87171,#fb923c)" }} />
            </div>
          </div>

          {/* Stamina bar */}
          <div>
            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3 }}>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.45)", letterSpacing: "0.12em" }}>STAMINA</span>
              <span style={{ fontSize: 9, color: "rgba(255,255,255,0.55)", fontVariantNumeric: "tabular-nums" }}>100</span>
            </div>
            <div style={{ height: 5, background: "rgba(255,255,255,0.1)", borderRadius: 99, overflow: "hidden" }}>
              <div style={{ height: "100%", width: "100%", borderRadius: 99, background: "linear-gradient(90deg,#34d399,#06b6d4)" }} />
            </div>
          </div>
        </div>
      </div>

      {/* ── Góc trên-phải: nút đổi nhân vật gọn ── */}
      <button
        onClick={onExit}
        style={{
          position: "absolute", top: 12, right: 12,
          padding: "7px 16px",
          fontSize: 10, letterSpacing: "0.2em", textTransform: "uppercase",
          color: "rgba(255,255,255,0.75)",
          background: "rgba(0,0,0,0.45)",
          border: "1px solid rgba(255,255,255,0.18)",
          borderRadius: 8,
          backdropFilter: "blur(12px)",
          cursor: "pointer",
          transition: "background 0.15s",
        }}
        onMouseEnter={(e) => (e.currentTarget.style.background = "rgba(255,255,255,0.1)")}
        onMouseLeave={(e) => (e.currentTarget.style.background = "rgba(0,0,0,0.45)")}
      >
        Đổi nhân vật
      </button>
    </>
  );
      }
            
