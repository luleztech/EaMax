// API Configuration for EaAdmin App
const API_BASE_URL = 'https://eamax-production.up.railway.app';
const ADMIN_API_KEY = 'super-secret-admin-key'; // TODO: Move to environment variable or secure storage

/**
 * Make API request with admin authentication
 */
const apiRequest = async (endpoint, options = {}) => {
  const url = `${API_BASE_URL}${endpoint}`;
  
  const defaultOptions = {
    headers: {
      'Content-Type': 'application/json',
      'X-Admin-Key': ADMIN_API_KEY,
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
    
    // Handle empty responses (e.g., 204 No Content for DELETE requests)
    if (response.status === 204 || response.status === 200) {
      const contentType = response.headers.get('content-type');
      if (!contentType || !contentType.includes('application/json')) {
        // Return empty object for non-JSON responses
        return {};
      }
    }
    
    // Get response text first to check if it's empty
    const text = await response.text();
    
    // If response is empty, return empty object
    if (!text || text.trim() === '') {
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      return {};
    }
    
    // Try to parse as JSON
    let data;
    try {
      data = JSON.parse(text);
    } catch (parseError) {
      // If parsing fails, throw with the response text
      throw new Error(`Invalid JSON response: ${text.substring(0, 100)}`);
    }
    
    if (!response.ok) {
      const msg = data.error || `HTTP error! status: ${response.status}`;
      const details = data.details ? ` ${data.details}` : '';
      throw new Error(msg + details);
    }

    return data;
  } catch (error) {
    throw error;
  }
};

/**
 * Admin Dashboard API
 */
export const dashboardAPI = {
  // Get dashboard statistics
  getStats: async () => {
    return apiRequest('/api/admin/dashboard');
  },
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
    });
  },

  // Get all notifications
  getNotifications: async (limit = 20) => {
    // Scheduled (pinned) + sent notifications for recent list
    return apiRequest(`/api/notifications?limit=${limit}`);
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
};
