/// <reference lib="webworker" />
declare const self: ServiceWorkerGlobalScope;

const CACHE_NAME = "punchan-assets-v1";

// ── Các file cache ngay khi SW install (precache) ──────────────────────────
const PRECACHE_URLS: string[] = [
  "/animation/Idle.fbx",
  "/animation/Walking.fbx",
  "/animation/Running.fbx",
  "/animation/Jumping.fbx",
  "/animation/Hook Punch.fbx",
  "/animation/Kicking.fbx",
  "/animation/Uppercut Jab.fbx",
  "/animation/Drop Kick.fbx",
  "/animation/Mma Kick.fbx",
  "/animation/Elbow Uppercut Combo.fbx",
  "/animation/Side Kick.fbx",
  "/animation/Pain Gesture.fbx",
  "/animation/Crouch Death.fbx",
  "/animation/Getting Up.fbx",
  "/animation/Breakdance Ending 3.fbx",
  "/animation/Breakdance Freezes.fbx",
  "/animation/Sitting.fbx",
  "/animation/Sitting Idle.fbx",
];

// ── Install: precache animation (nhẹ, local) ───────────────────────────────
self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) =>
      cache.addAll(PRECACHE_URLS)
    ).then(() => self.skipWaiting())
  );
});

// ── Activate: xoá cache cũ ─────────────────────────────────────────────────
self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// ── Fetch: Cache First cho assets, Network First cho app shell ─────────────
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);

  // Chỉ handle GET
  if (e.request.method !== "GET") return;

  // App shell (HTML, JS, CSS) → Network First
  const isAppShell = url.pathname.match(/\.(html|js|jsx|ts|tsx|css)$/) ||
                     url.pathname === "/" ||
                     !url.pathname.includes(".");
  if (isAppShell) {
    e.respondWith(networkFirst(e.request));
    return;
  }

  // Model, animation, texture → Cache First
  const isAsset = url.pathname.match(/\.(glb|gltf|fbx|bin|png|jpg|jpeg|webp|ktx2|basis)$/i) ||
                  url.hostname.includes("hf-proxy"); // Cloudflare Worker proxy
  if (isAsset) {
    e.respondWith(cacheFirst(e.request));
    return;
  }
});

// ─────────────────────────────────────────────────────────────────────────────
// Strategies
// ─────────────────────────────────────────────────────────────────────────────

/** Cache First: trả cache ngay, nếu miss thì fetch rồi lưu */
async function cacheFirst(request: Request): Promise<Response> {
  const cache  = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);
  if (cached) return cached;

  try {
    const response = await fetch(request);
    if (response.ok) {
      // Clone trước khi put vì body chỉ đọc được 1 lần
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    return new Response("Asset không tải được và chưa có trong cache.", { status: 503 });
  }
}

/** Network First: thử mạng trước, fallback về cache nếu offline */
async function networkFirst(request: Request): Promise<Response> {
  const cache = await caches.open(CACHE_NAME);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    const cached = await cache.match(request);
    return cached ?? new Response("Offline và chưa có cache.", { status: 503 });
  }
}
