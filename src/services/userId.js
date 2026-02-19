import AsyncStorage from '@react-native-async-storage/async-storage';
import { userAPI } from '../config/api';

const STORAGE_KEY = 'userId';
const LEGACY_KEY = '@eamax:userId';

/**
 * Generate a unique user ID (same format as ProfileScreen).
 * Used so we can create the user as soon as the app loads (home screen), even before they open Profile.
 */
export function generateUserId() {
  const prefix = 'User-';
  const randomChars = 'ABCDEF0123456789';
  let randomPart = '';
  for (let i = 0; i < 5; i++) {
    randomPart += randomChars.charAt(Math.floor(Math.random() * randomChars.length));
  }
  return prefix + randomPart;
}

/**
 * Get existing userId from storage or create + register one.
 * Call this on app load (StreamingApp) and before recording ad (AdModal) so points always work.
 * @returns {Promise<string|null>} userId or null on failure
 */
export async function getOrCreateUserId() {
  try {
    let userId = await AsyncStorage.getItem(STORAGE_KEY);
    if (userId && userId.trim()) {
      return userId.trim();
    }
    const legacyId = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacyId && legacyId.trim()) {
      await AsyncStorage.setItem(STORAGE_KEY, legacyId.trim());
      await userAPI.register(legacyId.trim()).catch(() => {});
      return legacyId.trim();
    }
    userId = generateUserId();
    await AsyncStorage.setItem(STORAGE_KEY, userId);
    await userAPI.register(userId).catch((err) => {
      console.warn('[userId] Register failed:', err?.message || err);
    });
    return userId;
  } catch (e) {
    console.warn('[userId] getOrCreateUserId error:', e?.message || e);
    return null;
  }
}
