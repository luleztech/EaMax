import AsyncStorage from '@react-native-async-storage/async-storage';
import { userAPI } from '../config/api';

const STORAGE_KEY = 'userId';
const LEGACY_KEY = '@eamax:userId';
const REGISTRATION_RETRY_KEY = 'user_registration_pending';
const MAX_REGISTRATION_RETRIES = 5;

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
 * Register user with retry logic and exponential backoff.
 * This is critical - user MUST be in database for admin to find them.
 */
async function registerUserWithRetry(userId, maxRetries = MAX_REGISTRATION_RETRIES) {
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const result = await userAPI.register(userId);
      if (result && result.id) {
        console.log(`[UserRegistration] Success for ${userId} on attempt ${attempt}`);
        await AsyncStorage.removeItem(REGISTRATION_RETRY_KEY);
        return { success: true, user: result };
      }
    } catch (err) {
      const isRateLimited = err?.message?.includes('429') || err?.message?.toLowerCase()?.includes('maombi mengi');
      const isNetworkError = err?.message?.includes('Network') || err?.message?.includes('ECONNREFUSED') || err?.message?.includes('timeout');

      if (isRateLimited || isNetworkError) {
        const delayMs = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
        console.log(`[UserRegistration] Attempt ${attempt} failed for ${userId}, retrying in ${delayMs}ms...`, err?.message);
        await new Promise(resolve => setTimeout(resolve, delayMs));
      } else {
        console.error(`[UserRegistration] Attempt ${attempt} failed for ${userId} (non-retryable):`, err?.message);
        if (attempt === maxRetries) break;
      }
    }
  }

  console.error(`[UserRegistration] All ${maxRetries} attempts failed for ${userId}`);
  await AsyncStorage.setItem(REGISTRATION_RETRY_KEY, userId);
  return { success: false, error: 'Max retries exceeded' };
}

/**
 * Verify that user exists in database by fetching user details.
 * This ensures the user was actually created.
 */
async function verifyUserExists(userId) {
  try {
    const user = await userAPI.getUser(userId);
    return !!user && !!user.id;
  } catch (err) {
    console.warn(`[UserRegistration] Verification failed for ${userId}:`, err?.message);
    return false;
  }
}

/**
 * Background retry for pending registrations.
 * Call this periodically to ensure users eventually get registered.
 */
export async function retryPendingRegistrations() {
  try {
    const pendingUserId = await AsyncStorage.getItem(REGISTRATION_RETRY_KEY);
    if (!pendingUserId) return;

    console.log(`[UserRegistration] Retrying pending registration for ${pendingUserId}`);
    const result = await registerUserWithRetry(pendingUserId, 3);
    if (result.success) {
      console.log(`[UserRegistration] Pending registration succeeded for ${pendingUserId}`);
    }
  } catch (e) {
    console.error('[UserRegistration] Background retry error:', e?.message);
  }
}

/**
 * Get existing userId from storage or create + register one.
 * Call this on app load (StreamingApp) and before recording ad (AdModal) so points always work.
 * CRITICAL: Ensures user is actually created in database before returning.
 * @returns {Promise<string|null>} userId or null on failure
 */
export async function getOrCreateUserId() {
  try {
    // Check for existing user ID
    let userId = await AsyncStorage.getItem(STORAGE_KEY);
    if (userId && userId.trim()) {
      // Verify user exists in database (in case previous registration failed)
      const exists = await verifyUserExists(userId.trim());
      if (exists) {
        return userId.trim();
      }
      // User not in DB, need to register
      console.log(`[UserRegistration] User ${userId} not found in DB, registering...`);
    }

    // Check legacy storage
    const legacyId = await AsyncStorage.getItem(LEGACY_KEY);
    if (legacyId && legacyId.trim()) {
      await AsyncStorage.setItem(STORAGE_KEY, legacyId.trim());
      const result = await registerUserWithRetry(legacyId.trim());
      if (result.success) {
        return legacyId.trim();
      }
      // Return legacy ID even if registration failed - will retry in background
      return legacyId.trim();
    }

    // Generate new user ID
    userId = generateUserId();
    await AsyncStorage.setItem(STORAGE_KEY, userId);

    // CRITICAL: Register user in database with retries
    const result = await registerUserWithRetry(userId);

    if (result.success) {
      console.log(`[UserRegistration] New user ${userId} registered successfully`);
      return userId;
    }

    // Registration failed but we return the ID anyway - will retry in background
    // The user can still use the app, but admin won't see them until registration succeeds
    console.warn(`[UserRegistration] Returning userId ${userId} but registration pending - will retry`);

    // Start background retry after a delay
    setTimeout(() => retryPendingRegistrations(), 5000);

    return userId;
  } catch (e) {
    console.error('[UserRegistration] getOrCreateUserId error:', e?.message || e);
    return null;
  }
}
