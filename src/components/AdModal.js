import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { RewardedAd, RewardedAdEventType, AdEventType } from 'react-native-google-mobile-ads';
import { 
  REWARDED_AD_UNIT_ID, 
  getPreloadedRewardedAd, 
  preloadRewardedAd 
} from '../config/ads';
import { userAPI } from '../config/api';
import { getOrCreateUserId } from '../services/userId';

const POINTS_PER_REWARD = 20;
const MAX_AUTO_RETRIES = 2;

const AdModal = ({ visible, onClose, onComplete }) => {
  const [status, setStatus] = useState('loading'); // 'loading' | 'showing' | 'rewarded' | 'error' | 'closed'
  const [pointsEarned, setPointsEarned] = useState(POINTS_PER_REWARD);
  const rewardedAdRef = useRef(null);
  const earnedRewardRef = useRef(false);
  const loadRetriesRef = useRef(0);
  const cleanupRef = useRef(null);
  // Only show one ad per modal open unless user taps "Angalia tena". Prevents effect re-run from showing another ad.
  const hasStartedAdThisOpenRef = useRef(false);
  const loadAdRef = useRef(loadAd);
  const usePreloadedAndShowRef = useRef(usePreloadedAndShow);

  const recordAdWatchedAndComplete = useCallback(async () => {
    try {
      const userId = await getOrCreateUserId();
      if (userId) {
        console.log('[AdModal] Recording ad watch for user:', userId);
        const result = await userAPI.recordAdWatched(userId, POINTS_PER_REWARD);
        setPointsEarned(result.pointsAdded ?? POINTS_PER_REWARD);
        console.log('[AdModal] Points earned:', result.pointsAdded ?? POINTS_PER_REWARD);
      }
    } catch (error) {
      console.error('[AdModal] Failed to record ad watch:', error);
    }
    if (onComplete) onComplete();
  }, [onComplete]);

  const loadAd = useCallback(() => {
    try {
      const unitId = REWARDED_AD_UNIT_ID;
      
      if (!unitId) {
        console.error('[AdModal] No ad unit ID available');
        setStatus('error');
        return;
      }

      // Clean up previous listeners
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }

      earnedRewardRef.current = false;
      setPointsEarned(POINTS_PER_REWARD);
      setStatus('loading');

      console.log('[AdModal] Creating new ad request');
      let unsubLoaded, unsubEarned, unsubClosed, unsubError;
      
      const rewarded = RewardedAd.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: false,
      });

      unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        console.log('[AdModal] Ad loaded successfully');
        try {
          setStatus('showing');
          rewarded.show();
        } catch (e) {
          console.warn('[AdModal] Rewarded ad show error:', e);
          setStatus('error');
        }
      });

      unsubEarned = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, (reward) => {
        console.log('[AdModal] User earned reward:', reward);
        earnedRewardRef.current = true;
        recordAdWatchedAndComplete();
      });

      unsubClosed = rewarded.addAdEventListener(AdEventType.CLOSED, () => {
        console.log('[AdModal] Ad closed');
        preloadRewardedAd(); // Preload next ad
        if (earnedRewardRef.current) {
          setStatus('rewarded');
        } else {
          setStatus('closed');
        }
      });

      unsubError = rewarded.addAdEventListener(AdEventType.ERROR, (error) => {
        console.error('[AdModal] Rewarded ad error:', error);
        
        if (loadRetriesRef.current < MAX_AUTO_RETRIES) {
          loadRetriesRef.current += 1;
          console.log(`[AdModal] Retrying ad load (${loadRetriesRef.current}/${MAX_AUTO_RETRIES})`);
          setStatus('loading');
          
          const retryUnitId = REWARDED_AD_UNIT_ID;
          const newAd = RewardedAd.createForAdRequest(retryUnitId, { 
            requestNonPersonalizedAdsOnly: false 
          });
          
          newAd.addAdEventListener(RewardedAdEventType.LOADED, () => {
            console.log('[AdModal] Retry ad loaded successfully');
            setStatus('showing');
            newAd.show();
          });
          
          newAd.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
            earnedRewardRef.current = true;
            recordAdWatchedAndComplete();
          });
          
          newAd.addAdEventListener(AdEventType.CLOSED, () => {
            if (earnedRewardRef.current) {
              setStatus('rewarded');
            } else { 
              setStatus('closed');
            }
          });
          
          newAd.addAdEventListener(AdEventType.ERROR, (retryError) => {
            console.error('[AdModal] Retry ad error:', retryError);
            setStatus('error');
          });
          
          rewardedAdRef.current = newAd;
          newAd.load();
        } else {
          console.log('[AdModal] Max retries reached, showing error');
          setStatus('error');
        }
      });

      rewardedAdRef.current = rewarded;
      rewarded.load();

      // Store cleanup function
      cleanupRef.current = () => {
        try {
          if (typeof unsubLoaded === 'function') unsubLoaded();
          if (typeof unsubEarned === 'function') unsubEarned();
          if (typeof unsubClosed === 'function') unsubClosed();
          if (typeof unsubError === 'function') unsubError();
        } catch (e) {
          console.warn('[AdModal] Cleanup error:', e);
        }
      };
    } catch (e) {
      console.error('[AdModal] LoadAd error:', e);
      setStatus('error');
    }
  }, [recordAdWatchedAndComplete]);

  const usePreloadedAndShow = useCallback((ad) => {
    console.log('[AdModal] Using preloaded ad');
    earnedRewardRef.current = false;
    setPointsEarned(POINTS_PER_REWARD);
    setStatus('showing');
    rewardedAdRef.current = ad;
    
    const unsubEarned = ad.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
      console.log('[AdModal] Preloaded ad: earned reward');
      earnedRewardRef.current = true;
      recordAdWatchedAndComplete();
    });
    
    const unsubClosed = ad.addAdEventListener(AdEventType.CLOSED, () => {
      console.log('[AdModal] Preloaded ad: closed');
      if (earnedRewardRef.current) {
        setStatus('rewarded');
      } else { 
        setStatus('closed');
      }
      preloadRewardedAd();
    });
    
    const unsubError = ad.addAdEventListener(AdEventType.ERROR, (error) => {
      console.error('[AdModal] Preloaded ad error:', error);
      setStatus('error');
    });
    
    cleanupRef.current = () => {
      try { 
        unsubEarned(); 
        unsubClosed(); 
        unsubError(); 
      } catch (e) { 
        console.warn('[AdModal] Cleanup error:', e); 
      }
    };
    
    try { 
      ad.show(); 
    } catch (e) { 
      console.error('[AdModal] Preloaded ad show error:', e); 
      setStatus('error'); 
    }
  }, [recordAdWatchedAndComplete]);

  loadAdRef.current = loadAd;
  usePreloadedAndShowRef.current = usePreloadedAndShow;

  // Only when visible changes. Do NOT depend on loadAd/usePreloadedAndShow so parent re-renders never re-run this.
  // Session guard: only start one ad per open; "Angalia tena" is the only way to show another.
  useEffect(() => {
    if (!visible) {
      setStatus('loading');
      earnedRewardRef.current = false;
      hasStartedAdThisOpenRef.current = false;
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
      return;
    }

    // Already started an ad this open (e.g. effect ran twice in Strict Mode) – do nothing.
    if (hasStartedAdThisOpenRef.current) {
      return;
    }
    hasStartedAdThisOpenRef.current = true;

    console.log('[AdModal] Modal opened – loading one ad (user must tap Angalia tena for more)');
    loadRetriesRef.current = 0;
    try {
      const preloaded = getPreloadedRewardedAd();
      if (preloaded) {
        usePreloadedAndShowRef.current(preloaded);
      } else {
        loadAdRef.current();
      }
    } catch (e) {
      console.error('[AdModal] Open error:', e);
      hasStartedAdThisOpenRef.current = false;
      setStatus('error');
    }
    return () => {
      if (cleanupRef.current) {
        cleanupRef.current();
        cleanupRef.current = null;
      }
    };
  }, [visible]);

  const handleRetry = () => {
    console.log('[AdModal] User tapped Retry');
    loadRetriesRef.current = 0;
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    loadAdRef.current();
  };

  const handleWatchAgain = () => {
    console.log('[AdModal] User tapped Angalia tena – loading one more ad');
    loadRetriesRef.current = 0;
    earnedRewardRef.current = false;
    if (cleanupRef.current) {
      cleanupRef.current();
      cleanupRef.current = null;
    }
    setStatus('loading');
    try {
      const preloaded = getPreloadedRewardedAd();
      if (preloaded) {
        usePreloadedAndShowRef.current(preloaded);
      } else {
        loadAdRef.current();
      }
    } catch (e) {
      console.error('[AdModal] Watch again error:', e);
      setStatus('error');
    }
  };

  const handleClose = () => {
    console.log('[AdModal] Closing modal');
    setStatus('loading');
    earnedRewardRef.current = false;
    onClose();
  };

  // Auto-close when status is closed
  useEffect(() => {
    if (status === 'closed' && onClose) {
      const timer = setTimeout(() => {
        onClose();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [status, onClose]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {status === 'closed' && (
            <View style={styles.watchingContainer}>
              <ActivityIndicator size="small" color="#22c55e" />
              <Text style={styles.watchingSubtitle}>Closing...</Text>
            </View>
          )}
          
          {status === 'loading' && !status === 'closed' && (
            <View style={styles.watchingContainer}>
              <ActivityIndicator size="large" color="#22c55e" />
              <Text style={styles.watchingTitle}>Loading ad...</Text>
              <Text style={styles.watchingSubtitle}>Please wait a moment</Text>
            </View>
          )}

          {status === 'showing' && (
            <View style={styles.watchingContainer}>
              <Icon name="play-circle" size={48} color="#22c55e" />
              <Text style={styles.watchingTitle}>Watch the ad</Text>
              <Text style={styles.watchingSubtitle}>Complete the video to earn {POINTS_PER_REWARD} points</Text>
            </View>
          )}

          {status === 'error' && (
            <View style={styles.watchingContainer}>
              <Icon name="alert-circle" size={48} color="#ef4444" />
              <Text style={styles.watchingTitle}>Ad unavailable</Text>
              <Text style={styles.watchingSubtitle}>The ad could not load. Tap Retry or try again later.</Text>
              <View style={styles.errorButtons}>
                <TouchableOpacity 
                  style={[styles.startButton, styles.retryButton]} 
                  onPress={handleRetry}
                  activeOpacity={0.8}>
                  <Text style={styles.startButtonText}>Retry</Text>
                </TouchableOpacity>
                <TouchableOpacity 
                  style={[styles.startButton, styles.closeButton]} 
                  onPress={handleClose}
                  activeOpacity={0.8}>
                  <Text style={styles.startButtonText}>Close</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

          {status === 'rewarded' && (
            <View style={styles.completeContainer}>
              <View style={styles.checkmarkContainer}>
                <Icon name="check" size={32} color="#fff" />
              </View>
              <Text style={styles.completeTitle}>Points earned!</Text>
              <Text style={styles.pointsEarned}>+{pointsEarned} pts</Text>
              <Text style={styles.completeSubtitle}>You can now use your points to watch matches</Text>
              <TouchableOpacity
                style={[styles.startButton, styles.retryButton]}
                onPress={handleWatchAgain}
                activeOpacity={0.8}>
                <Text style={styles.startButtonText}>Angalia tena (pata point zaidi)</Text>
              </TouchableOpacity>
              <TouchableOpacity 
                style={[styles.startButton, styles.closeButton]} 
                onPress={handleClose}
                activeOpacity={0.8}>
                <Text style={styles.startButtonText}>Maliza</Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 16,
  },
  modalContent: {
    backgroundColor: '#111827',
    borderRadius: 16,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#374151',
  },
  watchingContainer: {
    alignItems: 'center',
    paddingVertical: 24,
  },
  watchingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 16,
    marginBottom: 8,
  },
  watchingSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
    textAlign: 'center',
  },
  completeContainer: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  checkmarkContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  completeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  pointsEarned: {
    fontSize: 36,
    fontWeight: 'bold',
    color: '#fbbf24',
    marginBottom: 8,
  },
  completeSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
    textAlign: 'center',
  },
  errorButtons: {
    width: '100%',
    marginTop: 16,
  },
  startButton: {
    width: '100%',
    backgroundColor: '#22c55e',
    paddingVertical: 14,
    borderRadius: 25,
    alignItems: 'center',
    marginTop: 8,
  },
  retryButton: {
    backgroundColor: '#3b82f6',
  },
  closeButton: {
    backgroundColor: '#6b7280',
  },
  startButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default AdModal;