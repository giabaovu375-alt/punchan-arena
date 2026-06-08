import * as THREE from "three";

export const HUB_SPAWN = new THREE.Vector3(0, 0, 30);

// ── Base paths ──────────────────────────────────────────────
export const MODEL_BASE = "/model-tree";
export const PROP_BASE = "/model";

// ── Tree / nature assets (.gltf) ────────────────────────────
export const ALL_MODEL_NAMES = [
  "TwistedTree_1", "TwistedTree_2", "TwistedTree_3", "TwistedTree_5",
  "CommonTree_1", "CommonTree_2", "CommonTree_3", "CommonTree_4", "CommonTree_5",
  "Pine_1", "Pine_2", "Pine_3",
  "DeadTree_1", "DeadTree_2", "DeadTree_3",
  "Bush_Common", "Bush_Common_Flowers", "Fern_1",
  "Mushroom_Common", "Mushroom_Laetiporus",
  "Plant_1", "Plant_7",
  "Rock_Medium_1", "Rock_Medium_2", "Rock_Medium_3",
  "Grass_Common_Short", "Grass_Common_Tall", "Grass_Wispy_Short", "Grass_Wispy_Tall",
  "Clover_1", "Clover_2", "Petal_1", "Petal_2",
  "Pebble_Round_1", "Pebble_Round_2", "Pebble_Round_3",
  "Pebble_Square_1", "Pebble_Square_2",
  "Flower_3_Group", "Flower_4_Group",
];

// ── Prop assets — tên khớp CHÍNH XÁC với file trên GitHub ──
export interface ModelAsset {
  name: string;
  path: string;
}

export const ALL_PROP_ASSETS: ModelAsset[] = [
  { name: "Big-stone",                   path: `${PROP_BASE}/Big-stone.glb` },
  { name: "bo_ba_nam",                   path: `${PROP_BASE}/bo_ba_nam.glb` },
  { name: "bush",                        path: `${PROP_BASE}/bush.glb` },
  { name: "crystal_cluster",             path: `${PROP_BASE}/crystal_cluster.glb` },
  { name: "crystal_hong",                path: `${PROP_BASE}/crystal_hong.glb` },
  { name: "golem",                       path: `${PROP_BASE}/golem.fbx` },
  { name: "low_poly_lamp_post",          path: `${PROP_BASE}/low_poly_lamp_post.glb` },
  { name: "old_ropebridge_low_poly",     path: `${PROP_BASE}/old_ropebridge_low_poly.glb` },
  { name: "pile_of_skulls",              path: `${PROP_BASE}/pile_of_skulls.glb` },
  { name: "stone_pillar",                path: `${PROP_BASE}/stone_pillar.glb` },
  { name: "stylized_fence",              path: `${PROP_BASE}/stylized_fence.glb` },
  { name: "stylized_medieval_house",     path: `${PROP_BASE}/stylized_medieval_house.glb` },
  { name: "stylized_medieval_house_2",   path: `${PROP_BASE}/stylized_medieval_house_2.glb` },
  { name: "stylized_wooden_wagon",       path: `${PROP_BASE}/stylized_wooden_wagon.glb` },
];

// ── Nhóm cho logic rải map ───────────────────────────────────
export const OUTER_TREES = ["CommonTree_1", "CommonTree_2", "CommonTree_3", "Pine_1", "Pine_2"];
export const MID_TREES   = ["DeadTree_1", "DeadTree_2", "CommonTree_1"];
export const GROUND_ITEMS = ["Bush_Common", "Fern_1", "Mushroom_Laetiporus", "Plant_1", "Rock_Medium_1", "Rock_Medium_2"];

// ── Portals ──────────────────────────────────────────────────
export interface PortalDef {
  targetScene: string;
  pos: THREE.Vector3;
  color: number;
  label: string;
}

export const PORTAL_DEFS: PortalDef[] = [
  { targetScene: "MainRoadScene",      pos: new THREE.Vector3(0,   0, -30), color: 0xff6600, label: "Đường Chính" },
  { targetScene: "LeftForestScene",    pos: new THREE.Vector3(-40, 0,   0), color: 0xcc44cc, label: "Rừng Mật"    },
  { targetScene: "RightPlatformScene", pos: new THREE.Vector3(40,  0,   0), color: 0x44aacc, label: "Khu Đá"      },
  { targetScene: "BossScene",          pos: new THREE.Vector3(0,   0,  50), color: 0xff3333, label: "Boss Arena"  },
];
