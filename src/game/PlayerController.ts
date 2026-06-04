import * as THREE from "three";
import type { InputState, AnimKey } from "./types";
import type { CharacterDef } from "./characters";
import type { Collider } from "./GameWorld";

export interface PlayerControllerOpts {
  character: CharacterDef;
  worldRadius: number;
  onAttack: (key: AnimKey) => void;
}

const PLAYER_RADIUS = 0.45; // bán kính capsule player

export class PlayerController {
  readonly input: InputState = {
    forward: false, backward: false, left: false,
    right: false,  jump: false,     sprint: false,
  };

  private velocity = new THREE.Vector3();
  private onGround = true;

  private moveSpeed: number;
  private jumpSpeed: number;
  private sprintMultiplier = 1.8;
  private gravity = -22;
  private playerFloor = 0;

  private colliders: Collider[] = [];

  stamina = 1;
  hp = 1;

  private worldRadius: number;
  private onAttack: (key: AnimKey) => void;

  private _fwd  = new THREE.Vector3();
  private _rgt  = new THREE.Vector3();
  private _move = new THREE.Vector3();

  constructor(opts: PlayerControllerOpts) {
    this.moveSpeed   = opts.character.moveSpeed;
    this.jumpSpeed   = opts.character.jumpSpeed;
    this.worldRadius = opts.worldRadius;
    this.onAttack    = opts.onAttack;
  }

  setFloor(y: number) { this.playerFloor = y; }
  setColliders(c: Collider[]) { this.colliders = c; }

  bindKeyboard() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup",   this.onKeyUp);
  }
  unbindKeyboard() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup",   this.onKeyUp);
  }

  requestJump() {
    if (this.onGround) { this.velocity.y = this.jumpSpeed; this.onGround = false; }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":         this.input.forward  = true; break;
      case "KeyS": case "ArrowDown":       this.input.backward = true; break;
      case "KeyA": case "ArrowLeft":       this.input.left     = true; break;
      case "KeyD": case "ArrowRight":      this.input.right    = true; break;
      case "Space": e.preventDefault(); this.requestJump();            break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint   = true; break;
      case "KeyZ": this.onAttack("punch");    break;
      case "KeyX": this.onAttack("kick");     break;
      case "KeyC": this.onAttack("uppercut"); break;
      case "KeyV": this.onAttack("mmaKick");  break;
    }
  };
  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":         this.input.forward  = false; break;
      case "KeyS": case "ArrowDown":       this.input.backward = false; break;
      case "KeyA": case "ArrowLeft":       this.input.left     = false; break;
      case "KeyD": case "ArrowRight":      this.input.right    = false; break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint   = false; break;
    }
  };

  isMovingNow() {
    return this.input.forward || this.input.backward || this.input.left || this.input.right;
  }

  update(dt: number, cameraYaw: number, player: THREE.Object3D): {
    moving: boolean; sprinting: boolean; onGround: boolean;
  } {
    const fwd  = this._fwd.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const rgt  = this._rgt.set( Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const move = this._move.set(0, 0, 0);
    if (this.input.forward)  move.add(fwd);
    if (this.input.backward) move.sub(fwd);
    if (this.input.right)    move.add(rgt);
    if (this.input.left)     move.sub(rgt);

    const moving    = move.lengthSq() > 0;
    const sprinting = moving && this.input.sprint && this.stamina > 0.05;

    if (moving) {
      move.normalize();
      const spd = this.moveSpeed * (sprinting ? this.sprintMultiplier : 1);
      this.velocity.x = move.x * spd;
      this.velocity.z = move.z * spd;
      player.rotation.y = lerpAngle(
        player.rotation.y, Math.atan2(move.x, move.z), Math.min(1, dt * 12),
      );
      this.stamina = sprinting
        ? Math.max(0, this.stamina - dt * 0.25)
        : Math.min(1, this.stamina + dt * 0.12);
    } else {
      this.velocity.x *= 0.8;
      this.velocity.z *= 0.8;
      this.stamina = Math.min(1, this.stamina + dt * 0.22);
    }

    this.velocity.y += this.gravity * dt;

    // ── Di chuyển từng trục riêng → push-out đúng hướng ─────────────────────
    player.position.x += this.velocity.x * dt;
    this.resolveCollisions(player);
    player.position.z += this.velocity.z * dt;
    this.resolveCollisions(player);

    player.position.y += this.velocity.y * dt;
    if (player.position.y <= this.playerFloor + 0.05) {
      player.position.y = this.playerFloor;
      this.velocity.y   = 0;
      this.onGround      = true;
    } else if (player.position.y > this.playerFloor + 0.15) {
      this.onGround = false;
    }

    // World bound
    const d = Math.hypot(player.position.x, player.position.z);
    if (d > this.worldRadius) {
      player.position.x *= this.worldRadius / d;
      player.position.z *= this.worldRadius / d;
    }

    return { moving, sprinting, onGround: this.onGround };
  }

  /** Push player ra ngoài collider nếu đang chồng lên */
  private resolveCollisions(player: THREE.Object3D) {
    const px = player.position.x;
    const pz = player.position.z;

    for (const col of this.colliders) {
      if (col.type === "cylinder") {
        const dx = px - col.x;
        const dz = pz - col.z;
        const dist = Math.sqrt(dx * dx + dz * dz);
        const minDist = col.radius + PLAYER_RADIUS;
        if (dist < minDist && dist > 0.001) {
          const push = (minDist - dist) / dist;
          player.position.x += dx * push;
          player.position.z += dz * push;
          // Dừng velocity về phía collider
          this.velocity.x *= 0.1;
          this.velocity.z *= 0.1;
        }
      } else {
        // Box collider — expand by PLAYER_RADIUS
        const minX = col.minX - PLAYER_RADIUS;
        const maxX = col.maxX + PLAYER_RADIUS;
        const minZ = col.minZ - PLAYER_RADIUS;
        const maxZ = col.maxZ + PLAYER_RADIUS;
        if (px > minX && px < maxX && pz > minZ && pz < maxZ) {
          // Tìm hướng push ra gần nhất
          const overlapL = px - minX;
          const overlapR = maxX - px;
          const overlapB = pz - minZ;
          const overlapT = maxZ - pz;
          const minOverlap = Math.min(overlapL, overlapR, overlapB, overlapT);
          if      (minOverlap === overlapL) player.position.x = minX;
          else if (minOverlap === overlapR) player.position.x = maxX;
          else if (minOverlap === overlapB) player.position.z = minZ;
          else                              player.position.z = maxZ;
          this.velocity.x *= 0.1;
          this.velocity.z *= 0.1;
        }
      }
    }
  }
}

export function lerpAngle(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
