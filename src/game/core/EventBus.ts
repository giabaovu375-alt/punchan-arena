/**
 * EventBus - Central event management
 * Giúp các modules giao tiếp mà không cần coupling trực tiếp
 */

export type EventCallback = (data?: any) => void;

export class EventBus {
  private events: Map<string, EventCallback[]> = new Map();

  /**
   * Đăng ký sự kiện
   */
  public on(eventName: string, callback: EventCallback): () => void {
    if (!this.events.has(eventName)) {
      this.events.set(eventName, []);
    }

    this.events.get(eventName)!.push(callback);

    // Return unsubscribe function
    return () => this.off(eventName, callback);
  }

  /**
   * Hủy đăng ký sự kiện
   */
  public off(eventName: string, callback: EventCallback): void {
    const callbacks = this.events.get(eventName);
    if (callbacks) {
      const index = callbacks.indexOf(callback);
      if (index > -1) {
        callbacks.splice(index, 1);
      }
    }
  }

  /**
   * Phát sự kiện
   */
  public emit(eventName: string, data?: any): void {
    const callbacks = this.events.get(eventName);
    if (callbacks) {
      callbacks.forEach((callback) => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event ${eventName}:`, err);
        }
      });
    }
  }

  /**
   * Đăng ký sự kiện chỉ 1 lần
   */
  public once(eventName: string, callback: EventCallback): void {
    const wrapper = (data?: any) => {
      callback(data);
      this.off(eventName, wrapper);
    };
    this.on(eventName, wrapper);
  }

  /**
   * Clear tất cả events
   */
  public clear(): void {
    this.events.clear();
  }

  /**
   * Debug: list tất cả listeners
   */
  public debug(): Record<string, number> {
    const result: Record<string, number> = {};
    for (const [event, callbacks] of this.events) {
      result[event] = callbacks.length;
    }
    return result;
  }
}

// Export singleton instance
export const eventBus = new EventBus();
