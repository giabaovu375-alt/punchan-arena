import { useEffect, useRef, useState } from "react";
import { GameEngine, type AnimKey, type AnimClipMap } from "@/game/GameEngine";
import { CharacterSelect } from "@/components/CharacterSelect";
import { CHARACTERS, type CharacterDef, type CharacterId } from "@/game/characters";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader";
import { FBXLoader } from "three/examples/jsm/loaders/FBXLoader";

type Stage = "preload" | "select" | "loading" | "playing";

const modelCache = new Map<string, THREE.Group>();
const clipCache  = new Map<string, THREE.AnimationClip>();

async function preloadAllAssets(onProgress: (pct: number, label: string) => void) {
  const gltfLoader = new GLTFLoader();
  const fbxLoader  = new FBXLoader();
  const animEntries = Object.entries(ANIM_MAP) as [AnimKey, string][];
  const total = CHARACTERS.length + animEntries.length;
  let done = 0;
  const tick = (label: string) => { done++; onProgress(Math.round(done/total*100), label); };

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

/**
 * Deep clone GLB model + rebind skeleton đúng cách.
 * THREE.Group.clone() không tự rebind SkinnedMesh → skeleton vẫn trỏ vào
 * source bones → AnimationMixer drive sai object → T-pose.
 */
function cloneModel(source: THREE.Group): THREE.Group {
  const clone = source.clone(true);

  // Thu thập bones theo thứ tự traversal (giữ nguyên index mapping)
  const sourceBones: THREE.Bone[] = [];
  const cloneBones:  THREE.Bone[] = [];
  source.traverse((n) => { if ((n as THREE.Bone).isBone) sourceBones.push(n as THREE.Bone); });
  clone.traverse((n)  => { if ((n as THREE.Bone).isBone) cloneBones.push(n as THREE.Bone);  });

  // Rebind từng SkinnedMesh với skeleton mới trỏ đúng vào clone bones
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

    const char        = CHARACTERS.find((c) => c.id === selectedId)!;
    const cachedModel = modelCache.get(char.modelUrl);

    // ✅ Dùng cloneModel thay vì .clone() trực tiếp
    const model = cachedModel ? cloneModel(cachedModel) : null;

    const clips: AnimClipMap = {};
    for (const key of Object.keys(ANIM_MAP) as AnimKey[]) {
      const clip = clipCache.get(key);
      if (clip) clips[key] = clip;
    }

    const engine = new GameEngine(ref.current, char, model, clips);
    return () => engine.dispose();
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

function PreloadScreen({ pct, label }: { pct: number; label: string }) {
  return (
    <div style={{
      position:"fixed", inset:0, background:"#060810",
      display:"flex", flexDirection:"column",
      alignItems:"center", justifyContent:"center",
      fontFamily:"'Segoe UI', sans-serif",
    }}>
      <div style={{ position:"absolute", inset:0, background:"radial-gradient(ellipse at 50% 50%, #0d1535 0%, #060810 70%)" }}/>
      <div style={{
        position:"absolute", inset:0,
        backgroundImage:`linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px)`,
        backgroundSize:"50px 50px",
      }}/>
      <div style={{ position:"relative", zIndex:2, textAlign:"center", marginBottom:56 }}>
        <div style={{ fontSize:11, letterSpacing:"0.4em", color:"rgba(255,255,255,0.25)", textTransform:"uppercase", marginBottom:12 }}>Đang khởi động</div>
        <div style={{ fontSize:"clamp(32px,6vw,56px)", fontWeight:900, letterSpacing:"0.08em", color:"#fff", textShadow:"0 0 60px rgba(100,140,255,0.4)", textTransform:"uppercase" }}>PLAY FRAME FORGE</div>
        <div style={{ marginTop:8, fontSize:12, color:"rgba(255,255,255,0.2)", letterSpacing:"0.2em", textTransform:"uppercase" }}>3D Action RPG</div>
      </div>
      <div style={{ position:"relative", zIndex:2, width:"min(400px,80vw)" }}>
        <div style={{ height:2, background:"rgba(255,255,255,0.06)", borderRadius:99, overflow:"hidden", marginBottom:16 }}>
          <div style={{ height:"100%", width:`${pct}%`, background:"linear-gradient(90deg,#4466ff,#88aaff)", borderRadius:99, transition:"width 0.3s ease", boxShadow:"0 0 12px rgba(100,140,255,0.6)" }}/>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <div style={{ fontSize:11, color:"rgba(255,255,255,0.3)", letterSpacing:"0.06em", maxWidth:"70%", overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{label}</div>
          <div style={{ fontSize:13, fontWeight:700, color:"#6688ff", fontVariantNumeric:"tabular-nums" }}>{pct}%</div>
        </div>
      </div>
      <div style={{ position:"relative", zIndex:2, marginTop:48, display:"flex", gap:6 }}>
        {[0,1,2].map(i=>(
          <div key={i} style={{ width:4, height:4, borderRadius:"50%", background:"#4466ff", opacity:0.4, animation:`dotpulse 1.2s ease-in-out ${i*0.2}s infinite` }}/>
        ))}
      </div>
      <style>{`@keyframes dotpulse{0%,100%{opacity:.2;transform:scale(1)}50%{opacity:1;transform:scale(1.5)}}`}</style>
    </div>
  );
}

function LoadingScreen({ accent, name, title }: { accent: string; name: string; title: string }) {
  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-black">
      <div className="absolute inset-0 opacity-40" style={{ background:`radial-gradient(circle at 50% 50%,${accent}55,transparent 60%)` }}/>
      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-white/10"/>
      <div className="relative z-10 text-center">
        <div className="text-xs uppercase tracking-[0.5em] text-white/40">Đang triệu hồi</div>
        <div className="mt-4 font-serif text-6xl font-bold tracking-tight text-white" style={{ textShadow:`0 0 30px ${accent}` }}>{name}</div>
        <div className="mt-2 text-sm uppercase tracking-[0.4em]" style={{ color:accent }}>{title}</div>
        <div className="mx-auto mt-10 h-px w-64 overflow-hidden bg-white/10">
          <div className="h-full animate-[loadbar_1.2s_ease-in-out_forwards]" style={{ background:accent, width:"0%" }}/>
        </div>
      </div>
      <style>{`@keyframes loadbar{from{width:0%}to{width:100%}}`}</style>
    </div>
  );
}

function Hud({ character, onExit }: { character: CharacterDef; onExit: () => void }) {
  return (
    <>
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-3">
        <div className="flex h-14 w-14 items-center justify-center rounded-full border-2 text-xl font-bold text-white shadow-lg"
          style={{ borderColor:character.accent, backgroundColor:`${character.accent}33` }}>
          {character.name[0]}
        </div>
        <div>
          <div className="text-xs uppercase tracking-[0.3em] text-white/60">{character.title}</div>
          <div className="font-serif text-lg font-semibold text-white">{character.name}</div>
          <div className="mt-1 h-1.5 w-44 overflow-hidden rounded-full bg-white/10">
            <div className="h-full rounded-full" style={{ width:"100%", background:character.accent }}/>
          </div>
        </div>
      </div>
      <button onClick={onExit} className="absolute right-4 top-4 rounded-md border border-white/20 bg-black/40 px-3 py-1.5 text-xs uppercase tracking-[0.3em] text-white/80 backdrop-blur transition hover:bg-white/10">
        Đổi nhân vật
      </button>
      <div className="pointer-events-none absolute bottom-4 left-4 rounded-lg border border-white/10 bg-black/50 px-4 py-3 text-xs text-white/80 backdrop-blur">
        <div className="mb-1 text-[10px] uppercase tracking-[0.3em] text-white/40">Điều khiển</div>
        <div className="grid grid-cols-2 gap-x-6 gap-y-1">
          <span><kbd className="kbd">WASD</kbd> Di chuyển</span>
          <span><kbd className="kbd">Shift</kbd> Chạy</span>
          <span><kbd className="kbd">Space</kbd> Nhảy</span>
          <span><kbd className="kbd">Z/X/C/V</kbd> Đánh</span>
          <span><kbd className="kbd">Chuột</kbd> Xoay cam</span>
        </div>
      </div>
      <div className="absolute bottom-4 right-4 h-32 w-32 rounded-lg border border-white/15 bg-black/40 backdrop-blur">
        <div className="absolute inset-2 rounded-md border border-white/10"/>
        <div className="absolute left-1/2 top-1/2 h-2 w-2 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background:character.accent, boxShadow:`0 0 12px ${character.accent}` }}/>
        <div className="absolute bottom-1 right-2 text-[9px] uppercase tracking-widest text-white/40">Minimap</div>
      </div>
      <style>{`.kbd{display:inline-block;min-width:1.3em;padding:0 .35em;margin-right:.25em;border-radius:.25rem;background:rgba(255,255,255,.1);border:1px solid rgba(255,255,255,.2);font-family:ui-monospace,monospace;font-size:.7rem}`}</style>
    </>
  );
}
