import React, { useState, useMemo } from 'react';
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
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminNotificationsAPI } from '../config/api';

const { width, height } = Dimensions.get('window');

const formatDisplayDate = (yyyyMmDd) => {
  if (!yyyyMmDd || yyyyMmDd.length < 10) return null;
  const [y, m, d] = yyyyMmDd.split('-').map(Number);
  const d2 = new Date(y, m - 1, d);
  return d2.toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' });
};

// Normalize 24h time to HH:MM (e.g. "9:30" -> "09:30")
const normalizeTime24 = (raw) => {
  if (!raw || typeof raw !== 'string') return '';
  const trimmed = raw.trim();
  const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return trimmed;
  const h = Math.min(23, Math.max(0, parseInt(match[1], 10)));
  const m = Math.min(59, Math.max(0, parseInt(match[2], 10)));
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
};

// Validate 24h time string (HH:MM or H:MM)
const isValidTime24 = (value) => {
  if (!value || typeof value !== 'string') return false;
  const normalized = normalizeTime24(value);
  if (normalized.length !== 5) return false;
  const [h, m] = normalized.split(':').map(Number);
  return h >= 0 && h <= 23 && m >= 0 && m <= 59;
};

// Build calendar grid for a month: { value: 'YYYY-MM-DD', label: day number, isPast }
const getCalendarDays = (year, month) => {
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = [];
  const startPad = first.getDay();
  for (let i = 0; i < startPad; i++) days.push(null);
  for (let d = 1; d <= last.getDate(); d++) {
    const date = new Date(year, month, d);
    const value = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    days.push({ value, label: d, isPast: date < today });
  }
  return days;
};

