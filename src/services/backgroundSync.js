/**
 * Background sync service for continuous updates even when app is minimized
 * Uses AppState to detect app lifecycle changes
 */

import { AppState } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

class BackgroundSyncService {
  constructor() {
    this.appStateSubscription = null;
    this.syncTasks = new Map(); // Map of task ID to task callback
    this.syncInterval = null;
    this.isAppActive = true;
    this.lastSyncTime = new Map();
    this.minSyncInterval = 10000; // Minimum 10 seconds between syncs
  }

  /**
   * Initialize background sync service
   */
  initialize() {
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange.bind(this));
    console.log('[BackgroundSync] Service initialized');
  }

  /**
   * Cleanup background sync service
   */
  cleanup() {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
    }
    this.stopSyncTimer();
  }

  /**
   * Handle app state changes
   */
  handleAppStateChange(state) {
    if (state === 'active') {
      console.log('[BackgroundSync] App is now active');
      this.isAppActive = true;
      // Trigger sync immediately when app becomes active
      this.sync();
    } else if (state === 'background') {
      console.log('[BackgroundSync] App is now in background');
      this.isAppActive = false;
    }
  }

  /**
   * Register a sync task
   */
  registerTask(taskId, callback, interval = 30000) {
    this.syncTasks.set(taskId, {
      callback,
      interval,
      lastRun: 0,
    });
    console.log(`[BackgroundSync] Registered task: ${taskId}`);
  }

  /**
   * Unregister a sync task
   */
  unregisterTask(taskId) {
    this.syncTasks.delete(taskId);
    console.log(`[BackgroundSync] Unregistered task: ${taskId}`);
  }

  /**
   * Run sync for all registered tasks
   */
  async sync() {
    if (!this.syncTasks.size) {
      return;
    }

    const now = Date.now();
    const tasksToRun = [];

    // Check which tasks need to run
    for (const [taskId, task] of this.syncTasks.entries()) {
      const timeSinceLastRun = now - (task.lastRun || 0);
      if (timeSinceLastRun >= task.interval) {
        tasksToRun.push({ taskId, task });
      }
    }

    if (tasksToRun.length === 0) {
      return;
    }

    console.log(`[BackgroundSync] Running ${tasksToRun.length} sync tasks`);

    // Run all tasks in parallel
    const results = await Promise.allSettled(
      tasksToRun.map(async ({ taskId, task }) => {
        try {
          console.log(`[BackgroundSync] Running task: ${taskId}`);
          await task.callback();
          task.lastRun = now;
          this.lastSyncTime.set(taskId, now);
        } catch (error) {
          console.error(`[BackgroundSync] Task failed: ${taskId}`, error);
        }
      })
    );

    const successful = results.filter(r => r.status === 'fulfilled').length;
    console.log(`[BackgroundSync] Completed: ${successful}/${tasksToRun.length} tasks`);
  }

  /**
   * Start periodic sync timer
   */
  startSyncTimer(interval = 30000) {
    this.stopSyncTimer();
    this.syncInterval = setInterval(() => {
      if (this.isAppActive) {
        this.sync();
      }
    }, interval);
    console.log(`[BackgroundSync] Sync timer started (${interval}ms interval)`);
  }

  /**
   * Stop periodic sync timer
   */
  stopSyncTimer() {
    if (this.syncInterval) {
      clearInterval(this.syncInterval);
      this.syncInterval = null;
      console.log('[BackgroundSync] Sync timer stopped');
    }
  }

  /**
   * Get sync stats
   */
  getStats() {
    return {
      isAppActive: this.isAppActive,
      registeredTasks: this.syncTasks.size,
      tasks: Array.from(this.syncTasks.entries()).map(([taskId, task]) => ({
        taskId,
        interval: task.interval,
        lastRun: task.lastRun,
        lastSyncTime: this.lastSyncTime.get(taskId),
      })),
    };
  }
}

export const backgroundSyncService = new BackgroundSyncService();
export default backgroundSyncService;
