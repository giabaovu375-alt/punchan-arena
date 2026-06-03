import * as THREE from "three";
import type { InputState, AnimKey } from "./types";
import type { CharacterDef } from "./characters";

export interface PlayerControllerOpts {
  character: CharacterDef;
  worldRadius: number;
  onAttack: (key: AnimKey) => void;
}

/**
 * Quản lý: input keyboard, vector velocity, movement, jump, gravity,
 * world bounds, stamina drain/regen, HP (visual).
 *
 * Mobile UI ghi trực tiếp vào `input` (joystick) và gọi `requestJump()`,
 * `onAttack()` để giữ 1 nguồn sự thật duy nhất.
 */
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

  stamina = 1; // 0..1
  hp = 1;      // visual only

  private worldRadius: number;
  private onAttack: (key: AnimKey) => void;

  // scratch vectors — tránh new mỗi frame
  private _fwd  = new THREE.Vector3();
  private _rgt  = new THREE.Vector3();
  private _move = new THREE.Vector3();

  constructor(opts: PlayerControllerOpts) {
    this.moveSpeed   = opts.character.moveSpeed;
    this.jumpSpeed   = opts.character.jumpSpeed;
    this.worldRadius = opts.worldRadius;
    this.onAttack    = opts.onAttack;
  }

  bindKeyboard() {
    window.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("keyup",   this.onKeyUp);
  }

  unbindKeyboard() {
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup",   this.onKeyUp);
  }

  requestJump() {
    if (this.onGround) {
      this.velocity.y = this.jumpSpeed;
      this.onGround = false;
    }
  }

  private onKeyDown = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":    this.input.forward = true;  break;
      case "KeyS": case "ArrowDown":  this.input.backward = true; break;
      case "KeyA": case "ArrowLeft":  this.input.left = true;     break;
      case "KeyD": case "ArrowRight": this.input.right = true;    break;
      case "Space":
        e.preventDefault();
        this.requestJump();
        break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = true; break;
      case "KeyZ": this.onAttack("punch");    break;
      case "KeyX": this.onAttack("kick");     break;
      case "KeyC": this.onAttack("uppercut"); break;
      case "KeyV": this.onAttack("mmaKick");  break;
    }
  };

  private onKeyUp = (e: KeyboardEvent) => {
    switch (e.code) {
      case "KeyW": case "ArrowUp":    this.input.forward = false;  break;
      case "KeyS": case "ArrowDown":  this.input.backward = false; break;
      case "KeyA": case "ArrowLeft":  this.input.left = false;     break;
      case "KeyD": case "ArrowRight": this.input.right = false;    break;
      case "ShiftLeft": case "ShiftRight": this.input.sprint = false; break;
    }
  };

  isMovingNow() {
    return this.input.forward || this.input.backward || this.input.left || this.input.right;
  }

  /**
   * Cập nhật vị trí + xoay player theo camera yaw.
   * Trả về snapshot dùng cho animation driver.
   */
  update(dt: number, cameraYaw: number, player: THREE.Object3D): {
    moving: boolean; sprinting: boolean; onGround: boolean;
  } {
    const fwd = this._fwd.set(-Math.sin(cameraYaw), 0, -Math.cos(cameraYaw));
    const rgt = this._rgt.set( Math.cos(cameraYaw), 0, -Math.sin(cameraYaw));
    const move = this._move.set(0, 0, 0);
    if (this.input.forward)  move.add(fwd);
    if (this.input.backward) move.sub(fwd);
    if (this.input.right)    move.add(rgt);
    if (this.input.left)     move.sub(rgt);

    const moving = move.lengthSq() > 0;
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
    player.position.addScaledVector(this.velocity, dt);

    if (player.position.y <= this.playerFloor + 0.05) {
      player.position.y = this.playerFloor;
      this.velocity.y = 0;
      this.onGround = true;
    } else if (player.position.y > this.playerFloor + 0.15) {
      this.onGround = false;
    }

    const d = Math.hypot(player.position.x, player.position.z);
    if (d > this.worldRadius) {
      player.position.x *= this.worldRadius / d;
      player.position.z *= this.worldRadius / d;
    }

    return { moving, sprinting, onGround: this.onGround };
  }
}

export function lerpAngle(a: number, b: number, t: number) {
  let diff = ((b - a + Math.PI) % (Math.PI * 2)) - Math.PI;
  if (diff < -Math.PI) diff += Math.PI * 2;
  return a + diff * t;
}
