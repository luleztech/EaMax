import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ActivityIndicator,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import AdModal from './AdModal';

const InsufficientPointsModal = ({
  visible,
  onClose,
  channelName,
  pointsRequired,
  userPoints,
  onWatchAd,
  onGoPremium,
  onPointsUpdated,
  channelsPremiumOnly = false,
}) => {
  const [adModalVisible, setAdModalVisible] = useState(false);
  const [watchingAds, setWatchingAds] = useState(false);
  const [currentPoints, setCurrentPoints] = useState(userPoints);
  const [showEarnMore, setShowEarnMore] = useState(false);

  // Update current points when userPoints prop changes
  useEffect(() => {
    setCurrentPoints(userPoints);
  }, [userPoints]);

  const handleWatchAd = () => {
    setWatchingAds(true);
    setShowEarnMore(false);
    // Call parent's onWatchAd to open the ad modal
    if (onWatchAd) {
      onWatchAd();
    }
    setAdModalVisible(true);
  };

  const handleAdComplete = async () => {
    setAdModalVisible(false);
    // Wait a bit for backend to update
    setTimeout(async () => {
      if (onPointsUpdated) {
        const updatedPoints = await onPointsUpdated();
        setCurrentPoints(updatedPoints);
        
        // Check if user now has enough points
        if (updatedPoints >= pointsRequired) {
          // User has enough points now, close modal
          setWatchingAds(false);
          setShowEarnMore(false);
          onClose();
        } else {
          // Still not enough, ask if they want to watch more
          setWatchingAds(false);
          setShowEarnMore(true);
        }
      }
    }, 1000);
  };

  const handleCloseAd = () => {
    setAdModalVisible(false);
    setWatchingAds(false);
    setShowEarnMore(false);
  };

  const handleGoPremium = () => {
    onClose();
    if (onGoPremium) {
      onGoPremium();
    }
  };

  const handleEarnMore = () => {
    setShowEarnMore(false);
    handleWatchAd();
  };

  const pointsNeeded = pointsRequired - currentPoints;

  return (
    <>
      <Modal
        visible={visible && !adModalVisible && !showEarnMore}
        transparent
        animationType="fade"
        onRequestClose={onClose}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={['#f59e0b', '#ea580c']}
                style={styles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <AntDesign name="star" size={32} color="#fff" />
              </LinearGradient>
            </View>

            <Text style={styles.modalTitle}>Hakuna Points Zinazotosha</Text>
            <Text style={styles.modalMessage}>
              {channelsPremiumOnly
                ? `Channel "${channelName}" inahitaji malipo. Nenda Premium kufungua.`
                : `Unahitaji points ${pointsRequired} kufungua channel "${channelName}". Una points ${currentPoints} tu. Tangazo 1 = 20 pts.`}
            </Text>

            {!channelsPremiumOnly && (
              <View style={styles.pointsInfo}>
                <View style={styles.pointsInfoRow}>
                  <Text style={styles.pointsInfoLabel}>Points Unazohitaji:</Text>
                  <Text style={styles.pointsInfoValue}>{pointsNeeded} pts</Text>
                </View>
                <View style={styles.pointsInfoRow}>
                  <Text style={styles.pointsInfoLabel}>Points Unazo:</Text>
                  <Text style={styles.pointsInfoValue}>{currentPoints} pts</Text>
                </View>
              </View>
            )}

            <View style={styles.buttonContainer}>
              {!channelsPremiumOnly && (
                <TouchableOpacity
                  style={styles.watchAdsButton}
                  onPress={handleWatchAd}
                  activeOpacity={0.8}>
                  <LinearGradient
                    colors={['#22c55e', '#16a34a']}
                    style={styles.buttonGradient}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}>
                    <Icon name="play-circle" size={20} color="#fff" />
                    <Text style={styles.watchAdsButtonText}>Angalia Matangazo</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.premiumButton}
                onPress={handleGoPremium}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={['#f59e0b', '#ea580c']}
                  style={styles.buttonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <AntDesign name="star" size={18} color="#fff" />
                  <Text style={styles.premiumButtonText}>Nenda Premium</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={onClose}
              activeOpacity={0.7}>
              <Text style={styles.cancelButtonText}>Funga</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Earn More Modal */}
      <Modal
        visible={showEarnMore && !adModalVisible}
        transparent
        animationType="fade"
        onRequestClose={handleCloseAd}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalContent}>
            <View style={styles.iconContainer}>
              <LinearGradient
                colors={['#22c55e', '#16a34a']}
                style={styles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <AntDesign name="plus" size={32} color="#fff" />
              </LinearGradient>
            </View>

            <Text style={styles.modalTitle}>Points Bado Hazitoshi</Text>
            <Text style={styles.modalMessage}>
              Una points {currentPoints} tu. Unahitaji points {pointsRequired} kufungua channel "{channelName}". Tangazo 1 = 20 pts.
            </Text>

            <View style={styles.pointsInfo}>
              <View style={styles.pointsInfoRow}>
                <Text style={styles.pointsInfoLabel}>Points Unazohitaji:</Text>
                <Text style={styles.pointsInfoValue}>{pointsNeeded} pts</Text>
              </View>
              <View style={styles.pointsInfoRow}>
                <Text style={styles.pointsInfoLabel}>Points Unazo:</Text>
                <Text style={styles.pointsInfoValue}>{currentPoints} pts</Text>
              </View>
            </View>

            <View style={styles.buttonContainer}>
              <TouchableOpacity
                style={styles.watchAdsButton}
                onPress={handleEarnMore}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={['#22c55e', '#16a34a']}
                  style={styles.buttonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <Icon name="play-circle" size={20} color="#fff" />
                  <Text style={styles.watchAdsButtonText}>Pata Points Zaidi</Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.premiumButton}
                onPress={handleGoPremium}
                activeOpacity={0.8}>
                <LinearGradient
                  colors={['#f59e0b', '#ea580c']}
                  style={styles.buttonGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <AntDesign name="star" size={18} color="#fff" />
                  <Text style={styles.premiumButtonText}>Nenda Premium</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <TouchableOpacity
              style={styles.cancelButton}
              onPress={handleCloseAd}
              activeOpacity={0.7}>
              <Text style={styles.cancelButtonText}>Funga</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      <AdModal
        visible={adModalVisible}
        onClose={handleCloseAd}
        onComplete={handleAdComplete}
      />
    </>
  );
};

const styles = StyleSheet.create({
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  modalContent: {
    backgroundColor: '#111827',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    borderWidth: 1,
    borderColor: '#374151',
    alignItems: 'center',
  },
  iconContainer: {
    marginBottom: 16,
  },
  iconGradient: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  modalMessage: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    marginBottom: 20,
    lineHeight: 20,
  },
  pointsInfo: {
    width: '100%',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    padding: 16,
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#374151',
  },
  pointsInfoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  pointsInfoLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  pointsInfoValue: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fbbf24',
  },
  buttonContainer: {
    width: '100%',
    gap: 12,
    marginBottom: 12,
  },
  watchAdsButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  premiumButton: {
    borderRadius: 12,
    overflow: 'hidden',
  },
  buttonGradient: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  watchAdsButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  premiumButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  cancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 20,
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 14,
    fontWeight: '600',
  },
});

export default InsufficientPointsModal;
