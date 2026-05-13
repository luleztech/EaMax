const WebSocket = require('ws');
const { query } = require('../db');

const BROADCAST_CHANNELS = {
  USER_PREMIUM_UPDATE: 'user_premium_update',
  USER_POINTS_UPDATE: 'user_points_update',
  CHANNEL_UNLOCK: 'channel_unlock',
  PAYMENT_RECEIVED: 'payment_received',
  ADMIN_ACCESS_GRANTED: 'admin_access_granted',
};

// Track connected clients
const clients = new Map(); // Map of userId -> Set of WebSocket connections

/**
 * Initialize WebSocket server for real-time updates
 */
const initializeRealtimeServer = (server) => {
  const wss = new WebSocket.Server({ server });

  wss.on('connection', (ws, req) => {
    try {
      const url = new URL(req.url, `http://${req.headers.host}`);
      const userId = url.searchParams.get('userId');
      const fcmToken = url.searchParams.get('fcmToken');

      if (!userId) {
        console.log('[RealtimeWS] Client connected without userId, closing');
        ws.close();
        return;
      }

      console.log(`[RealtimeWS] Client connected: userId=${userId}`);

      // Store client connection
      if (!clients.has(userId)) {
        clients.set(userId, new Set());
      }
      clients.get(userId).add(ws);

      // Update FCM token in database if provided
      if (fcmToken) {
        query(
          `UPDATE users SET fcm_token = $1, fcm_token_updated_at = now()
           WHERE id = (SELECT id FROM users WHERE external_id = $2)`,
          [fcmToken, userId]
        ).catch(err => console.error('[RealtimeWS] Failed to update FCM token:', err));
      }

      // Send initial connection confirmation
      ws.send(JSON.stringify({
        type: 'connected',
        message: 'Real-time connection established',
        userId,
      }));

      // Handle incoming messages
      ws.on('message', (data) => {
        try {
          const message = JSON.parse(data);
          handleClientMessage(ws, userId, message);
        } catch (error) {
          console.error('[RealtimeWS] Failed to parse message:', error);
        }
      });

      // Handle client disconnect
      ws.on('close', () => {
        console.log(`[RealtimeWS] Client disconnected: userId=${userId}`);
        const userClients = clients.get(userId);
        if (userClients) {
          userClients.delete(ws);
          if (userClients.size === 0) {
            clients.delete(userId);
          }
        }
      });

      ws.on('error', (error) => {
        console.error(`[RealtimeWS] WebSocket error for userId=${userId}:`, error.message);
      });
    } catch (error) {
      console.error('[RealtimeWS] Connection error:', error);
      ws.close();
    }
  });

  console.log('[RealtimeWS] Real-time WebSocket server initialized');

  return {
    broadcast,
    broadcastToUser,
    getConnectedClients: () => clients,
    getClientCount: () => Array.from(clients.values()).reduce((sum, set) => sum + set.size, 0),
  };
};

/**
 * Handle incoming messages from clients
 */
const handleClientMessage = (ws, userId, message) => {
  const { type } = message;

  if (type === 'ping') {
    ws.send(JSON.stringify({ type: 'pong' }));
  } else if (type === 'subscribe') {
    console.log(`[RealtimeWS] User ${userId} subscribed to ${message.channel}`);
  } else if (type === 'unsubscribe') {
    console.log(`[RealtimeWS] User ${userId} unsubscribed from ${message.channel}`);
  }
};

/**
 * Broadcast message to all connected users
 */
const broadcast = (channel, data) => {
  const message = JSON.stringify({
    type: 'update',
    channel,
    data,
    timestamp: new Date().toISOString(),
  });

  let count = 0;
  for (const userConnections of clients.values()) {
    for (const ws of userConnections) {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(message);
        count++;
      }
    }
  }

  console.log(`[RealtimeWS] Broadcast to ${channel}: sent to ${count} clients`);
};

/**
 * Send message to specific user
 */
const broadcastToUser = (userId, channel, data) => {
  const message = JSON.stringify({
    type: 'update',
    channel,
    data,
    timestamp: new Date().toISOString(),
  });

  const userConnections = clients.get(userId);
  if (!userConnections) {
    console.log(`[RealtimeWS] User ${userId} not connected`);
    return 0;
  }

  let count = 0;
  for (const ws of userConnections) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
      count++;
    }
  }

  console.log(`[RealtimeWS] Sent to user ${userId} on ${channel}: ${count} connections`);
  return count;
};

/**
 * Notify user of premium status change
 */
const notifyPremiumUpdate = (userId, premiumData) => {
  const isPremium = premiumData.is_premium || premiumData.isPremium;
  const expiresAt = premiumData.premium_expires_at || premiumData.premiumExpiresAt;
  
  console.log(`[RealtimeWS] Notifying premium update for user ${userId}: premium=${isPremium}`);
  
  broadcastToUser(userId, BROADCAST_CHANNELS.USER_PREMIUM_UPDATE, {
    // Include both camelCase and snake_case for flexibility
    isPremium: isPremium,
    is_premium: isPremium,
    premiumExpiresAt: expiresAt,
    premium_expires_at: expiresAt,
    updatedAt: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });
};

/**
 * Notify user of points change
 */
const notifyPointsUpdate = (userId, points) => {
  broadcastToUser(userId, BROADCAST_CHANNELS.USER_POINTS_UPDATE, {
    points,
    updatedAt: new Date().toISOString(),
  });
};

/**
 * Notify user of channel unlock
 */
const notifyChannelUnlock = (userId, channelId) => {
  broadcastToUser(userId, BROADCAST_CHANNELS.CHANNEL_UNLOCK, {
    channelId,
    unlockedAt: new Date().toISOString(),
  });
};

/**
 * Notify user of payment received
 */
const notifyPaymentReceived = (userId, paymentData) => {
  broadcastToUser(userId, BROADCAST_CHANNELS.PAYMENT_RECEIVED, {
    orderId: paymentData.provider_ref,
    amount: paymentData.amount_cents,
    status: paymentData.status,
    processedAt: new Date().toISOString(),
  });
};

module.exports = {
  initializeRealtimeServer,
  broadcast,
  broadcastToUser,
  notifyPremiumUpdate,
  notifyPointsUpdate,
  notifyChannelUnlock,
  notifyPaymentReceived,
  BROADCAST_CHANNELS,
};
