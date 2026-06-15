// API Configuration for EaAdmin App
// Optional: set EAMAX_API_URL when testing against a local backend (e.g. http://10.0.2.2:3000)
const API_BASE_URL =
  (typeof process !== 'undefined' && process.env && process.env.EAMAX_API_URL) ||
  'https://eamax-production.up.railway.app';
/** Prefer injecting via Metro/babel `ADMIN_API_KEY` or patch before release; never commit production secrets. */
const ADMIN_API_KEY =
  (typeof process !== 'undefined' && process.env && process.env.ADMIN_API_KEY) ||
  'super-secret-admin-key';

/**
 * Make API request with admin authentication
 */
const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  const timeoutMs =
    Number.isFinite(options.timeoutMs) && options.timeoutMs > 0
      ? Number(options.timeoutMs)
      : 20000;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': ADMIN_API_KEY,
    },
  };

  const config = {
    method: options.method || 'GET',
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {}),
    },
  };
  if (options.body != null) {
    config.body = options.body;
  }

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const isTransientNetworkError = (err) => {
    const msg = String(err?.message || err || '').toLowerCase();
    return msg.includes('network request failed') ||
      msg.includes('failed to fetch') ||
      msg.includes('networkerror') ||
      msg.includes('aborted') ||
      msg.includes('timeout');
  };

  const maxAttempts = 3; // 1 initial + 2 retries
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let controller;
    let timeoutId;
    try {
      controller = new AbortController();
      timeoutId = setTimeout(() => controller.abort(), timeoutMs);
      const response = await fetch(url, {
        ...config,
        signal: controller.signal,
      });
      clearTimeout(timeoutId);

      // Success with no body (204 No Content) – return immediately, do not read body
      if (response.status === 204) {
        if (!response.ok) return {};
        return {};
      }

      // Success with optional JSON body (e.g. 200)
      if (response.ok && response.status === 200) {
        const contentType = (response.headers.get('content-type') || '').toLowerCase();
        if (!contentType.includes('application/json')) {
          return {};
        }
      }

      // Get response text for error or JSON body
      const text = await response.text();

      if (!text || text.trim() === '') {
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        return {};
      }

      let data;
      try {
        data = JSON.parse(text);
      } catch (parseError) {
        throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
      }

      if (!response.ok) {
        const msg = data.error || `HTTP error! status: ${response.status}`;
        const details = data.details ? ` ${data.details}` : '';
        throw new Error(msg + details);
      }

      return data;
    } catch (error) {
      if (timeoutId) clearTimeout(timeoutId);
      lastErr = error;
      const canRetry = attempt < maxAttempts && isTransientNetworkError(error);
      if (!canRetry) break;
      // Railway can cold-start; small backoff helps (400ms, 900ms)
      await sleep(250 + attempt * attempt * 200);
    }
  }
  throw lastErr;
};

/**
 * Admin Users API
 */
export const adminUsersAPI = {
  // Get all users
  getUsers: async (limit = 50, offset = 0) => {
    return apiRequest(`/api/admin/users?limit=${limit}&offset=${offset}`);
  },

  // Block/unblock user
  blockUser: async (userId, blocked = true) => {
    return apiRequest(`/api/admin/users/${userId}/block`, {
      method: 'PATCH',
      body: JSON.stringify({ blocked }),
    });
  },

  // Give special access to user
  giveSpecialAccess: async (userId, duration, unit) => {
    return apiRequest(`/api/admin/users/${userId}/special-access`, {
      method: 'POST',
      body: JSON.stringify({ duration, unit }),
    });
  },

  /**
   * Payment rows for a user (real server data). Optional: 404 if not implemented — UI falls back to
   * payments embedded on the user object from /api/dashboard/users when present.
   */
  getPaymentsForUser: async (userId) => {
    return apiRequest(`/api/admin/users/${userId}/payments`);
  },

  /** FCM reminder for expired subscriptions (optional userId; force skips 7-day throttle) */
  remindExpiredSubscriptions: async ({ userId, force } = {}) => {
    return apiRequest('/api/admin/subscriptions/remind-expired', {
      method: 'POST',
      body: JSON.stringify({
        ...(userId != null ? { userId: Number(userId) } : {}),
        ...(force ? { force: true } : {}),
      }),
    });
  },
};

