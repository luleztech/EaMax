import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';

const POINTS_PER_AD = 20;

const ChannelUnlockModal = ({
  visible,
  onClose,
  channelName,
  pointsRequired,
  currentPoints,
  onUnlock,
  onWatchAd,
  onGoPremium,
}) => {
  const canUnlockWithPoints = pointsRequired > 0 && currentPoints >= pointsRequired;
  const isPremiumOnly = pointsRequired === 0;

  const handleUnlock = () => {
    onClose();
    if (onUnlock) onUnlock();
  };

  const handleWatchAd = () => {
    onClose();
    if (onWatchAd) onWatchAd();
  };

  const handleGoPremium = () => {
    onClose();
    if (onGoPremium) onGoPremium();
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}>
      <View style={styles.overlay}>
        <View style={styles.card}>
          <LinearGradient
            colors={['#1f2937', '#111827']}
            style={styles.cardGradient}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}>
            <View style={styles.iconWrap}>
              <LinearGradient
                colors={['#a855f7', '#7c3aed']}
                style={styles.iconGradient}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <Icon name="lock-open-variant" size={36} color="#fff" />
              </LinearGradient>
            </View>

            <Text style={styles.title}>Fungua Channel</Text>
            <Text style={styles.message}>
              Lipa kwa points au Fanya malipo kufungua channel hii. Points ni bure kwa kutazama matangazo.
            </Text>

            {!isPremiumOnly && (
              <View style={styles.pointsBar}>
                <Text style={styles.pointsLabel}>Points unazohitaji: {pointsRequired} pts</Text>
                <Text style={styles.pointsLabel}>Una: {currentPoints} pts</Text>
              </View>
            )}

            <View style={styles.actions}>
              {canUnlockWithPoints && (
                <TouchableOpacity
                  style={styles.primaryBtnWrap}
                  onPress={handleUnlock}
                  activeOpacity={0.85}>
                  <LinearGradient
                    colors={['#22c55e', '#16a34a']}
                    style={styles.primaryBtn}
                    start={{ x: 0, y: 0 }}
                    end={{ x: 1, y: 1 }}>
                    <Icon name="play-circle" size={22} color="#fff" />
                    <Text style={styles.primaryBtnText}>Fungua sasa ({pointsRequired} pts)</Text>
                  </LinearGradient>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                style={styles.secondaryBtnWrap}
                onPress={handleWatchAd}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={['#3b82f6', '#2563eb']}
                  style={styles.secondaryBtn}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <Icon name="television" size={20} color="#fff" />
                  <Text style={styles.secondaryBtnText}>
                    Angalia matangazo (pata {POINTS_PER_AD} pts)
                  </Text>
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.premiumBtnWrap}
                onPress={handleGoPremium}
                activeOpacity={0.85}>
                <LinearGradient
                  colors={['#f59e0b', '#ea580c']}
                  style={styles.premiumBtn}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <AntDesign name="star" size={18} color="#fff" />
                  <Text style={styles.premiumBtnText}>Fanya malipo (Nenda Premium)</Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>

            <TouchableOpacity style={styles.cancelBtn} onPress={onClose} activeOpacity={0.7}>
              <Text style={styles.cancelBtnText}>Funga</Text>
            </TouchableOpacity>
          </LinearGradient>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.85)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    shadowColor: '#a855f7',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 16,
    elevation: 12,
  },
  cardGradient: {
    padding: 28,
    alignItems: 'center',
  },
  iconWrap: {
    marginBottom: 16,
  },
  iconGradient: {
    width: 72,
    height: 72,
    borderRadius: 36,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 10,
    textAlign: 'center',
  },
  message: {
    fontSize: 15,
    color: '#d1d5db',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 20,
    paddingHorizontal: 8,
  },
  pointsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    width: '100%',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: '#374151',
  },
  pointsLabel: {
    fontSize: 14,
    color: '#9ca3af',
  },
  actions: {
    width: '100%',
    gap: 12,
    marginBottom: 16,
  },
  primaryBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  primaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
  },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  secondaryBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
  },
  secondaryBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  premiumBtnWrap: {
    borderRadius: 14,
    overflow: 'hidden',
  },
  premiumBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
  },
  premiumBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '600',
  },
  cancelBtn: {
    paddingVertical: 10,
    paddingHorizontal: 24,
  },
  cancelBtnText: {
    color: '#9ca3af',
    fontSize: 15,
    fontWeight: '600',
  },
});

export default ChannelUnlockModal;
