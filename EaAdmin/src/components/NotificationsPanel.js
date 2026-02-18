import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  TextInput,
  ScrollView,
  Dimensions,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DateTimePicker from '@react-native-community/datetimepicker';
import { adminNotificationsAPI } from '../config/api';

const { width, height } = Dimensions.get('window');

const formatDisplayDate = (yyyyMmDd) => {
  if (!yyyyMmDd || yyyyMmDd.length < 10) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const d2 = new Date(y, m - 1, d);
  return d2.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

const formatDisplayTime = (hhMm) => {
  if (!hhMm || !/^\d{1,2}:\d{2}$/.test(hhMm)) return null;
  const [h, min] = hhMm.split(':').map(Number);
  const h12 = h % 12 || 12;
  const ampm = h < 12 ? 'AM' : 'PM';
  return `${h12}:${String(min).padStart(2, '0')} ${ampm}`;
};

const toYyyyMmDd = (d) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
};

const toHhMm = (d) => {
  const h = String(d.getHours()).padStart(2, '0');
  const min = String(d.getMinutes()).padStart(2, '0');
  return `${h}:${min}`;
};

const NotificationsPanel = ({ visible, onClose, onNotificationSent }) => {
  const [notificationType, setNotificationType] = useState('normal'); // 'normal' or 'scheduled'
  const [category, setCategory] = useState(''); // 'kabumbu' or 'movies'
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: null, text: '' });

  const minDate = new Date();
  const dateForPicker = scheduledDate
    ? (() => {
        const [y, m, d] = scheduledDate.split('-').map(Number);
        return new Date(y, m - 1, d);
      })()
    : new Date();
  const timeForPicker = scheduledTime
    ? (() => {
        const [h, min] = scheduledTime.split(':').map(Number);
        const d = new Date();
        d.setHours(h, min, 0, 0);
        return d;
      })()
    : new Date();

  const handleSend = async () => {
    if (!category) {
      setStatusMessage({ type: 'error', text: 'Please select a category' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }
    if (!title.trim() || !message.trim()) {
      setStatusMessage({ type: 'error', text: 'Please fill in title and message' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }
    if (notificationType === 'scheduled' && (!scheduledDate || !scheduledTime)) {
      setStatusMessage({ type: 'error', text: 'Please select date and time for scheduled notification' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }

    if (notificationType === 'scheduled' && scheduledDate && scheduledTime) {
      const [y, mo, d] = scheduledDate.split('-').map(Number);
      const [h, min] = scheduledTime.split(':').map(Number);
      const scheduledAt = new Date(y, mo - 1, d, h, min, 0);
      if (scheduledAt <= new Date()) {
        setStatusMessage({ type: 'error', text: 'Please select a future date and time' });
        setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
        return;
      }
    }

    setLoading(true);
    setStatusMessage({ type: null, text: '' });

    try {
      // Format scheduled date/time if scheduled
      let scheduledFor = null;
      if (notificationType === 'scheduled' && scheduledDate && scheduledTime) {
        // Format: YYYY-MM-DDTHH:MM:SS (ISO format)
        const [year, month, day] = scheduledDate.split('-');
        const [hour, minute] = scheduledTime.split(':');
        scheduledFor = `${year}-${month}-${day}T${hour}:${minute}:00`;
      }

      const notificationData = {
        title: title.trim(),
        message: message.trim(),
        category: category === 'kabumbu' ? 'kabumbu' : category === 'movies' ? 'movies' : 'habari',
        type: notificationType,
        ...(scheduledFor && { scheduledFor }),
      };

      const result = await adminNotificationsAPI.createNotification(notificationData);

      setStatusMessage({ 
        type: 'success', 
        text: notificationType === 'scheduled' 
          ? 'Notification scheduled successfully!' 
          : 'Notification sent successfully to all users!' 
      });

      if (onNotificationSent) onNotificationSent();

      setTimeout(() => {
        setTitle('');
        setMessage('');
        setScheduledDate('');
        setScheduledTime('');
        setShowDatePicker(false);
        setShowTimePicker(false);
        setCategory('');
        setNotificationType('normal');
        setStatusMessage({ type: null, text: '' });
        onClose();
      }, 2000);
    } catch (error) {
      console.error('Error sending notification:', error);
      let text = error.message || 'Failed to send notification. Please try again.';
      if (
        text.includes('Internal server error') ||
        text.includes('500') ||
        text.includes('Failed to save') ||
        text.includes('ADMIN_API_KEY')
      ) {
        text += ' Check Railway: set ADMIN_API_KEY and FIREBASE_SERVICE_ACCOUNT_KEY (JSON).';
      }
      setStatusMessage({ type: 'error', text });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 6000);
    } finally {
      setLoading(false);
    }
  };

  const handleClose = () => {
    // Reset form when closing
    setTitle('');
    setMessage('');
    setScheduledDate('');
    setScheduledTime('');
    setCategory('');
    setNotificationType('normal');
    onClose();
  };

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
        
        {/* Header */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="bell" size={24} color="#a855f7" />
            <Text style={styles.headerTitle}>Send Notifications</Text>
          </View>
          <TouchableOpacity onPress={handleClose} style={styles.closeButton}>
            <Icon name="close" size={24} color="#9ca3af" />
          </TouchableOpacity>
        </View>

        <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
          {/* Notification Type Toggle */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Notification Type</Text>
            <View style={styles.typeToggle}>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  notificationType === 'normal' && styles.typeButtonActive,
                ]}
                onPress={() => setNotificationType('normal')}>
                <Icon
                  name="send"
                  size={20}
                  color={notificationType === 'normal' ? '#fff' : '#9ca3af'}
                />
                <Text
                  style={[
                    styles.typeButtonText,
                    notificationType === 'normal' && styles.typeButtonTextActive,
                  ]}>
                  Send Now
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.typeButton,
                  notificationType === 'scheduled' && styles.typeButtonActive,
                ]}
                onPress={() => setNotificationType('scheduled')}>
                <Icon
                  name="clock-outline"
                  size={20}
                  color={notificationType === 'scheduled' ? '#fff' : '#9ca3af'}
                />
                <Text
                  style={[
                    styles.typeButtonText,
                    notificationType === 'scheduled' && styles.typeButtonTextActive,
                  ]}>
                  Schedule
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Category Selection */}
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Select Category *</Text>
            <View style={styles.categoryContainer}>
              <TouchableOpacity
                style={[
                  styles.categoryCard,
                  category === 'kabumbu' && styles.categoryCardActive,
                ]}
                onPress={() => setCategory('kabumbu')}>
                <LinearGradient
                  colors={
                    category === 'kabumbu'
                      ? ['#10b981', '#059669']
                      : ['rgba(16, 185, 129, 0.1)', 'rgba(5, 150, 105, 0.1)']
                  }
                  style={styles.categoryGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <Icon
                    name="soccer"
                    size={32}
                    color={category === 'kabumbu' ? '#fff' : '#10b981'}
                  />
                  <Text
                    style={[
                      styles.categoryText,
                      category === 'kabumbu' && styles.categoryTextActive,
                    ]}>
                    Kabumbu
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.categoryCard,
                  category === 'movies' && styles.categoryCardActive,
                ]}
                onPress={() => setCategory('movies')}>
                <LinearGradient
                  colors={
                    category === 'movies'
                      ? ['#7c3aed', '#6d28d9']
                      : ['rgba(124, 58, 237, 0.1)', 'rgba(109, 40, 217, 0.1)']
                  }
                  style={styles.categoryGradient}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <Icon
                    name="movie"
                    size={32}
                    color={category === 'movies' ? '#fff' : '#7c3aed'}
                  />
                  <Text
                    style={[
                      styles.categoryText,
                      category === 'movies' && styles.categoryTextActive,
                    ]}>
                    Movies
                  </Text>
                </LinearGradient>
              </TouchableOpacity>
            </View>
          </View>

          {/* Title Input */}
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

          {/* Message Input */}
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

          {/* Scheduled Date/Time */}
          {notificationType === 'scheduled' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>Schedule Date & Time *</Text>
              <View style={styles.dateTimeContainer}>
                <View style={styles.dateTimeInput}>
                  <Icon name="calendar" size={20} color="#9ca3af" />
                  <TextInput
                    style={styles.dateTimeText}
                    placeholder="YYYY-MM-DD"
                    placeholderTextColor="#6b7280"
                    value={scheduledDate}
                    onChangeText={setScheduledDate}
                  />
                </View>
                <View style={styles.dateTimeInput}>
                  <Icon name="clock-outline" size={20} color="#9ca3af" />
                  <TextInput
                    style={styles.dateTimeText}
                    placeholder="HH:MM"
                    placeholderTextColor="#6b7280"
                    value={scheduledTime}
                    onChangeText={setScheduledTime}
                  />
                </View>
              </View>
            </View>
          )}

          {/* Status Message */}
          {statusMessage.type && (
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
          )}

          {/* Action Buttons */}
          <View style={styles.actionButtons}>
            <TouchableOpacity 
              style={styles.cancelButton} 
              onPress={handleClose}
              disabled={loading}>
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
                  <Text style={styles.sendButtonText}>
                    {notificationType === 'scheduled' ? 'Schedule' : 'Send Now'}
                  </Text>
                </>
              )}
            </TouchableOpacity>
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
  typeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    borderRadius: 8,
  },
  typeButtonActive: {
    backgroundColor: '#7c3aed',
  },
  typeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  typeButtonTextActive: {
    color: '#fff',
  },
  categoryContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  categoryCard: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  categoryCardActive: {
    borderColor: '#a855f7',
  },
  categoryGradient: {
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 120,
  },
  categoryText: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#10b981',
    marginTop: 8,
  },
  categoryTextActive: {
    color: '#fff',
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
  scheduleSectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 4,
  },
  scheduleSectionSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginBottom: 16,
  },
  scheduleCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.9)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 8,
    elevation: 4,
  },
  scheduleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 16,
    gap: 14,
  },
  scheduleIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(168, 85, 247, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  scheduleRowTextWrap: {
    flex: 1,
  },
  scheduleRowLabel: {
    fontSize: 12,
    color: '#9ca3af',
    marginBottom: 2,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  scheduleRowValue: {
    fontSize: 16,
    color: '#fff',
    fontWeight: '600',
  },
  scheduleRowPlaceholder: {
    fontSize: 15,
    color: '#6b7280',
  },
  scheduleDivider: {
    height: 1,
    backgroundColor: '#374151',
    marginLeft: 74,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 8,
    marginBottom: 32,
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
