/**
 * Central app-version configuration.
 * All values are driven by environment variables so Railway can update them
 * without a code deploy.
 *
 * ENV variables:
 *   MIN_APP_VERSION       – oldest build that may access the API (semver, e.g. "1.3.5")
 *   LATEST_APP_VERSION    – current published version shown in the update prompt
 *   FORCE_UPDATE          – "true" makes the Flutter gate block the app
 *   MAINTENANCE_MODE      – "true" shows the maintenance screen
 *   MAINTENANCE_MESSAGE   – optional custom message
 *   PLAY_STORE_URL        – link shown on the force-update screen
 *   REQUIRE_APP_VERSION   – "true" enables HTTP-426 enforcement on API routes
 *   PLAY_INTEGRITY_ENABLED – "true" enables Play Integrity token verification
 */
module.exports = {
  get minimumSupportedVersion() { return process.env.MIN_APP_VERSION || '1.0.0'; },
  get latestVersion() { return process.env.LATEST_APP_VERSION || '1.3.5'; },
  get forceUpdate() { return process.env.FORCE_UPDATE === 'true'; },
  get maintenanceMode() { return process.env.MAINTENANCE_MODE === 'true'; },
  get maintenanceMessage() {
    return process.env.MAINTENANCE_MESSAGE || 'App iko chini ya matengenezo. Jaribu tena baadaye.';
  },
  get playStoreUrl() {
    return process.env.PLAY_STORE_URL || 'https://play.google.com/store/apps/details?id=com.eamax';
  },
  get updateTitle() {
    return process.env.UPDATE_TITLE || 'Update Required';
  },
  get updateMessage() {
    return process.env.UPDATE_MESSAGE || 'A new version is available. Please update to continue using the app.';
  },
  get requireAppVersion() { return process.env.REQUIRE_APP_VERSION === 'true'; },
  get playIntegrityEnabled() { return process.env.PLAY_INTEGRITY_ENABLED === 'true'; },
  get playIntegrityProjectNumber() { return process.env.PLAY_INTEGRITY_PROJECT_NUMBER || ''; },
};
