import { NativeEventEmitter, NativeModules } from 'react-native';

/**
 * Simple EventEmitter for React Native
 */
class SimpleEventEmitter {
  constructor() {
    this.listeners = new Map();
  }

  on(event, callback) {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event).add(callback);
  }

  off(event, callback) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(callback);
    }
  }

  emit(event, data) {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach(callback => {
        try {
          callback(data);
        } catch (err) {
          console.error(`Error in event listener for ${event}:`, err);
        }
      });
    }
  }
}

/**
 * Real-time sync service using WebSocket for instant updates
 * Replaces polling with push-based architecture
 */

const REALTIME_API_BASE = process.env.REACT_APP_REALTIME_API || 'ws://localhost:3001';

class RealtimeSyncService extends SimpleEventEmitter {
  constructor() {
    super();
    this.ws = null;
    this.isConnected = false;
    this.userId = null;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 10;
    this.reconnectDelay = 1000; // Start with 1 second
    this.messageQueue = [];
    this.heartbeatInterval = null;
    this.subscriptions = new Set();
  }

  /**
   * Connect to real-time sync server
   */
  connect(userId, fcmToken = null) {
    if (this.isConnected || (this.ws && this.ws.readyState === WebSocket.CONNECTING)) {
      console.log('[RealtimeSync] Already connected or connecting');
      return Promise.resolve();
    }

    this.userId = userId;
    return new Promise((resolve, reject) => {
      try {
        const wsUrl = `${REALTIME_API_BASE}?userId=${encodeURIComponent(userId)}${fcmToken ? `&fcmToken=${encodeURIComponent(fcmToken)}` : ''}`;
        this.ws = new WebSocket(wsUrl);

        this.ws.onopen = () => {
          console.log('[RealtimeSync] Connected to real-time server');
          this.isConnected = true;
          this.reconnectAttempts = 0;
          this.reconnectDelay = 1000;
          
          // Send queued messages
          this.messageQueue.forEach(msg => this.send(msg));
          this.messageQueue = [];

          // Start heartbeat to keep connection alive
          this.startHeartbeat();
          
          this.emit('connected', { userId });
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const message = JSON.parse(event.data);
            this.handleMessage(message);
          } catch (error) {
            console.error('[RealtimeSync] Failed to parse message:', error);
          }
        };

        this.ws.onerror = (error) => {
          console.error('[RealtimeSync] WebSocket error:', error);
          this.emit('error', error);
          reject(error);
        };

        this.ws.onclose = () => {
          console.log('[RealtimeSync] Disconnected from real-time server');
          this.isConnected = false;
          this.stopHeartbeat();
          this.reconnect();
        };

        // Set timeout for connection
        setTimeout(() => {
          if (!this.isConnected && this.ws.readyState === WebSocket.CONNECTING) {
            this.ws.close();
            reject(new Error('Connection timeout'));
          }
        }, 5000);
      } catch (error) {
        console.error('[RealtimeSync] Connection error:', error);
        reject(error);
      }
    });
  }

  /**
   * Disconnect from real-time sync server
   */
  disconnect() {
    this.stopHeartbeat();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
    this.subscriptions.clear();
    this.emit('disconnected');
  }

  /**
   * Send message to server
   */
  send(message) {
    if (!this.isConnected) {
      this.messageQueue.push(message);
      return;
    }

    try {
      this.ws.send(JSON.stringify(message));
    } catch (error) {
      console.error('[RealtimeSync] Failed to send message:', error);
      this.messageQueue.push(message);
    }
  }

  /**
   * Subscribe to real-time updates
   */
  subscribe(channel, callback) {
    this.subscriptions.add(channel);
    this.send({
      type: 'subscribe',
      channel,
      userId: this.userId,
    });
    this.on(channel, callback);
    console.log(`[RealtimeSync] Subscribed to ${channel}`);
  }

  /**
   * Unsubscribe from real-time updates
   */
  unsubscribe(channel, callback) {
    this.subscriptions.delete(channel);
    this.send({
      type: 'unsubscribe',
      channel,
      userId: this.userId,
    });
    this.off(channel, callback);
    console.log(`[RealtimeSync] Unsubscribed from ${channel}`);
  }

  /**
   * Handle incoming messages from server
   */
  handleMessage(message) {
    const { type, channel, data, timestamp } = message;

    if (type === 'update') {
      // Emit update event
      this.emit(channel, data);
      this.emit('update', { channel, data, timestamp });
      console.log(`[RealtimeSync] Update received on ${channel}:`, data);
    } else if (type === 'error') {
      console.error(`[RealtimeSync] Server error: ${data.message}`);
      this.emit('error', data);
    } else if (type === 'pong') {
      // Heartbeat response
      console.log('[RealtimeSync] Heartbeat pong received');
    }
  }

  /**
   * Send heartbeat to keep connection alive
   */
  startHeartbeat() {
    this.stopHeartbeat();
    this.heartbeatInterval = setInterval(() => {
      if (this.isConnected) {
        this.send({ type: 'ping', userId: this.userId });
      }
    }, 30000); // Send heartbeat every 30 seconds
  }

  /**
   * Stop heartbeat
   */
  stopHeartbeat() {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Attempt to reconnect
   */
  reconnect() {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('[RealtimeSync] Max reconnection attempts reached');
      this.emit('connection_lost');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), 30000);
    
    console.log(`[RealtimeSync] Attempting to reconnect in ${delay}ms (attempt ${this.reconnectAttempts})`);
    
    setTimeout(() => {
      if (!this.isConnected && this.userId) {
        this.connect(this.userId).catch(err => {
          console.error('[RealtimeSync] Reconnection failed:', err);
        });
      }
    }, delay);
  }

  /**
   * Get current connection status
   */
  getStatus() {
    return {
      isConnected: this.isConnected,
      userId: this.userId,
      subscriptions: Array.from(this.subscriptions),
      reconnectAttempts: this.reconnectAttempts,
    };
  }
}

// Export singleton instance
export const realtimeSyncService = new RealtimeSyncService();
export default realtimeSyncService;
