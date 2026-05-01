import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminNotificationsAPI } from '../config/api';

/** Default category for API + app payload data (backend requires a value). */
const DEFAULT_CATEGORY = 'habari';

const NotificationsPanel = ({ visible, onClose, onNotificationSent }) => {
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: null, text: '' });

  const clearStatusSoon = (ms = 6000) => {
    setTimeout(() => setStatusMessage({ type: null, text: '' }), ms);
  };

  const handleSend = async () => {
    const t = title.trim();
    const m = message.trim();
    if (!t || !m) {
      setStatusMessage({ type: 'error', text: 'Enter both title and message.' });
      clearStatusSoon(4000);
      return;
    }

    setLoading(true);
    setStatusMessage({ type: null, text: '' });

    try {
      const notificationData = {
        title: t,
        message: m,
        category: DEFAULT_CATEGORY,
        type: 'normal',
      };

      const result = await adminNotificationsAPI.createNotification(notificationData);

      if (result?.pushError) {
        setStatusMessage({
          type: 'error',
          text:
            `Could not reach devices.\n${result.pushError}\n\nSet FIREBASE_SERVICE_ACCOUNT_KEY on the server if missing.`,
        });
        clearStatusSoon(12000);
        return;
      }

      const sentCount = result?.sent_count ?? result?.total_devices ?? 0;
      const delivery = result?.delivery;
      const topicHint =
        delivery?.topic || result?.topic
          ? ` Topic: ${delivery?.topic || result?.topic}${delivery?.strategy ? ` (${delivery.strategy})` : ''}.`
          : '';

      const successText =
        sentCount > 0
          ? `Broadcast queued (${sentCount}).${topicHint} All active app devices with notifications enabled will receive it.`
          : `Sent.${topicHint}`;

      setStatusMessage({ type: 'success', text: successText });

      if (onNotificationSent) onNotificationSent();

      setTimeout(() => {
        setTitle('');
        setMessage('');
        setStatusMessage({ type: null, text: '' });
        onClose();
      }, 900);
    } catch (error) {
      console.error('Error sending notification:', error);
      let text = error.message || 'Failed to send. Try again.';
      if (
        text.includes('Internal server error') ||
        text.includes('500') ||
        text.includes('ADMIN_API_KEY')
      ) {
        text = 'Server error: check ADMIN_API_KEY and Firebase config on the server.';
      }
      if (text.includes('Unauthorized') || text.includes('401')) {
        text = 'Unauthorized: admin API key does not match the server.';
      }
      setStatusMessage({ type: 'error', text });
      clearStatusSoon(10000);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setMessage('');
    setStatusMessage({ type: null, text: '' });
    onClose();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={handleClose}>
      <SafeAreaView style={styles.modalContainer}>
        <LinearGradient
          colors={['#030712', '#111827', '#1f2937']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        <KeyboardAvoidingView
          style={styles.keyboardView}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <View style={styles.headerIconWrap}>
                <Icon name="bell-ring" size={22} color="#e9d5ff" />
              </View>
              <View>
                <Text style={styles.headerTitle}>Send notification</Text>
                <Text style={styles.headerSubtitle}>Title and message · broadcast to app users</Text>
              </View>
            </View>
            <TouchableOpacity onPress={handleClose} style={styles.closeButton} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
              <Icon name="close" size={24} color="#9ca3af" />
            </TouchableOpacity>
          </View>

          <ScrollView
            style={styles.content}
            contentContainerStyle={styles.contentInner}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            <View style={styles.card}>
              <Text style={styles.label}>Title</Text>
              <TextInput
                style={styles.input}
                placeholder="Notification title"
                placeholderTextColor="#6b7280"
                value={title}
                onChangeText={setTitle}
                maxLength={120}
                editable={!loading}
              />
            </View>

            <View style={styles.card}>
              <Text style={styles.label}>Message</Text>
              <TextInput
                style={[styles.input, styles.textArea]}
                placeholder="Your message to subscribers"
                placeholderTextColor="#6b7280"
                value={message}
                onChangeText={setMessage}
                multiline
                maxLength={2000}
                textAlignVertical="top"
                editable={!loading}
              />
            </View>

            {statusMessage.type ? (
              <View
                style={[
                  styles.statusMessage,
                  statusMessage.type === 'success' && styles.statusMessageSuccess,
                  statusMessage.type === 'error' && styles.statusMessageError,
                ]}>
                <Icon
                  name={statusMessage.type === 'success' ? 'check-circle' : 'alert-circle'}
                  size={22}
                  color={statusMessage.type === 'success' ? '#34d399' : '#f87171'}
                />
                <Text
                  style={[
                    styles.statusMessageText,
                    statusMessage.type === 'success' && styles.statusMessageTextSuccess,
                    statusMessage.type === 'error' && styles.statusMessageTextError,
                  ]}>
                  {statusMessage.text}
                </Text>
              </View>
            ) : null}

            <View style={styles.actions}>
              <TouchableOpacity style={styles.cancelButton} onPress={handleClose} disabled={loading}>
                <Text style={styles.cancelButtonText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.sendButton, loading && styles.sendButtonDisabled]}
                onPress={handleSend}
                disabled={loading}
                activeOpacity={0.85}>
                {loading ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <>
                    <Icon name="send" size={20} color="#fff" />
                    <Text style={styles.sendButtonText}>Send</Text>
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  keyboardView: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 14,
    backgroundColor: 'rgba(17, 24, 39, 0.92)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.6)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
    marginRight: 8,
  },
  headerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: '#fff',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: '#9ca3af',
  },
  closeButton: {
    padding: 4,
  },
  content: {
    flex: 1,
  },
  contentInner: {
    padding: 16,
    paddingBottom: 40,
  },
  card: {
    marginBottom: 18,
  },
  label: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 8,
    letterSpacing: 0.2,
  },
  input: {
    backgroundColor: 'rgba(31, 41, 55, 0.95)',
    borderWidth: 1,
    borderColor: '#4b5563',
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
  },
  textArea: {
    minHeight: 140,
    paddingTop: 14,
    lineHeight: 22,
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 15,
    backgroundColor: 'rgba(31, 41, 55, 0.9)',
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  cancelButtonText: {
    color: '#d1d5db',
    fontSize: 16,
    fontWeight: '700',
  },
  sendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 15,
    backgroundColor: '#7c3aed',
    borderRadius: 14,
  },
  sendButtonDisabled: {
    opacity: 0.65,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '800',
  },
  statusMessage: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 14,
    borderRadius: 14,
    marginBottom: 16,
  },
  statusMessageSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.12)',
    borderWidth: 1,
    borderColor: 'rgba(52, 211, 153, 0.35)',
  },
  statusMessageError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248, 113, 113, 0.35)',
  },
  statusMessageText: {
    flex: 1,
    fontSize: 14,
    lineHeight: 20,
    color: '#e5e7eb',
  },
  statusMessageTextSuccess: {
    color: '#a7f3d0',
  },
  statusMessageTextError: {
    color: '#fecaca',
  },
});

export default NotificationsPanel;
