import * as THREE from "three";

export class CameraController {
  private camera: THREE.PerspectiveCamera;
  private target: THREE.Object3D;
  private targetHeight: number;

  // Góc quay & khoảng cách
  private cameraYaw = 0;
  private targetYaw = 0;
  private cameraPitch = -0.18;
  private targetPitch = -0.18;
  private cameraDistance = 3.8;
  private targetDistance = 3.8;

  // Giới hạn
  private readonly DIST_MIN = 2.0;
  private readonly DIST_MAX = 10.0;
  private readonly PITCH_MIN = -1.2;
  private readonly PITCH_MAX = 0.3;

  // Pinch zoom
  private pinchStartDist = 0;
  private pinchStartCamDist = 0;

  // Reusable vectors
  private _camOff = new THREE.Vector3();
  private _tgt = new THREE.Vector3();
  private _camTarget = new THREE.Vector3();

  constructor(camera: THREE.PerspectiveCamera, target: THREE.Object3D, targetHeight: number) {
    this.camera = camera;
    this.target = target;
    this.targetHeight = targetHeight;
  }

  /** Gọi mỗi frame */
  update(dt: number) {
    const lk = 1 - Math.exp(-12 * dt);
    this.cameraYaw = this.lerpAngle(this.cameraYaw, this.targetYaw, lk);
    this.cameraPitch += (this.targetPitch - this.cameraPitch) * lk;
    this.cameraDistance += (this.targetDistance - this.cameraDistance) * lk;

    const camOff = this._camOff.set(
      Math.sin(this.cameraYaw) * Math.cos(this.cameraPitch),
      -Math.sin(this.cameraPitch),
      Math.cos(this.cameraYaw) * Math.cos(this.cameraPitch),
    ).multiplyScalar(this.cameraDistance);

    const tgt = this._tgt.copy(this.target.position);
    tgt.y += this.targetHeight;
    this._camTarget.copy(tgt).add(camOff);

    this.camera.position.lerp(this._camTarget, lk * 1.8);
    this.camera.lookAt(tgt);
  }

  // ── Input từ bên ngoài ──────────────────────────────────────────────
  rotate(dYaw: number, dPitch: number) {
    this.targetYaw += dYaw;
    this.targetPitch += dPitch;
    this.targetPitch = Math.max(this.PITCH_MIN, Math.min(this.PITCH_MAX, this.targetPitch));
  }

  zoom(delta: number) {
    this.targetDistance = Math.max(this.DIST_MIN, Math.min(this.DIST_MAX, this.targetDistance + delta));
  }

  // Pinch-to-zoom
  onTouchStart(e: TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      this.pinchStartDist = Math.hypot(dx, dy);
      this.pinchStartCamDist = this.targetDistance;
    }
  }

  onTouchMove(e: TouchEvent) {
    if (e.touches.length === 2) {
      const dx = e.touches[0].clientX - e.touches[1].clientX;
      const dy = e.touches[0].clientY - e.touches[1].clientY;
      const dist = Math.hypot(dx, dy);
      const scale = this.pinchStartDist / dist;
      this.targetDistance = Math.max(
        this.DIST_MIN,
        Math.min(this.DIST_MAX, this.pinchStartCamDist * scale),
      );
    }
  }

  // Smooth angle lerp
  private lerpAngle(a: number, b: number, t: number) {
    let diff = b - a;
    while (diff > Math.PI) diff -= Math.PI * 2;
    while (diff < -Math.PI) diff += Math.PI * 2;
    return a + diff * t;
  }

  // Resize
  onResize(aspect: number) {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  // API
  getYaw() { return this.cameraYaw; }
  getTargetDistance() { return this.targetDistance; }
  setTargetHeight(h: number) { this.targetHeight = h; }
      }
