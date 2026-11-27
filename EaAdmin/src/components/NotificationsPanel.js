import React, { useState, useCallback, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import { adminNotificationsAPI, adminUsersAPI } from '../config/api';
import colors from '../theme/colors';
import {
  Sheet,
  Button,
  Chip,
  ChipRow,
  Field,
  Input,
  Card,
  Empty,
  Loading,
  Badge,
  toast,
  timeAgo,
  compact,
} from './ui/kit';

/** Server routes by category; every notification is broadcast to ALL users via topic all_users. */
const CATEGORY = 'habari';

const TEMPLATES = [
  {
    id: 'renew',
    label: 'Renew reminder',
    title: 'Kifurushi chako kimeisha',
    message: 'Lipia sasa uendelee kutazama chaneli zote bila kikomo.',
  },
  {
    id: 'match',
    label: 'Match live',
    title: 'Mechi inaanza sasa',
    message: 'Fungua app uangalie mechi moja kwa moja.',
  },
  {
    id: 'new',
    label: 'New channels',
    title: 'Chaneli mpya zimeongezwa',
    message: 'Fungua app uone chaneli mpya leo.',
  },
  {
    id: 'update',
    label: 'Update app',
    title: 'Toleo jipya linapatikana',
    message: 'Sasisha app upate huduma bora zaidi.',
  },
];

const NotificationsPanel = ({ visible, onClose, onNotificationSent }) => {
  const [tab, setTab] = useState('send');
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [reminding, setReminding] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const sendingRef = useRef(false);
  const pollRef = useRef(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const rows = await adminNotificationsAPI.getNotifications(40);
      setHistory(
        (Array.isArray(rows) ? rows : [])
          .filter((n) => n.sent_at)
          .sort((a, b) => new Date(b.sent_at) - new Date(a.sent_at)),
      );
    } catch (_) {
      setHistory([]);
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (visible) {
      setError('');
      loadHistory();
    } else if (pollRef.current) {
      clearInterval(pollRef.current);
      pollRef.current = null;
    }
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [visible, loadHistory]);

  const applyTemplate = (t) => {
    setTitle(t.title);
    setMessage(t.message);
    setError('');
  };

  const handleSend = async () => {
    if (sendingRef.current) return;
    if (!title.trim() || !message.trim()) {
      setError('Add a title and a message.');
      return;
    }
    sendingRef.current = true;
    setSending(true);
    setError('');
    try {
      const result = await adminNotificationsAPI.createNotification({
        title: title.trim(),
        message: message.trim(),
        category: CATEGORY,
        type: 'normal',
      });

      if (result?.pushError) {
        setError(`Saved but not delivered: ${result.pushError}`);
        return;
      }

      const devices = Number(result?.users_with_token || 0);
      toast(`Sending to all users${devices ? ` · ${compact(devices)} devices` : ''}`);
      setTitle('');
      setMessage('');
      onNotificationSent?.();
      onClose(); // close right away – the server delivers in the background

      // Light refresh of history stats while the broadcast finishes.
      let polls = 0;
      if (pollRef.current) clearInterval(pollRef.current);
      pollRef.current = setInterval(() => {
        polls += 1;
        loadHistory();
        if (polls >= 6 && pollRef.current) {
          clearInterval(pollRef.current);
          pollRef.current = null;
        }
      }, 3000);
    } catch (e) {
      const text = String(e?.message || 'Could not send.');
      setError(
        /unauthorized|401/i.test(text)
          ? 'Unauthorized – check the admin key.'
          : /internal server|500/i.test(text)
            ? 'Server error – try again in a moment.'
            : text,
      );
    } finally {
      sendingRef.current = false;
      setSending(false);
    }
  };

  const remindExpired = async () => {
    if (reminding) return;
    setReminding(true);
    try {
      const res = await adminUsersAPI.remindExpiredSubscriptions({ force: true });
      if (res && res.ok === false) {
        setError(res.message || 'Push is not configured on the server.');
      } else {
        toast(`Reminder sent · ${res?.sent ?? 0} delivered of ${res?.targeted ?? 0}`);
        onClose();
      }
    } catch (e) {
      setError(e?.message || 'Could not send reminders.');
    } finally {
      setReminding(false);
    }
  };

  return (
    <Sheet
      visible={visible}
      onClose={onClose}
      title="Notify all users"
      footer={
        tab === 'send' ? (
          <Button
            label="Send to all users"
            icon="send"
            onPress={handleSend}
            loading={sending}
            style={{ flex: 1 }}
          />
        ) : null
      }>
      <View style={styles.tabs}>
        <Chip label="Compose" active={tab === 'send'} onPress={() => setTab('send')} />
        <Chip
          label="History"
          active={tab === 'history'}
          onPress={() => {
            setTab('history');
            loadHistory();
          }}
        />
      </View>

      {tab === 'send' ? (
        <>
          <Text style={styles.audience}>
            Goes to every user of the app, on every device. Delivery runs in the background.
          </Text>

          <Text style={styles.label}>Quick templates</Text>
          <ChipRow>
            {TEMPLATES.map((t) => (
              <Chip key={t.id} label={t.label} onPress={() => applyTemplate(t)} />
            ))}
          </ChipRow>

          <View style={{ height: 16 }} />
          <Field label="Title">
            <Input value={title} onChangeText={setTitle} placeholder="Title" autoCapitalize="sentences" />
          </Field>
          <Field label="Message">
            <Input
              value={message}
              onChangeText={setMessage}
              placeholder="Message"
              multiline
              autoCapitalize="sentences"
            />
          </Field>

          {error ? <Text style={styles.error}>{error}</Text> : null}

          <Button
            variant="secondary"
            icon="account-clock-outline"
            label="Remind expired subscribers only"
            onPress={remindExpired}
            loading={reminding}
          />
        </>
      ) : historyLoading && history.length === 0 ? (
        <Loading />
      ) : history.length === 0 ? (
        <Empty icon="bell-off-outline" title="Nothing sent yet" />
      ) : (
        history.map((n) => {
          const delivered = Number(n.delivered_count || 0);
          const sent = Number(n.sent_count || 0);
          const sendingNow = n.push_status === 'sending';
          return (
            <Card key={String(n.id)} style={{ marginBottom: 10 }}>
              <View style={styles.histTop}>
                <Text style={styles.histTitle} numberOfLines={1}>
                  {n.title}
                </Text>
                <Text style={styles.histTime}>{timeAgo(n.sent_at)}</Text>
              </View>
              <Text style={styles.histMsg} numberOfLines={2}>
                {n.message}
              </Text>
              <View style={styles.histBottom}>
                {sendingNow ? (
                  <Badge label="Sending…" tone="warning" />
                ) : n.push_status === 'failed' ? (
                  <Badge label="Failed" tone="danger" />
                ) : (
                  <Badge label={`${delivered}/${sent} delivered`} tone="accent" />
                )}
                <Text style={styles.histClicks}>{Number(n.clicks || 0)} clicks</Text>
                <View style={{ flex: 1 }} />
                <TouchableOpacity
                  hitSlop={8}
                  onPress={() => {
                    setTitle(n.title || '');
                    setMessage(n.message || '');
                    setTab('send');
                  }}>
                  <Text style={styles.resend}>Reuse</Text>
                </TouchableOpacity>
              </View>
            </Card>
          );
        })
      )}
    </Sheet>
  );
};

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 8, marginBottom: 14 },
  audience: {
    color: colors.textSecondary,
    fontSize: 13,
    lineHeight: 18,
    marginBottom: 16,
  },
  label: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', marginBottom: 8 },
  error: { color: colors.danger, fontSize: 13, marginBottom: 12, lineHeight: 18 },
  histTop: { flexDirection: 'row', justifyContent: 'space-between', gap: 8 },
  histTitle: { color: colors.textPrimary, fontSize: 14, fontWeight: '700', flex: 1 },
  histTime: { color: colors.textMuted, fontSize: 12 },
  histMsg: { color: colors.textSecondary, fontSize: 13, marginTop: 4 },
  histBottom: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 10 },
  histClicks: { color: colors.textMuted, fontSize: 12 },
  resend: { color: colors.accent, fontSize: 13, fontWeight: '700' },
});

export default NotificationsPanel;