/**
 * Admin Channels API
 */
export const adminChannelsAPI = {
  // Get all channels
  getChannels: async () => {
    return apiRequest('/api/admin/channels');
  },

  // Create new channel
  createChannel: async (channelData) => {
    return apiRequest('/api/admin/channels', {
      method: 'POST',
      body: JSON.stringify(channelData),
    });
  },

  // Update channel
  updateChannel: async (channelId, channelData) => {
    return apiRequest(`/api/admin/channels/${channelId}`, {
      method: 'PUT',
      body: JSON.stringify(channelData),
    });
  },

  // Delete channel
  deleteChannel: async (channelId) => {
    return apiRequest(`/api/admin/channels/${channelId}`, {
      method: 'DELETE',
    });
  },

  // Reorder channels — pass section when reordering one admin group; fullOrderIds for legacy fallback
  reorderChannels: async (channelIds, { section, fullOrderIds } = {}) => {
    const ids = (channelIds || [])
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    if (ids.length === 0) {
      throw new Error('No valid channel ids to reorder');
    }
    const fullIds = (fullOrderIds || ids)
      .map((id) => Number(id))
      .filter((id) => Number.isFinite(id) && id > 0);
    const body = JSON.stringify({
      channelIds: ids,
      ...(section ? { section: String(section) } : {}),
    });
    const isNotFound = (err) => {
      const msg = String(err?.message || err || '').toLowerCase();
      return msg.includes('404') || msg.includes('not found');
    };

    try {
      return await apiRequest('/api/admin/channels/reorder', {
        method: 'PATCH',
        body,
      });
    } catch (patchErr) {
      if (!isNotFound(patchErr)) throw patchErr;
    }

    try {
      return await apiRequest('/api/admin/channels/reorder', {
        method: 'POST',
        body,
      });
    } catch (postErr) {
      if (!isNotFound(postErr)) throw postErr;
    }

    // Fallback for older backends: write global sort_order for every channel
    const orderIds = fullIds.length ? fullIds : ids;
    for (let i = 0; i < orderIds.length; i += 1) {
      await apiRequest(`/api/admin/channels/${orderIds[i]}`, {
        method: 'PUT',
        body: JSON.stringify({ sortOrder: i }),
      });
    }
    return { ok: true, count: orderIds.length, fallback: true };
  },
};

/**
 * Admin Carousel API
 */
