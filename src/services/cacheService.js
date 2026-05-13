/**
 * Smart cache service for optimized data fetching
 * Reduces API calls and speeds up data loading
 */

class CacheService {
  constructor() {
    this.cache = new Map();
    this.ttl = new Map(); // Time-to-live for each cache entry
    this.subscribers = new Map(); // Change listeners
  }

  /**
   * Set cache entry with TTL
   */
  set(key, value, ttlSeconds = 300) {
    this.cache.set(key, value);
    
    // Clear existing timeout
    if (this.ttl.has(key)) {
      clearTimeout(this.ttl.get(key).timeoutId);
    }

    // Set new timeout
    const timeoutId = setTimeout(() => {
      this.cache.delete(key);
      this.ttl.delete(key);
      console.log(`[Cache] Entry expired: ${key}`);
    }, ttlSeconds * 1000);

    this.ttl.set(key, {
      expiresAt: Date.now() + ttlSeconds * 1000,
      timeoutId,
    });

    this.notifySubscribers(key, value);
  }

  /**
   * Get cache entry
   */
  get(key) {
    return this.cache.get(key);
  }

  /**
   * Check if cache entry exists and is valid
   */
  has(key) {
    return this.cache.has(key);
  }

  /**
   * Delete cache entry
   */
  delete(key) {
    if (this.ttl.has(key)) {
      clearTimeout(this.ttl.get(key).timeoutId);
      this.ttl.delete(key);
    }
    this.cache.delete(key);
  }

  /**
   * Clear all cache
   */
  clear() {
    this.ttl.forEach(({ timeoutId }) => clearTimeout(timeoutId));
    this.cache.clear();
    this.ttl.clear();
    this.subscribers.clear();
  }

  /**
   * Update cache entry (merge with existing)
   */
  update(key, partialValue) {
    const existing = this.cache.get(key) || {};
    const updated = {
      ...existing,
      ...partialValue,
      _updatedAt: Date.now(),
    };
    
    // Keep existing TTL
    const ttlInfo = this.ttl.get(key);
    const remainingTtl = ttlInfo ? Math.ceil((ttlInfo.expiresAt - Date.now()) / 1000) : 300;
    
    this.set(key, updated, remainingTtl);
    return updated;
  }

  /**
   * Subscribe to cache changes
   */
  subscribe(key, callback) {
    if (!this.subscribers.has(key)) {
      this.subscribers.set(key, new Set());
    }
    this.subscribers.get(key).add(callback);

    // Unsubscribe function
    return () => {
      const subs = this.subscribers.get(key);
      if (subs) {
        subs.delete(callback);
      }
    };
  }

  /**
   * Notify all subscribers of changes
   */
  notifySubscribers(key, value) {
    const subscribers = this.subscribers.get(key);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(value);
        } catch (error) {
          console.error(`[Cache] Subscriber callback error for key ${key}:`, error);
        }
      });
    }
  }

  /**
   * Get cache stats
   */
  getStats() {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys()),
      ttls: Array.from(this.ttl.entries()).map(([key, { expiresAt }]) => ({
        key,
        expiresIn: Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000)),
      })),
    };
  }
}

export const cacheService = new CacheService();
export default cacheService;
