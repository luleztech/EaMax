/**
 * Play Integrity verification helper.
 *
 * This module is intentionally modular and separate from the main API
 * enforcement path. It is designed so the backend can evolve from a
 * stub/proof-of-concept to a full Google Play Integrity verification
 * service without breaking the existing update gate.
 */
const config = require('../config/appVersionConfig');

function isPlayIntegrityEnabled() {
  return config.playIntegrityEnabled;
}

async function verifyPlayIntegrityToken(playIntegrityToken) {
  if (!isPlayIntegrityEnabled()) {
    return { success: true, reason: 'disabled' };
  }

  if (!playIntegrityToken) {
    return { success: false, reason: 'missing_play_integrity_token' };
  }

  // TODO: Implement remote Play Integrity token validation against Google's
  // integrity API. The verification flow should:
  // 1. Accept the token from the client via a secure POST.
  // 2. Validate it using Google Play Integrity public keys.
  // 3. Confirm the package name, app version, and install origin.
  // 4. Reject tokens that fail signature or payload requirements.

  return {
    success: false,
    reason: 'play_integrity_verification_not_implemented',
  };
}

module.exports = {
  isPlayIntegrityEnabled,
  verifyPlayIntegrityToken,
};
