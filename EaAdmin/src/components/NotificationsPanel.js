import React, { useState, useCallback, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminNotificationsAPI } from '../config/api';

/** Server requires a category for routing; we default to general (habari). */
const DEFAULT_NOTIFICATION_CATEGORY = 'habari';

const formatSentAt = (iso) => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('sw-TZ', {
      day: '2-digit',
      month: 'short',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '—';
  }
};

const NotificationsPanel = ({ visible, onClose, onNotificationSent }) => {
  const [activeTab, setActiveTab] = useState('compose');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: null, text: '' });

  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState('');

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    setHistoryError('');
    try {
      const rows = await adminNotificationsAPI.getNotifications(80);
      const sent = (Array.isArray(rows) ? rows : [])
        .filter((n) => n.sent_at)
        .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at));
      setHistory(sent);
    } catch (error) {
      console.error('Failed to load notification history:', error);
      setHistoryError(error?.message || 'Could not load history');
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      loadHistory();
    }
  }, [visible, loadHistory]);

  const handleResendToCompose = useCallback((item) => {
    setTitle(item.title || '');
    setMessage(item.message || '');
    setActiveTab('compose');
    setStatusMessage({ type: null, text: '' });
  }, []);

  const handleSend = async () => {
    if (!title.trim() || !message.trim()) {
      setStatusMessage({ type: 'error', text: 'Please fill in title and message' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }

    setLoading(true);
    setStatusMessage({ type: null, text: '' });

    try {
      const notificationData = {
        title: title.trim(),
        message: message.trim(),
        category: DEFAULT_NOTIFICATION_CATEGORY,
        type: 'normal',
      };

      const result = await adminNotificationsAPI.createNotification(notificationData);

      if (result?.pushError) {
        setStatusMessage({
          type: 'error',
          text: `⚠️ Notification saved but NOT sent to users!\n\nReason: ${result.pushError}\n\nFix: Set FIREBASE_SERVICE_ACCOUNT_KEY on Railway.`,
        });
        setTimeout(() => setStatusMessage({ type: null, text: '' }), 10000);
        return;
      }

      const withToken = Number(result?.users_with_token || 0);
      const isQueued = result?.push_status === 'sending';
      const successText = isQueued
        ? `✅ ${result?.message || 'Broadcast started.'}\n(${withToken.toLocaleString()} devices with token · topic all_users)`
        : `✅ Sent to ${Number(result?.sent_count || 0).toLocaleString()} device(s).`;

      setStatusMessage({ type: 'success', text: successText });

      if (onNotificationSent) onNotificationSent();
      loadHistory();

      if (isQueued && result?.id) {
        const notificationId = result.id;
        let polls = 0;
        const pollId = setInterval(async () => {
          polls += 1;
          try {
            await loadHistory();
          } catch (_) {}
          if (polls >= 15) clearInterval(pollId);
        }, 2000);
      }

      setTimeout(() => {
        setTitle('');
        setMessage('');
        setStatusMessage({ type: null, text: '' });
        onClose();
      }, 2500);
    } catch (error) {
      console.error('Error sending notification:', error);
      let text = error.message || 'Failed to send notification. Please try again.';
      if (
        text.includes('Internal server error') ||
        text.includes('500') ||
        text.includes('Failed to save') ||
        text.includes('ADMIN_API_KEY')
      ) {
        text = 'Server error! Check Railway: set ADMIN_API_KEY and FIREBASE_SERVICE_ACCOUNT_KEY environment variables.';
      }
      if (text.includes('Unauthorized') || text.includes('401')) {
        text = 'Unauthorized! Check ADMIN_API_KEY in Railway variables.';
      }
      setStatusMessage({ type: 'error', text });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 8000);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    setTitle('');
    setMessage('');
    setActiveTab('compose');
    setStatusMessage({ type: null, text: '' });
    onClose();
  };

  const historyEmpty = !historyLoading && history.length === 0 && !historyError;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={handleClose}>
      <SafeAreaView style={styles.modalContainer}>
        <LinearGradient
          colors={['#030712', '#111827', '#1f2937']}
          style={StyleSheet.absoluteFill}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
        />

        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="bell" size={24} color="#a855f7" />
            <Text style={styles.headerTitle}>Notifications</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Icon name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        <View style={styles.tabRow}>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'compose' && styles.tabPillActive]}
            onPress={() => setActiveTab('compose')}
            activeOpacity={0.85}>
            <Icon
              name="pencil-outline"
              size={18}
              color={activeTab === 'compose' ? '#fff' : '#9ca3af'}
            />
            <Text style={[styles.tabPillText, activeTab === 'compose' && styles.tabPillTextActive]}>
              Send Now
            </Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabPill, activeTab === 'history' && styles.tabPillActive]}
            onPress={() => {
              setActiveTab('history');
              loadHistory();
            }}
            activeOpacity={0.85}>
            <Icon
              name="history"
              size={18}
              color={activeTab === 'history' ? '#fff' : '#9ca3af'}
            />
            <Text style={[styles.tabPillText, activeTab === 'history' && styles.tabPillTextActive]}>
              History
            </Text>
            {history.length > 0 ? (
              <View style={styles.tabBadge}>
                <Text style={styles.tabBadgeText}>{history.length > 99 ? '99+' : history.length}</Text>
              </View>
            ) : null}
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {activeTab === 'compose' ? (
            <>
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Title *</Text>
                <TextInput
                  style={styles.input}
                  placeholder="Enter notification title"
                  placeholderTextColor="#6b7280"
                  value={title}
                  onChangeText={setTitle}
                />
              </View>

              <View style={styles.section}>
                <Text style={styles.sectionTitle}>Message *</Text>
                <TextInput
                  style={[styles.input, styles.textArea]}
                  placeholder="Enter notification message"
                  placeholderTextColor="#6b7280"
                  value={message}
                  onChangeText={setMessage}
                  multiline
                  numberOfLines={4}
                  textAlignVertical="top"
                />
              </View>
            </>
          ) : (
            <View style={styles.historySection}>
              <View style={styles.historyHeaderRow}>
                <Text style={styles.historyTitle}>Notifications history</Text>
                <TouchableOpacity
                  style={styles.refreshBtn}
                  onPress={loadHistory}
                  disabled={historyLoading}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  {historyLoading ? (
                    <ActivityIndicator size="small" color="#a78bfa" />
                  ) : (
                    <Icon name="refresh" size={20} color="#a78bfa" />
                  )}
                </TouchableOpacity>
              </View>

              {historyError ? (
                <View style={styles.historyEmptyCard}>
                  <Icon name="alert-circle-outline" size={40} color="#f87171" />
                  <Text style={styles.historyEmptyText}>{historyError}</Text>
                </View>
              ) : historyLoading && history.length === 0 ? (
                <View style={styles.historyEmptyCard}>
                  <ActivityIndicator size="large" color="#a855f7" />
                  <Text style={styles.historyEmptySub}>Loading sent notifications…</Text>
                </View>
              ) : historyEmpty ? (
                <View style={styles.historyEmptyCard}>
                  <Icon name="bell-off-outline" size={40} color="#6b7280" />
                  <Text style={styles.historyEmptyText}>No sent notifications yet</Text>
                  <Text style={styles.historyEmptySub}>Send your first notification from the Send Now tab</Text>
                </View>
              ) : (
                history.map((item) => {
                  const delivered = Number(item.delivered_count || 0);
                  const sent = Number(item.sent_count || 0);
                  const clicks = Number(item.clicks || 0);
                  const pushStatus = item.push_status || 'completed';
                  const ctr = delivered > 0 ? ((clicks / delivered) * 100).toFixed(1) : '0.0';
                  const statsLine =
                    pushStatus === 'sending'
                      ? 'Sending… (refreshing)'
                      : pushStatus === 'failed'
                        ? `Failed: ${item.push_error || 'see server logs'}`
                        : `${delivered}/${sent} delivered · ${clicks} clicks · CTR ${ctr}%`;

                  return (
                    <View key={String(item.id)} style={styles.historyCard}>
                      <View style={styles.historyCardTop}>
                        <View style={styles.historyCardIcon}>
                          <Icon name="bell-check" size={22} color="#34d399" />
                        </View>
                        <View style={styles.historyCardBody}>
                          <Text style={styles.historyCardTitle} numberOfLines={2}>
                            {item.title}
                          </Text>
                          <Text style={styles.historyCardMessage} numberOfLines={3}>
                            {item.message}
                          </Text>
                          <Text style={styles.historyCardMeta}>{formatSentAt(item.sent_at)}</Text>
                          <Text style={styles.historyCardStats}>{statsLine}</Text>
                        </View>
                        <TouchableOpacity
                          style={styles.resendBtn}
                          onPress={() => handleResendToCompose(item)}
                          activeOpacity={0.8}
                          accessibilityLabel="Resend to editor"
                          hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                          <Icon name="backup-restore" size={22} color="#fff" />
                          <Text style={styles.resendBtnLabel}>Resend</Text>
                        </TouchableOpacity>
                      </View>
                    </View>
                  );
                })
              )}
            </View>
          )}

          {activeTab === 'compose' && statusMessage.type ? (
            <View
              style={[
                styles.statusMessage,
                statusMessage.type === 'success' && styles.statusMessageSuccess,
                statusMessage.type === 'error' && styles.statusMessageError,
              ]}>
              <Icon
                name={statusMessage.type === 'success' ? 'check-circle' : 'alert-circle'}
                size={20}
                color={statusMessage.type === 'success' ? '#10b981' : '#ef4444'}
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

          <View style={styles.actionButtons}>
            {activeTab === 'history' ? (
              <TouchableOpacity
                style={styles.composeNewButton}
                onPress={() => setActiveTab('compose')}
                activeOpacity={0.85}>
                <Icon name="plus" size={20} color="#fff" />
                <Text style={styles.composeNewButtonText}>Compose new notification</Text>
              </TouchableOpacity>
            ) : (
              <>
                <TouchableOpacity style={styles.cancelButton} onPress={handleClose} disabled={loading}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.sendButton, loading && styles.sendButtonDisabled]}
                  onPress={handleSend}
                  disabled={loading}>
                  {loading ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Icon name="send" size={20} color="#fff" />
                      <Text style={styles.sendButtonText}>Send Now</Text>
                    </>
                  )}
                </TouchableOpacity>
              </>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
    </Modal>
  );
};

