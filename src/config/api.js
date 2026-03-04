// API Configuration for EaMax App
const API_BASE_URL = 'https://eamax-production.up.railway.app';

/**
 * Make API request
 */
const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const config = {
    ...defaultOptions,
    ...options,
    headers: {
      ...defaultOptions.headers,
      ...(options.headers || {}),
    },
  };

  try {
    const response = await fetch(url, config);
    let data = {};
    try {
      const text = await response.text();
      if (text && text.trim()) data = JSON.parse(text);
    } catch (_) {
      // non-JSON or empty response
    }
    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }
    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * User API
 */
export const userAPI = {
  // Register or get user by externalId
  register: async (externalId) => {
    return apiRequest('/api/users/register', {
      method: 'POST',
      body: JSON.stringify({ externalId }),
    });
  },

  // Get user details
  getUser: async (externalId) => {
    return apiRequest(`/api/users/${externalId}`);
  },

  // Record ad watched and earn points (1 ad = 20 points in all sections)
  recordAdWatched: async (externalId, points = 20) => {
    return apiRequest(`/api/users/${externalId}/ads/watched`, {
      method: 'POST',
      body: JSON.stringify({ points }),
    });
  },

  // Unlock channel using points
  unlockChannel: async (externalId, channelId) => {
    return apiRequest(`/api/users/${externalId}/channels/${channelId}/unlock`, {
      method: 'POST',
    });
  },

  // Record channel watch (for admin "Most Watched" analytics)
  recordChannelWatch: async (externalId, channelId) => {
    return apiRequest(`/api/users/${externalId}/channels/${channelId}/watch`, {
      method: 'POST',
    });
  },

  // Get unlocked carousel slide IDs (for points-to-unlock slides)
  getUnlockedCarouselSlides: async (externalId) => {
    const data = await apiRequest(`/api/users/${externalId}/carousel-unlocked`);
    return data.slideIds || [];
  },

  // Unlock carousel slide with points (one-time)
  unlockCarouselSlide: async (externalId, slideId) => {
    return apiRequest(`/api/users/${externalId}/carousel/${slideId}/unlock`, {
      method: 'POST',
    });
  },

  // Register FCM token for push notifications
  registerFCMToken: async (externalId, fcmToken) => {
    return apiRequest(`/api/users/${externalId}/fcm-token`, {
      method: 'POST',
      body: JSON.stringify({ fcmToken }),
    });
  },
};

/**
 * Channels API
 */
export const channelsAPI = {
  // Get channels by category (football, movies, habari)
  getChannels: async (category = null) => {
    const query = category ? `?category=${category}` : '';
    return apiRequest(`/api/channels${query}`);
  },
  // Get single channel by id (stream URL from admin) – for fast play on click
  getChannel: async (channelId) => {
    return apiRequest(`/api/channels/${channelId}`);
  },
};

/**
 * Notifications API
 */
export const notificationsAPI = {
  // Get latest notifications
  getNotifications: async (limit = 10) => {
    return apiRequest(`/api/notifications?limit=${limit}`);
  },

  // Record notification click
  recordClick: async (notificationId) => {
    return apiRequest(`/api/notifications/${notificationId}/click`, {
      method: 'POST',
    });
  },
};

/**
 * Public Settings API
 */
export const settingsAPI = {
  // Get WhatsApp support number
  getWhatsAppNumber: async () => {
    return apiRequest('/api/settings/whatsapp');
  },

  // Get public carousel slides by category
  getCarouselSlides: async (category = 'football') => {
    return apiRequest(`/api/carousel?category=${category}`);
  },
};

/**
 * Matches API
 */
export const matchesAPI = {
  // Get upcoming matches
  getUpcomingMatches: async () => {
    try {
      return await apiRequest('/api/matches');
    } catch (error) {
      // Return empty array if endpoint not found (for backwards compatibility)
      if (error.message?.includes('not found') || error.message?.includes('404')) {
        return [];
      }
      throw error;
    }
  },
};

/**
 * Payments API
 */
export const paymentsAPI = {
  // Start ZenoPay mobile money payment (amount = exact TZS user selected: 2000, 5000, 12000)
  startZenoPayment: async ({ externalId, bundle, amount, phone, email, name }) => {
    return apiRequest('/api/payments/zeno/start', {
      method: 'POST',
      body: JSON.stringify({
        externalId,
        bundle,
        amount,
        phone,
        email,
        name,
      }),
    });
  },

  // Check ZenoPay order status (optional polling)
  checkZenoStatus: async (orderId) => {
    return apiRequest(`/api/payments/zeno/status?orderId=${encodeURIComponent(orderId)}`);
  },
};

export default {
  API_BASE_URL,
  userAPI,
  channelsAPI,
  notificationsAPI,
  settingsAPI,
  paymentsAPI,
  matchesAPI,
};
