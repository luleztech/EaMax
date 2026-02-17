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
    const data = await response.json();
    
    if (!response.ok) {
      throw new Error(data.error || `HTTP error! status: ${response.status}`);
    }
    
    return data;
  } catch (error) {
    console.error('API Request Error:', error);
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

  // Record ad watched and earn points
  recordAdWatched: async (externalId, points = 10) => {
    return apiRequest(`/api/users/${externalId}/ads/watched`, {
      method: 'POST',
      body: JSON.stringify({ points }),
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

export default {
  API_BASE_URL,
  userAPI,
  channelsAPI,
  notificationsAPI,
};
