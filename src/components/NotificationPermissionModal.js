import React, { useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  Animated,
  Dimensions,
  Platform,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width, height } = Dimensions.get('window');

const NotificationPermissionModal = ({ visible, onAllow, onSkip }) => {
  const scaleAnim = useRef(new Animated.Value(0.85)).current;
  const opacityAnim = useRef(new Animated.Value(0)).current;
  const bellBounce = useRef(new Animated.Value(0)).current;
  const glowAnim = useRef(new Animated.Value(0)).current;
  const dot1Anim = useRef(new Animated.Value(0)).current;
  const dot2Anim = useRef(new Animated.Value(0)).current;
  const dot3Anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (visible) {
      // Card entrance animation
      Animated.parallel([
        Animated.spring(scaleAnim, {
          toValue: 1,
          tension: 65,
          friction: 8,
          useNativeDriver: true,
        }),
        Animated.timing(opacityAnim, {
          toValue: 1,
          duration: 300,
          useNativeDriver: true,
        }),
      ]).start();

      // Bell bounce loop
      Animated.loop(
        Animated.sequence([
          Animated.timing(bellBounce, { toValue: -8, duration: 180, useNativeDriver: true }),
          Animated.timing(bellBounce, { toValue: 8, duration: 180, useNativeDriver: true }),
          Animated.timing(bellBounce, { toValue: -5, duration: 140, useNativeDriver: true }),
          Animated.timing(bellBounce, { toValue: 5, duration: 140, useNativeDriver: true }),
          Animated.timing(bellBounce, { toValue: 0, duration: 120, useNativeDriver: true }),
          Animated.delay(2200),
        ])
      ).start();

      // Glow pulse
      Animated.loop(
        Animated.sequence([
          Animated.timing(glowAnim, { toValue: 1, duration: 1200, useNativeDriver: true }),
          Animated.timing(glowAnim, { toValue: 0, duration: 1200, useNativeDriver: true }),
        ])
      ).start();

      // Ripple dots staggered
      const ripple = (anim, delay) =>
        Animated.loop(
          Animated.sequence([
            Animated.delay(delay),
            Animated.timing(anim, { toValue: 1, duration: 800, useNativeDriver: true }),
            Animated.timing(anim, { toValue: 0, duration: 800, useNativeDriver: true }),
            Animated.delay(600),
          ])
        ).start();

      ripple(dot1Anim, 0);
      ripple(dot2Anim, 300);
      ripple(dot3Anim, 600);
    } else {
      scaleAnim.setValue(0.85);
      opacityAnim.setValue(0);
      bellBounce.setValue(0);
      glowAnim.setValue(0);
      dot1Anim.setValue(0);
      dot2Anim.setValue(0);
      dot3Anim.setValue(0);
    }
  }, [visible, bellBounce, glowAnim, dot1Anim, dot2Anim, dot3Anim, opacityAnim, scaleAnim]);

  const glowOpacity = glowAnim.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.9] });

  const features = [
    { icon: 'soccer', label: 'Matangazo ya mechi za moja kwa moja' },
    { icon: 'television-play', label: 'Channels mpya na maudhui ya kipekee' },
    { icon: 'star-circle', label: 'Ofa maalum za Premium za kwanza' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="none"
      statusBarTranslucent
      onRequestClose={onSkip}>
      <View style={styles.overlay}>
        {/* Background blur layer */}
        <View style={styles.backdropBlur} />

        <Animated.View
          style={[
            styles.card,
            {
              opacity: opacityAnim,
              transform: [{ scale: scaleAnim }],
            },
          ]}>
          {/* Top gradient header */}
          <LinearGradient
            colors={['#16a34a', '#15803d', '#166534']}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={styles.header}>
            {/* Ripple rings */}
            {[dot1Anim, dot2Anim, dot3Anim].map((anim, i) => (
              <Animated.View
                key={i}
                style={[
                  styles.rippleRing,
                  {
                    width: 80 + i * 36,
                    height: 80 + i * 36,
                    borderRadius: (80 + i * 36) / 2,
                    opacity: anim.interpolate({ inputRange: [0, 1], outputRange: [0.25 - i * 0.06, 0] }),
                    transform: [
                      {
                        scale: anim.interpolate({ inputRange: [0, 1], outputRange: [0.7, 1.4] }),
                      },
                    ],
                  },
                ]}
              />
            ))}

            {/* Bell icon with glow */}
            <Animated.View
              style={[
                styles.bellGlow,
                { opacity: glowOpacity },
              ]}
            />
            <Animated.View
              style={[
                styles.bellWrap,
                { transform: [{ rotate: bellBounce.interpolate({ inputRange: [-8, 8], outputRange: ['-18deg', '18deg'] }) }] },
              ]}>
              <Icon name="bell-ring" size={44} color="#fff" />
            </Animated.View>

            <Text style={styles.headerTitle}>Wezesha Arifa</Text>
            <Text style={styles.headerSubtitle}>Usiache kitu chochote muhimu</Text>
          </LinearGradient>

          {/* Body */}
          <View style={styles.body}>
            <Text style={styles.bodyText}>
              Pokea arifa mara moja kuhusu:
            </Text>

            {features.map((f, i) => (
              <View key={i} style={styles.featureRow}>
                <LinearGradient
                  colors={['#16a34a', '#15803d']}
                  style={styles.featureIconWrap}>
                  <Icon name={f.icon} size={16} color="#fff" />
                </LinearGradient>
                <Text style={styles.featureText}>{f.label}</Text>
              </View>
            ))}

            <View style={styles.divider} />

            <Text style={styles.noteText}>
              Arifa zitaonekana kwenye kifa cha simu yako (kama WhatsApp, YouTube) hata app ikiwa imefungwa. Unaweza kuzima wakati wowote kwenye mipangilio.
            </Text>

            {/* Allow button */}
            <TouchableOpacity
              style={styles.allowButtonWrap}
              onPress={onAllow}
              activeOpacity={0.88}>
              <LinearGradient
                colors={['#22c55e', '#16a34a', '#15803d']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 0 }}
                style={styles.allowButton}>
                <Icon name="bell-check" size={20} color="#fff" style={styles.allowIcon} />
                <Text style={styles.allowButtonText}>Ruhusu Arifa</Text>
              </LinearGradient>
            </TouchableOpacity>

            {/* Skip button */}
            <TouchableOpacity
              style={styles.skipButton}
              onPress={onSkip}
              activeOpacity={0.7}>
              <Text style={styles.skipButtonText}>Sio sasa hivi</Text>
            </TouchableOpacity>
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.82)',
    paddingHorizontal: 20,
  },
  backdropBlur: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(3, 7, 18, 0.6)',
  },
  card: {
    width: '100%',
    maxWidth: 380,
    borderRadius: 24,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: 'rgba(34, 197, 94, 0.25)',
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.3,
    shadowRadius: 24,
    elevation: 20,
  },
  header: {
    paddingTop: 36,
    paddingBottom: 28,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  rippleRing: {
    position: 'absolute',
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  bellGlow: {
    position: 'absolute',
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.18)',
  },
  bellWrap: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 14,
    borderWidth: 2,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  headerTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.75)',
    letterSpacing: 0.2,
  },
  body: {
    padding: 24,
  },
  bodyText: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 16,
    fontWeight: '500',
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
    gap: 12,
  },
  featureIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    flexShrink: 0,
  },
  featureText: {
    flex: 1,
    fontSize: 14,
    color: '#d1d5db',
    lineHeight: 20,
  },
  divider: {
    height: 1,
    backgroundColor: 'rgba(55, 65, 81, 0.8)',
    marginVertical: 18,
  },
  noteText: {
    fontSize: 12,
    color: '#6b7280',
    lineHeight: 18,
    textAlign: 'center',
    marginBottom: 20,
  },
  allowButtonWrap: {
    borderRadius: 16,
    overflow: 'hidden',
    marginBottom: 10,
    shadowColor: '#22c55e',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  allowButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 16,
    borderRadius: 16,
    gap: 8,
  },
  allowIcon: {
    marginRight: 2,
  },
  allowButtonText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    letterSpacing: 0.4,
  },
  skipButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  skipButtonText: {
    fontSize: 13,
    color: '#4b5563',
    fontWeight: '500',
  },
});

export default NotificationPermissionModal;