export const adminCarouselAPI = {
  // Get all slides (optionally filter by category)
  getSlides: async (category) => {
    // Swallow errors (e.g. 404 on older backend) and just return empty list
    try {
      const url = category
        ? `/api/admin/carousel?category=${category}`
        : '/api/admin/carousel';
      return await apiRequest(url);
    } catch (error) {
      return [];
    }
  },

  // Create slide
  createSlide: async (data) => {
    return apiRequest('/api/admin/carousel', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // Update slide
  updateSlide: async (id, data) => {
    return apiRequest(`/api/admin/carousel/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // Delete slide
  deleteSlide: async (id) => {
    return apiRequest(`/api/admin/carousel/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Admin Notifications API
 */
export const adminNotificationsAPI = {
  // Create notification
  createNotification: async (notificationData) => {
    return apiRequest('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify(notificationData),
      // Server queues FCM in background and responds immediately.
      timeoutMs: 25000,
    });
  },

  // Get all notifications
  getNotifications: async (limit = 20) => {
    // Scheduled (pinned) + sent notifications for recent list
    return apiRequest(`/api/admin/notifications?limit=${limit}`);
  },

  /** Aggregate notification analytics (GET /api/admin/notifications/metrics). */
  getMetrics: async (days = 30) => {
    const d = Number.isFinite(Number(days)) ? Math.min(90, Math.max(1, Number(days))) : 30;
    return apiRequest(`/api/admin/notifications/metrics?days=${d}`);
  },

  /** Removes all notification history and scheduled rows from the server (admin only). */
  deleteAllNotificationHistory: async () => {
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const clearViaPrimary = async () =>
      apiRequest('/api/admin/notifications/history/clear', {
        method: 'POST',
      });
    const clearViaLegacy = async () =>
      apiRequest('/api/admin/notifications/history', {
        method: 'DELETE',
      });

    try {
      const clearResult = await clearViaPrimary();
      // Verify server really became empty (eventual consistency/restart race protection).
      for (let i = 0; i < 3; i += 1) {
        const rows = await adminNotificationsAPI.getNotifications(5);
        if (Array.isArray(rows) && rows.length === 0) {
          return {
            ...(clearResult || {}),
            verifiedEmpty: true,
          };
        }
        await sleep(250 + i * 200);
      }
      return {
        ...(clearResult || {}),
        verifiedEmpty: false,
      };
    } catch (err) {
      const m = String(err?.message || '').toLowerCase();
      if (m.includes('not found') || m.includes('404') || m.includes('http error! status: 404')) {
        const clearResult = await clearViaLegacy();
        for (let i = 0; i < 3; i += 1) {
          const rows = await adminNotificationsAPI.getNotifications(5);
          if (Array.isArray(rows) && rows.length === 0) {
            return {
              ...(clearResult || {}),
              verifiedEmpty: true,
            };
          }
          await sleep(250 + i * 200);
        }
        return {
          ...(clearResult || {}),
          verifiedEmpty: false,
        };
      }
      throw err;
    }
  },
};

/**
 * Admin Settings API
 */
export const adminSettingsAPI = {
  // Get WhatsApp number
  getWhatsAppNumber: async () => {
    return apiRequest('/api/settings/whatsapp');
  },

  // Update WhatsApp number
  updateWhatsAppNumber: async (number) => {
    return apiRequest('/api/settings/whatsapp', {
      method: 'PUT',
      body: JSON.stringify({ number }),
    });
  },

  // Get channels premium-only mode (ON = pay only, OFF = points/ads or free)
  getChannelsPremiumOnly: async () => {
    const data = await apiRequest('/api/admin/settings/channels-premium-only');
    return { channelsPremiumOnly: !!data.channelsPremiumOnly };
  },

  // Update channels premium-only
  updateChannelsPremiumOnly: async (channelsPremiumOnly) => {
    return apiRequest('/api/admin/settings/channels-premium-only', {
      method: 'PUT',
      body: JSON.stringify({ channelsPremiumOnly: !!channelsPremiumOnly }),
    });
  },

  // Get currently active payment provider
  getPaymentProvider: async () => {
    const data = await apiRequest('/api/admin/settings/payment-provider');
    return { paymentProvider: data.paymentProvider || 'zeno' };
  },

  // Update active payment provider
  updatePaymentProvider: async (paymentProvider) => {
    return apiRequest('/api/admin/settings/payment-provider', {
      method: 'PUT',
      body: JSON.stringify({ paymentProvider }),
    });
  },
};

/**
 * Admin Matches API
 */
export const adminMatchesAPI = {
  // Get all matches
  getMatches: async () => {
    return apiRequest('/api/admin/matches');
  },

  // Create match
  createMatch: async (matchData) => {
    return apiRequest('/api/admin/matches', {
      method: 'POST',
      body: JSON.stringify(matchData),
    });
  },

  // Update match
  updateMatch: async (id, matchData) => {
    return apiRequest(`/api/admin/matches/${id}`, {
      method: 'PUT',
      body: JSON.stringify(matchData),
    });
  },

  // Delete match
  deleteMatch: async (id) => {
    return apiRequest(`/api/admin/matches/${id}`, {
      method: 'DELETE',
    });
  },
};

/**
 * Admin Ads API
 */
export const adminAdsAPI = {
  // Get real ads statistics from database
  getStats: async () => {
    // First try the dedicated ads/stats endpoint (available after backend update)
    try {
      const data = await apiRequest('/api/admin/ads/stats');
      if (data && typeof data === 'object') return data;
    } catch (err) {
      console.warn('[adminAdsAPI] /ads/stats failed, trying dashboard fallback:', err.message);
    }

    // Fallback: use dashboard endpoint which always exists and has partial ads data
    try {
      const dashboard = await apiRequest('/api/admin/dashboard');
      return {
        adsWatchedToday: dashboard.adsWatchedToday || 0,
        pointsEarnedToday: 0,
        adsWatchedYesterday: 0,
        todayChange: '+0%',
        adsWatchedThisMonth: dashboard.adsWatchedThisMonth || 0,
        pointsEarnedThisMonth: 0,
        adsWatchedLastMonth: 0,
        monthChange: '+0%',
        adsWatchedAllTime: dashboard.adsWatchedThisMonth || 0,
        pointsEarnedAllTime: 0,
        totalPointsCollected: dashboard.totalPointsCollected || 0,
        usersWithPoints: 0,
        topUsers: [],
        dailyBreakdown: [],
        _fallback: true,
      };
    } catch (fallbackErr) {
      console.warn('[adminAdsAPI] dashboard fallback also failed:', fallbackErr.message);
    }

    // Last resort: return safe zero-state so UI never shows an error screen
    return {
      adsWatchedToday: 0,
      pointsEarnedToday: 0,
      adsWatchedYesterday: 0,
      todayChange: '+0%',
      adsWatchedThisMonth: 0,
      pointsEarnedThisMonth: 0,
      adsWatchedLastMonth: 0,
      monthChange: '+0%',
      adsWatchedAllTime: 0,
      pointsEarnedAllTime: 0,
      totalPointsCollected: 0,
      usersWithPoints: 0,
      topUsers: [],
      dailyBreakdown: [],
      _fallback: true,
    };
  },
};

/**
 * Dashboard API
 */
export const dashboardAPI = {
  // Get dashboard statistics
  getStats: async () => {
    return apiRequest('/api/dashboard/stats');
  },

  // Get users with filters (can be slow on large DBs — generous timeout)
  getUsers: async (limit = 2000, offset = 0, filter = 'all', search = '') => {
    const params = new URLSearchParams({
      limit: limit.toString(),
      offset: offset.toString(),
      filter,
    });

    if (search.trim()) {
      params.append('search', search.trim());
    }

    return apiRequest(`/api/dashboard/users?${params.toString()}`, {
      timeoutMs: 45000,
    });
  },

  // Recent subscription payments (all statuses)
  getTransactions: async (limit = 40) => {
    return apiRequest(`/api/dashboard/transactions?limit=${limit}`);
  },
};

/**
 * Promotion Center API
 */
export const adminPromotionsAPI = {
  getStats: async () => apiRequest('/api/admin/promotions/stats'),

  list: async () => apiRequest('/api/admin/promotions'),

  create: async (payload) =>
    apiRequest('/api/admin/promotions', {
      method: 'POST',
      body: JSON.stringify(payload),
    }),

  update: async (id, payload) =>
    apiRequest(`/api/admin/promotions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    }),

  toggle: async (id, isActive) =>
    apiRequest(`/api/admin/promotions/${id}/toggle`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive }),
    }),

  remove: async (id) =>
    apiRequest(`/api/admin/promotions/${id}`, { method: 'DELETE' }),
};

export default {
  API_BASE_URL,
  ADMIN_API_KEY,
  dashboardAPI,
  adminUsersAPI,
  adminChannelsAPI,
  adminCarouselAPI,
  adminNotificationsAPI,
  adminSettingsAPI,
  adminMatchesAPI,
  adminAdsAPI,
  adminPromotionsAPI,
};