const NotificationsPanel = ({ visible, onClose, onNotificationSent }) => {
  const [notificationType, setNotificationType] = useState('normal'); // 'normal' or 'scheduled'
  const [category, setCategory] = useState(''); // 'kabumbu' or 'movies'
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('');
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date().getMonth());
  const [calendarYear, setCalendarYear] = useState(() => new Date().getFullYear());
  const [loading, setLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState({ type: null, text: '' });

  const calendarDays = useMemo(
    () => getCalendarDays(calendarYear, calendarMonth),
    [calendarYear, calendarMonth],
  );
  const monthLabel = useMemo(
    () => new Date(calendarYear, calendarMonth, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }),
    [calendarYear, calendarMonth],
  );

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
      setStatusMessage({ type: 'error', text: 'Please select date and enter time (24h, e.g. 20:15)' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }
    if (notificationType === 'scheduled' && scheduledTime && !isValidTime24(scheduledTime)) {
      setStatusMessage({ type: 'error', text: 'Invalid time. Use 24h format, e.g. 20:15' });
      setTimeout(() => setStatusMessage({ type: null, text: '' }), 3000);
      return;
    }

    if (notificationType === 'scheduled' && scheduledDate && scheduledTime) {
      const [y, mo, d] = scheduledDate.split('-').map(Number);
      const timeNorm = normalizeTime24(scheduledTime);
      const [h, min] = timeNorm.split(':').map(Number);
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
      // Format scheduled date/time if scheduled (24h, with device timezone so stored time matches what admin entered)
      let scheduledFor = null;
      if (notificationType === 'scheduled' && scheduledDate && scheduledTime) {
        const timeNorm = normalizeTime24(scheduledTime);
        const [year, month, day] = scheduledDate.split('-');
        const [hour, minute] = timeNorm.split(':');
        const offsetMin = -new Date().getTimezoneOffset();
        const sign = offsetMin >= 0 ? '+' : '-';
        const absMin = Math.abs(offsetMin);
        const offsetStr = `${sign}${String(Math.floor(absMin / 60)).padStart(2, '0')}:${String(absMin % 60).padStart(2, '0')}`;
        scheduledFor = `${year}-${month}-${day}T${hour}:${minute}:00${offsetStr}`;
      }

      const notificationData = {
        title: title.trim(),
        message: message.trim(),
        category: category === 'kabumbu' ? 'kabumbu' : category === 'movies' ? 'movies' : 'habari',
        type: notificationType,
        ...(scheduledFor && { scheduledFor }),
      };

      const result = await adminNotificationsAPI.createNotification(notificationData);

      // Check if Firebase failed (pushError returned in response)
      if (result?.pushError) {
        // Notification saved but push failed - show error to admin
        setStatusMessage({
          type: 'error',
          text: `⚠️ Notification saved but NOT sent to users!\n\nReason: ${result.pushError}\n\nFix: Set FIREBASE_SERVICE_ACCOUNT_KEY on Railway.`,
        });
        setTimeout(() => setStatusMessage({ type: null, text: '' }), 10000);
        return;
      }

      // Success - show sent count
      const sentCount = result?.sent_count || result?.total_devices || 0;
      const successText = notificationType === 'scheduled'
        ? 'Notification scheduled successfully!'
        : sentCount > 0
          ? `✅ Sent to ${sentCount.toLocaleString()} devices!`
          : 'Notification sent successfully!';

      setStatusMessage({ type: 'success', text: successText });

      if (onNotificationSent) onNotificationSent();

      setTimeout(() => {
        setTitle('');
        setMessage('');
        setScheduledDate('');
        setScheduledTime('');
        setShowDatePicker(false);
        setCategory('');
        setNotificationType('normal');
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

          {/* Schedule: calendar date + time picker (no native deps) */}
          {notificationType === 'scheduled' && (
            <View style={styles.section}>
              <Text style={styles.scheduleSectionTitle}>Schedule for</Text>
              <Text style={styles.scheduleSectionSubtitle}>Pick date from calendar; enter time in 24h (e.g. 20:15)</Text>
              <View style={styles.scheduleCard}>
                <TouchableOpacity
                  style={styles.scheduleRow}
                  onPress={() => {
                    const now = new Date();
                    setCalendarMonth(now.getMonth());
                    setCalendarYear(now.getFullYear());
                    setShowDatePicker(true);
                  }}
                  activeOpacity={0.7}>
                  <View style={styles.scheduleIconWrap}>
                    <Icon name="calendar-month" size={24} color="#a855f7" />
                  </View>
                  <View style={styles.scheduleRowTextWrap}>
                    <Text style={styles.scheduleRowLabel}>Date</Text>
                    <Text style={scheduledDate ? styles.scheduleRowValue : styles.scheduleRowPlaceholder}>
                      {formatDisplayDate(scheduledDate) || 'Tap to open calendar'}
                    </Text>
                  </View>
                  <Icon name="chevron-right" size={24} color="#6b7280" />
                </TouchableOpacity>
                <View style={styles.scheduleDivider} />
                <View style={styles.scheduleRow}>
                  <View style={styles.scheduleIconWrap}>
                    <Icon name="clock-outline" size={24} color="#a855f7" />
                  </View>
                  <View style={[styles.scheduleRowTextWrap, styles.scheduleTimeInputWrap]}>
                    <Text style={styles.scheduleRowLabel}>Time (24h)</Text>
                    <TextInput
                      style={styles.scheduleTimeInput}
                      placeholder="e.g. 20:15"
                      placeholderTextColor="#6b7280"
                      value={scheduledTime}
                      onChangeText={setScheduledTime}
                      keyboardType="numbers-and-punctuation"
                      maxLength={5}
                    />
                  </View>
                </View>
              </View>

              <Modal visible={showDatePicker} transparent animationType="fade">
                <TouchableOpacity
                  style={styles.pickerOverlay}
                  activeOpacity={1}
                  onPress={() => setShowDatePicker(false)}>
                  <View style={styles.pickerCard} onStartShouldSetResponder={() => true}>
                    <Text style={styles.pickerTitle}>{monthLabel}</Text>
                    <View style={styles.calendarNav}>
                      <TouchableOpacity
                        onPress={() => {
                          if (calendarMonth === 0) {
                            setCalendarYear((y) => y - 1);
                            setCalendarMonth(11);
                          } else setCalendarMonth((m) => m - 1);
                        }}>
                        <Icon name="chevron-left" size={28} color="#a855f7" />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => {
                          if (calendarMonth === 11) {
                            setCalendarYear((y) => y + 1);
                            setCalendarMonth(0);
                          } else setCalendarMonth((m) => m + 1);
                        }}>
                        <Icon name="chevron-right" size={28} color="#a855f7" />
                      </TouchableOpacity>
                    </View>
                    <View style={styles.calendarWeekdays}>
                      {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((wd) => (
                        <Text key={wd} style={styles.calendarWeekdayText}>{wd}</Text>
                      ))}
                    </View>
                    <View style={styles.calendarGrid}>
                      {calendarDays.map((day, idx) =>
                        day === null ? (
                          <View key={`e-${idx}`} style={styles.calendarDayCell} />
                        ) : (
                          <TouchableOpacity
                            key={day.value}
                            style={[
                              styles.calendarDayCell,
                              day.isPast && styles.calendarDayPast,
                              scheduledDate === day.value && styles.calendarDaySelected,
                            ]}
                            onPress={() => {
                              if (!day.isPast) {
                                setScheduledDate(day.value);
                                setShowDatePicker(false);
                              }
                            }}
                            disabled={day.isPast}>
                            <Text
                              style={[
                                styles.calendarDayText,
                                day.isPast && styles.calendarDayTextPast,
                                scheduledDate === day.value && styles.calendarDayTextSelected,
                              ]}>
                              {day.label}
                            </Text>
                          </TouchableOpacity>
                        ),
                      )}
                    </View>
                    <TouchableOpacity style={styles.pickerCancel} onPress={() => setShowDatePicker(false)}>
                      <Text style={styles.pickerCancelText}>Close</Text>
                    </TouchableOpacity>
                  </View>
                </TouchableOpacity>
              </Modal>
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
  scheduleTimeInputWrap: {
    flex: 1,
  },
  scheduleTimeInput: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    paddingVertical: 4,
    paddingHorizontal: 0,
    marginTop: 2,
    minHeight: 28,
  },
  pickerOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    justifyContent: 'center',
    padding: 24,
  },
  pickerCard: {
    backgroundColor: '#1f2937',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#374151',
    maxHeight: height * 0.6,
  },
  pickerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#fff',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#374151',
  },
  pickerScroll: {
    maxHeight: 280,
  },
  pickerOption: {
    paddingHorizontal: 20,
    paddingVertical: 14,
  },
  pickerOptionActive: {
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
  },
  pickerOptionText: {
    fontSize: 16,
    color: '#e5e7eb',
  },
  pickerOptionTextActive: {
    color: '#a855f7',
    fontWeight: '600',
  },
  pickerCancel: {
    paddingVertical: 16,
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#374151',
  },
  pickerCancelText: {
    fontSize: 16,
    color: '#9ca3af',
    fontWeight: '500',
  },
  calendarNav: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 8,
    alignItems: 'center',
  },
  calendarWeekdays: {
    flexDirection: 'row',
    paddingHorizontal: 12,
    paddingBottom: 8,
  },
  calendarWeekdayText: {
    flex: 1,
    fontSize: 12,
    color: '#9ca3af',
    textAlign: 'center',
  },
  calendarGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    paddingHorizontal: 12,
    paddingBottom: 16,
  },
  calendarDayCell: {
    width: '14.28%',
    aspectRatio: 1,
    maxWidth: 44,
    maxHeight: 44,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 22,
    marginVertical: 2,
  },
  calendarDayPast: {
    opacity: 0.4,
  },
  calendarDaySelected: {
    backgroundColor: '#a855f7',
  },
  calendarDayText: {
    fontSize: 15,
    color: '#e5e7eb',
    fontWeight: '500',
  },
  calendarDayTextPast: {
    color: '#6b7280',
  },
  calendarDayTextSelected: {
    color: '#fff',
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
