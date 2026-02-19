import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { userAPI } from '../config/api';

let REWARDED_AD_UNIT_ID = null;
try {
  const adsConfig = require('../config/ads');
  if (adsConfig.REWARDED_AD_UNIT_ID) REWARDED_AD_UNIT_ID = adsConfig.REWARDED_AD_UNIT_ID;
} catch (e) {}

const POINTS_PER_REWARD = 20;

let RewardedAdModule = null;
let RewardedAdEventType = null;
let TestIds = null;
try {
  const ads = require('react-native-google-mobile-ads');
  RewardedAdModule = ads.RewardedAd;
  RewardedAdEventType = ads.RewardedAdEventType;
  TestIds = ads.TestIds;
} catch (e) {
  // Package not installed or not linked yet
}

const AdModal = ({ visible, onClose, onComplete }) => {
  const [status, setStatus] = useState('loading'); // 'loading' | 'showing' | 'rewarded' | 'error' | 'fallback'
  const [pointsEarned, setPointsEarned] = useState(POINTS_PER_REWARD);
  const rewardedAdRef = useRef(null);
  const earnedRewardRef = useRef(false);

  useEffect(() => {
    if (!visible) return;

    earnedRewardRef.current = false;
    setPointsEarned(POINTS_PER_REWARD);

    const showFallbackAndComplete = () => {
      setStatus('fallback');
      const t = setTimeout(async () => {
        try {
          const userId = await AsyncStorage.getItem('userId');
          if (userId) {
            const result = await userAPI.recordAdWatched(userId, POINTS_PER_REWARD);
            setPointsEarned(result.pointsAdded ?? POINTS_PER_REWARD);
          }
        } catch (err) {
          console.error('Fallback record ad:', err);
        }
        if (onComplete) onComplete();
        setStatus('rewarded');
      }, 3000);
      return () => clearTimeout(t);
    };

    if (!RewardedAdModule || !RewardedAdEventType) {
      showFallbackAndComplete();
      return;
    }

    let unsubLoaded, unsubEarned, unsubClosed, unsubError;
    try {
      const unitId = REWARDED_AD_UNIT_ID || 'ca-app-pub-5619803043988422/7188294959';
      const rewarded = RewardedAdModule.createForAdRequest(unitId, {
        requestNonPersonalizedAdsOnly: false,
      });

      unsubLoaded = rewarded.addAdEventListener(RewardedAdEventType.LOADED, () => {
        try {
          setStatus('showing');
          rewarded.show();
        } catch (e) {
          console.warn('Rewarded ad show error:', e);
          setStatus('error');
        }
      });

      unsubEarned = rewarded.addAdEventListener(RewardedAdEventType.EARNED_REWARD, () => {
        earnedRewardRef.current = true;
        recordAdWatchedAndComplete();
      });

      unsubClosed = rewarded.addAdEventListener(RewardedAdEventType.CLOSED, () => {
        if (earnedRewardRef.current) {
          setStatus('rewarded');
        } else {
          setStatus('closed');
          setTimeout(() => onClose && onClose(), 0);
        }
      });

      unsubError = rewarded.addAdEventListener(RewardedAdEventType.ERROR, (err) => {
        console.warn('Rewarded ad error:', err);
        setStatus('error');
      });

      rewardedAdRef.current = rewarded;
      setStatus('loading');
      rewarded.load();
    } catch (e) {
      console.warn('AdModal setup error:', e);
      showFallbackAndComplete();
      return;
    }

    return () => {
      try {
        if (typeof unsubLoaded === 'function') unsubLoaded();
        if (typeof unsubEarned === 'function') unsubEarned();
        if (typeof unsubClosed === 'function') unsubClosed();
        if (typeof unsubError === 'function') unsubError();
      } catch (e) {
        console.warn('AdModal cleanup:', e);
      }
    };
  }, [visible]);

  const recordAdWatchedAndComplete = async () => {
    try {
      const userId = await AsyncStorage.getItem('userId');
      if (userId) {
        const result = await userAPI.recordAdWatched(userId, POINTS_PER_REWARD);
        setPointsEarned(result.pointsAdded ?? POINTS_PER_REWARD);
      }
    } catch (error) {
      console.error('Failed to record ad watch:', error);
    }
    if (onComplete) onComplete();
  };

  const handleClose = () => {
    setStatus('loading');
    onClose();
  };

  const isRewardedScreen = status === 'rewarded' || (status === 'fallback' && pointsEarned > 0);
  const showError = status === 'error';
  if (status === 'closed') return null;

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {(status === 'loading' || status === 'fallback') && (
            <View style={styles.watchingContainer}>
              <ActivityIndicator size="large" color="#22c55e" />
              <Text style={styles.watchingTitle}>
                {status === 'fallback' ? 'Preparing reward...' : 'Loading ad...'}
              </Text>
              <Text style={styles.watchingSubtitle}>
                {status === 'fallback' ? `You'll get ${POINTS_PER_REWARD} points in a moment` : 'Please wait'}
              </Text>
            </View>
          )}

          {status === 'showing' && (
            <View style={styles.watchingContainer}>
              <Text style={styles.watchingTitle}>Watch the ad</Text>
              <Text style={styles.watchingSubtitle}>Complete the video to earn {POINTS_PER_REWARD} points</Text>
            </View>
          )}

          {showError && (
            <View style={styles.watchingContainer}>
              <Icon name="alert-circle" size={48} color="#ef4444" />
              <Text style={styles.watchingTitle}>Ad unavailable</Text>
              <Text style={styles.watchingSubtitle}>Try again later</Text>
              <TouchableOpacity style={styles.startButton} onPress={handleClose}>
                <Text style={styles.startButtonText}>Close</Text>
              </TouchableOpacity>
            </View>
          )}

          {isRewardedScreen && (
            <View style={styles.completeContainer}>
              <View style={styles.checkmarkContainer}>
                <Icon name="check" size={32} color="#fff" />
              </View>
              <Text style={styles.completeTitle}>Points earned!</Text>
              <Text style={styles.pointsEarned}>+{pointsEarned} pts</Text>
              <Text style={styles.completeSubtitle}>You can now use your points to watch</Text>
              <TouchableOpacity style={styles.startButton} onPress={handleClose}>
                <Text style={styles.startButtonText}>Done</Text>
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
  },
  completeContainer: {
    alignItems: 'center',
  },
  checkmarkContainer: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#22c55e',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  completeTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  pointsEarned: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#fbbf24',
    marginBottom: 8,
  },
  completeSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
  },
  startButton: {
    width: '100%',
    backgroundColor: '#22c55e',
    paddingVertical: 12,
    borderRadius: 20,
    alignItems: 'center',
  },
  startButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 16,
  },
});

export default AdModal;
