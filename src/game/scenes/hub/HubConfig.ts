import * as THREE from 'three';

export const HUB_SPAWN = new THREE.Vector3(0, 0, 30);
export const MODEL_BASE = '/model-tree'; // Thư mục thực tế trong public

export const PORTAL_DEFS = [
  { targetScene: 'MainRoadScene', pos: new THREE.Vector3(0, 0, -30), color: 0xff6600, label: 'Đường Chính' },
  { targetScene: 'LeftForestScene', pos: new THREE.Vector3(-40, 0, 0), color: 0xcc44cc, label: 'Rừng Mật' },
  { targetScene: 'RightPlatformScene', pos: new THREE.Vector3(40, 0, 0), color: 0x44aacc, label: 'Khu Đá' },
  { targetScene: 'BossScene', pos: new THREE.Vector3(0, 0, 50), color: 0xff3333, label: 'Boss Arena' },
];

// Danh sách model dùng cho từng loại cây / bụi
export const OUTER_TREES = ['CommonTree_1', 'CommonTree_2', 'CommonTree_3', 'Pine_1', 'Pine_2'];
export const MID_TREES = ['DeadTree_1', 'DeadTree_2', 'CommonTree_1'];
export const GROUND_ITEMS = ['Bush_Common', 'Fern_1', 'Mushroom_Laetiporus', 'Plant_1', 'Rock_Medium_1', 'Rock_Medium_2'];

// Tên các model cần load
export const ALL_MODEL_NAMES = [
  'TwistedTree_1', 'TwistedTree_2', 'TwistedTree_3', 'TwistedTree_5',
  ...OUTER_TREES,
  ...MID_TREES,
  ...GROUND_ITEMS,
  'Grass_Common_Short', 'Grass_Common_Tall', 'Grass_Wispy_Short', 'Grass_Wispy_Tall',
  'Clover_1', 'Clover_2', 'Petal_1', 'Petal_2',
  'Pebble_Round_1', 'Pebble_Round_2', 'Pebble_Round_3',
  'Pebble_Square_1', 'Pebble_Square_2',
  'Flower_3_Group', 'Flower_4_Group',
  'Plant_7',
  'Mushroom_Common'
];
