import * as THREE from "three";

/** Một collider hình tròn đơn giản (phù hợp game top-down view) */
export interface Collider {
  id: string;               // ID duy nhất để quản lý
  center: THREE.Vector3;    // vị trí tâm
  radius: number;           // bán kính va chạm
}

/**
 * CollisionManager: quản lý tập trung tất cả collider trong game.
 * - Tĩnh (cây, đá): đăng ký một lần, không đổi.
 * - Động (quái, player khác): cập nhật vị trí mỗi frame.
 */
class CollisionManager {
  private colliders: Map<string, Collider> = new Map();

  /** Thêm hoặc thay thế một collider */
  setCollider(id: string, center: THREE.Vector3, radius: number) {
    this.colliders.set(id, { id, center, radius });
  }

  /** Xóa collider (khi quái chết, đá bị phá...) */
  removeCollider(id: string) {
    this.colliders.delete(id);
  }

  /** Xóa tất cả collider (khi chuyển scene) */
  clear() {
    this.colliders.clear();
  }

  /**
   * Kiểm tra và đẩy lùi player ra khỏi tất cả collider gần đó.
   * @param playerPos - vị trí hiện tại của player
   * @param playerRadius - bán kính player (coi như hình tròn)
   * @param excludeId - (optional) bỏ qua collider của chính mình (nếu player cũng có collider)
   * @returns vị trí mới đã được điều chỉnh
   */
  resolveCollisions(
    playerPos: THREE.Vector3,
    playerRadius: number,
    excludeId?: string
  ): THREE.Vector3 {
    const result = playerPos.clone();
    const maxCheckDistance = 15; // chỉ kiểm tra collider trong bán kính 15 đơn vị

    for (const [id, collider] of this.colliders) {
      if (id === excludeId) continue;

      // Khoảng cách giữa tâm player và tâm collider
      const dx = result.x - collider.center.x;
      const dz = result.z - collider.center.z;
      const dist = Math.sqrt(dx * dx + dz * dz);

      // Chỉ kiểm tra nếu đủ gần
      if (dist > maxCheckDistance) continue;

      const minDist = playerRadius + collider.radius;
      if (dist < minDist && dist > 0.001) {
        // Đẩy player ra xa khỏi collider
        const overlap = minDist - dist;
        const nx = dx / dist;
        const nz = dz / dist;
        result.x += nx * overlap;
        result.z += nz * overlap;
      }
    }

    return result;
  }
}

// Singleton toàn cục
export const collisionManager = new CollisionManager();
