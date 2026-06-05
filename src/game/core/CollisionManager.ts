import * as THREE from "three";

export interface Collider {
  id: string;
  center: THREE.Vector3;
  radius: number;
}

class CollisionManager {
  private colliders: Map<string, Collider> = new Map();

  setCollider(id: string, center: THREE.Vector3, radius: number) {
    this.colliders.set(id, { id, center: center.clone(), radius });
  }

  removeCollider(id: string) {
    this.colliders.delete(id);
  }

  clear() {
    this.colliders.clear();
  }

  /**
   * Đẩy player ra khỏi tất cả collider gần đó
   */
  resolveCollisions(
    playerPos: THREE.Vector3,
    playerRadius: number,
    excludeId?: string
  ): THREE.Vector3 {
    const result = playerPos.clone();
    const maxCheck = 20; // chỉ kiểm tra trong bán kính 20 đơn vị

    for (const [id, col] of this.colliders) {
      if (id === excludeId) continue;

      const dx = result.x - col.center.x;
      const dz = result.z - col.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      if (dist > maxCheck) continue;

      const minDist = playerRadius + col.radius;
      if (dist < minDist && dist > 0.001) {
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        result.x += nx * overlap;
        result.z += nz * overlap;
      }
    }
    return result;
  }

  /** Debug: log số lượng collider */
  debug() {
    console.log(`📦 CollisionManager: ${this.colliders.size} colliders`);
  }
}

export const collisionManager = new CollisionManager();
