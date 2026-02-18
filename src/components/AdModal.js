import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import { userAPI } from '../config/api';

const AdModal = ({ visible, onClose, onComplete }) => {
  const [progress, setProgress] = useState(0);
  const [isWatching, setIsWatching] = useState(true);
  const [isComplete, setIsComplete] = useState(false);
  const [pointsEarned, setPointsEarned] = useState(20);
  const progressAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      setProgress(0);
      setIsWatching(true);
      setIsComplete(false);
      startAdProgress();
    }
  }, [visible]);

  const startAdProgress = () => {
    let currentProgress = 0;
    progressAnim.setValue(0);
    const interval = setInterval(() => {
      currentProgress += 5;
      setProgress(currentProgress);
      progressAnim.setValue(currentProgress);

      if (currentProgress >= 100) {
        clearInterval(interval);
        setTimeout(async () => {
          // Record ad watched with backend
          try {
            const userId = await AsyncStorage.getItem('userId');
            if (userId) {
              const result = await userAPI.recordAdWatched(userId, 20);
              setPointsEarned(result.pointsAdded ?? 20);
            }
          } catch (error) {
            console.error('Failed to record ad watch:', error);
            // Continue with default points if API fails
          }
          
          setIsWatching(false);
          setIsComplete(true);
          if (onComplete) {
            onComplete();
          }
        }, 500);
      }
    }, 150);
  };

  const handleClose = () => {
    setProgress(0);
    setIsWatching(true);
    setIsComplete(false);
    onClose();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={handleClose}>
      <View style={styles.modalOverlay}>
        <View style={styles.modalContent}>
          {isWatching && (
            <View style={styles.watchingContainer}>
              <Text style={styles.watchingTitle}>Watching Ad...</Text>
              <Text style={styles.watchingSubtitle}>Earning your points</Text>
              <View style={styles.progressBarContainer}>
                <Animated.View
                  style={[
                    styles.progressBar,
                    {
                      width: progressAnim.interpolate({
                        inputRange: [0, 100],
                        outputRange: ['0%', '100%'],
                      }),
                    },
                  ]}
                />
              </View>
              <LinearGradient
                colors={['#1e3a8a', '#9333ea']}
                style={styles.adContent}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <Text style={styles.adTitle}>Ad Content Here</Text>
                <Text style={styles.adSubtitle}>Sample Advertisement</Text>
              </LinearGradient>
            </View>
          )}

          {isComplete && (
            <View style={styles.completeContainer}>
              <View style={styles.checkmarkContainer}>
                <Icon name="check" size={32} color="#fff" />
              </View>
              <Text style={styles.completeTitle}>Points Earned!</Text>
              <Text style={styles.pointsEarned}>+{pointsEarned} pts</Text>
              <Text style={styles.completeSubtitle}>
                You can now start streaming
              </Text>
              <TouchableOpacity
                style={styles.startButton}
                onPress={handleClose}>
                <Text style={styles.startButtonText}>Start Watching</Text>
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
  },
  watchingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  watchingSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
  },
  progressBarContainer: {
    width: '100%',
    height: 12,
    backgroundColor: '#1f2937',
    borderRadius: 6,
    overflow: 'hidden',
    marginBottom: 16,
  },
  progressBar: {
    height: '100%',
    backgroundColor: '#22c55e',
    borderRadius: 6,
  },
  adContent: {
    width: '100%',
    height: 192,
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  adTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
  },
  adSubtitle: {
    fontSize: 14,
    color: '#d1d5db',
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