const styles = StyleSheet.create({
  modalContainer: {
    flex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  tabRow: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    paddingBottom: 8,
  },
  tabPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.85)',
    borderWidth: 1,
    borderColor: '#374151',
  },
  tabPillActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#a855f7',
  },
  tabPillText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  tabPillTextActive: {
    color: '#fff',
  },
  tabBadge: {
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 5,
  },
  tabBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
  },
  content: {
    flex: 1,
    padding: 16,
  },
  section: {
    marginBottom: 24,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  input: {
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  textArea: {
    minHeight: 100,
    paddingTop: 12,
  },
  historySection: {
    marginBottom: 16,
  },
  historyHeaderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  historyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#f8fafc',
  },
  historySubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 16,
    lineHeight: 18,
  },
  refreshBtn: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  historyEmptyCard: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 48,
    paddingHorizontal: 24,
    gap: 12,
  },
  historyEmptyText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
    textAlign: 'center',
  },
  historyEmptySub: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
    lineHeight: 18,
  },
  historyCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.75)',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#374151',
    marginBottom: 12,
    overflow: 'hidden',
  },
  historyCardTop: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    padding: 14,
    gap: 12,
  },
  historyCardIcon: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(16, 185, 129, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  historyCardBody: {
    flex: 1,
    minWidth: 0,
    paddingRight: 4,
  },
  historyCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  historyCardMessage: {
    fontSize: 13,
    color: '#d1d5db',
    lineHeight: 18,
    marginBottom: 6,
  },
  historyCardMeta: {
    fontSize: 11,
    color: '#9ca3af',
    marginBottom: 4,
  },
  historyCardStats: {
    fontSize: 11,
    color: '#6ee7b7',
    fontWeight: '600',
  },
  resendBtn: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.35)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.5)',
    minWidth: 64,
  },
  resendBtnLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#e9d5ff',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 32,
  },
  composeNewButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
  },
  composeNewButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '600',
  },
  sendButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 14,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
  },
  sendButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  sendButtonDisabled: {
    opacity: 0.6,
  },
  statusMessage: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 12,
    marginBottom: 16,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
  },
  statusMessageSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(16, 185, 129, 0.3)',
  },
  statusMessageError: {
    backgroundColor: 'rgba(239, 68, 68, 0.1)',
    borderWidth: 1,
    borderColor: 'rgba(239, 68, 68, 0.3)',
  },
  statusMessageText: {
    flex: 1,
    fontSize: 14,
    color: '#fff',
  },
  statusMessageTextSuccess: {
    color: '#10b981',
  },
  statusMessageTextError: {
    color: '#ef4444',
  },
});

export default NotificationsPanel;
