import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  TextInput,
  Modal,
  Pressable,
  ActivityIndicator,
  ScrollView,
  KeyboardAvoidingView,
  Platform,
  ToastAndroid,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import colors, { radii } from '../../theme/colors';

/* ---------- helpers ---------- */

export const compact = (value) => {
  const n = Number(value) || 0;
  if (n >= 1000000) return `${(n / 1000000).toFixed(1).replace(/\.0$/, '')}m`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  return String(n);
};

export const formatTsh = (n) => `TSh ${Math.round(Number(n) || 0).toLocaleString('en-US')}`;

export const timeAgo = (iso) => {
  if (!iso) return '';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '';
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 60) return 'now';
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d`;
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
};

export const toast = (msg) => {
  const text = String(msg || '').slice(0, 140);
  if (Platform.OS === 'android') ToastAndroid.show(text, ToastAndroid.SHORT);
};

/* ---------- layout ---------- */

export const Card = ({ children, style, onPress, padded = true }) => {
  const body = [styles.card, padded && styles.cardPad, style];
  if (onPress) {
    return (
      <TouchableOpacity activeOpacity={0.8} onPress={onPress} style={body}>
        {children}
      </TouchableOpacity>
    );
  }
  return <View style={body}>{children}</View>;
};

export const SectionTitle = ({ title, action, onAction }) => (
  <View style={styles.sectionRow}>
    <Text style={styles.sectionTitle}>{title}</Text>
    {action ? (
      <TouchableOpacity onPress={onAction} hitSlop={10}>
        <Text style={styles.sectionAction}>{action}</Text>
      </TouchableOpacity>
    ) : null}
  </View>
);

export const Stat = ({ label, value, icon, hint, style }) => (
  <View style={[styles.stat, style]}>
    <View style={styles.statTop}>
      <Text style={styles.statLabel} numberOfLines={1}>
        {label}
      </Text>
      {icon ? <Icon name={icon} size={16} color={colors.accent} /> : null}
    </View>
    <Text style={styles.statValue} numberOfLines={1} adjustsFontSizeToFit>
      {value}
    </Text>
    {hint ? (
      <Text style={styles.statHint} numberOfLines={1}>
        {hint}
      </Text>
    ) : null}
  </View>
);

export const Row = ({ children, style }) => <View style={[styles.row, style]}>{children}</View>;

export const Divider = () => <View style={styles.divider} />;

/* ---------- controls ---------- */

export const Button = ({
  label,
  onPress,
  icon,
  variant = 'primary', // primary | secondary | ghost | danger
  loading,
  disabled,
  style,
  small,
}) => {
  const isPrimary = variant === 'primary';
  const fg =
    isPrimary ? colors.onAccent : variant === 'danger' ? colors.danger : colors.textPrimary;
  return (
    <TouchableOpacity
      activeOpacity={0.8}
      disabled={disabled || loading}
      onPress={onPress}
      style={[
        styles.btn,
        small && styles.btnSmall,
        variant === 'primary' && styles.btnPrimary,
        variant === 'secondary' && styles.btnSecondary,
        variant === 'ghost' && styles.btnGhost,
        variant === 'danger' && styles.btnDanger,
        (disabled || loading) && { opacity: 0.55 },
        style,
      ]}>
      {loading ? (
        <ActivityIndicator size="small" color={fg} />
      ) : (
        <>
          {icon ? <Icon name={icon} size={small ? 16 : 18} color={fg} /> : null}
          {label ? (
            <Text style={[styles.btnText, small && styles.btnTextSmall, { color: fg }]}>
              {label}
            </Text>
          ) : null}
        </>
      )}
    </TouchableOpacity>
  );
};

export const IconButton = ({ icon, onPress, size = 20, color = colors.textSecondary, style }) => (
  <TouchableOpacity
    onPress={onPress}
    activeOpacity={0.7}
    hitSlop={8}
    style={[styles.iconBtn, style]}>
    <Icon name={icon} size={size} color={color} />
  </TouchableOpacity>
);

export const Chip = ({ label, active, onPress, count, icon }) => (
  <TouchableOpacity
    activeOpacity={0.8}
    onPress={onPress}
    style={[styles.chip, active && styles.chipActive]}>
    {icon ? (
      <Icon name={icon} size={14} color={active ? colors.onAccent : colors.textSecondary} />
    ) : null}
    <Text style={[styles.chipText, active && styles.chipTextActive]}>{label}</Text>
    {count != null ? (
      <Text style={[styles.chipCount, active && styles.chipTextActive]}>{count}</Text>
    ) : null}
  </TouchableOpacity>
);

export const ChipRow = ({ children }) => (
  <ScrollView
    horizontal
    showsHorizontalScrollIndicator={false}
    contentContainerStyle={styles.chipRow}
    keyboardShouldPersistTaps="handled">
    {children}
  </ScrollView>
);

export const SearchBar = ({ value, onChangeText, placeholder = 'Search', style }) => (
  <View style={[styles.search, style]}>
    <Icon name="magnify" size={18} color={colors.textMuted} />
    <TextInput
      style={styles.searchInput}
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.textMuted}
      autoCapitalize="none"
      autoCorrect={false}
    />
    {value ? (
      <TouchableOpacity onPress={() => onChangeText('')} hitSlop={10}>
        <Icon name="close-circle" size={16} color={colors.textMuted} />
      </TouchableOpacity>
    ) : null}
  </View>
);

export const Field = ({ label, children, hint }) => (
  <View style={styles.field}>
    {label ? <Text style={styles.fieldLabel}>{label}</Text> : null}
    {children}
    {hint ? <Text style={styles.fieldHint}>{hint}</Text> : null}
  </View>
);

export const Input = (props) => (
  <TextInput
    placeholderTextColor={colors.textMuted}
    autoCapitalize="none"
    autoCorrect={false}
    {...props}
    style={[styles.input, props.multiline && styles.inputMulti, props.style]}
  />
);

export const Badge = ({ label, tone = 'neutral' }) => {
  const toneColor =
    tone === 'accent'
      ? colors.accent
      : tone === 'success'
        ? colors.success
        : tone === 'warning'
          ? colors.warning
          : tone === 'danger'
            ? colors.danger
            : colors.textSecondary;
  return (
    <View style={[styles.badge, { borderColor: `${toneColor}55`, backgroundColor: `${toneColor}1a` }]}>
      <Text style={[styles.badgeText, { color: toneColor }]}>{label}</Text>
    </View>
  );
};

export const Avatar = ({ text, size = 40 }) => (
  <View style={[styles.avatar, { width: size, height: size, borderRadius: size / 2 }]}>
    <Text style={[styles.avatarText, { fontSize: size * 0.36 }]}>
      {String(text || '?').slice(0, 2).toUpperCase()}
    </Text>
  </View>
);

export const Empty = ({ icon = 'tray', title, sub }) => (
  <View style={styles.empty}>
    <Icon name={icon} size={34} color={colors.textMuted} />
    <Text style={styles.emptyTitle}>{title}</Text>
    {sub ? <Text style={styles.emptySub}>{sub}</Text> : null}
  </View>
);

export const Loading = () => (
  <View style={styles.empty}>
    <ActivityIndicator color={colors.accent} />
  </View>
);

/** Simple horizontal bar (single accent). */
export const Bar = ({ pct, height = 6 }) => (
  <View style={[styles.barTrack, { height, borderRadius: height / 2 }]}>
    <View
      style={{
        width: `${Math.max(2, Math.min(100, pct || 0))}%`,
        height,
        borderRadius: height / 2,
        backgroundColor: colors.accent,
      }}
    />
  </View>
);

/** Bottom sheet modal. */
export const Sheet = ({ visible, onClose, title, children, footer, full }) => (
  <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Pressable style={styles.sheetBackdrop} onPress={onClose}>
        <Pressable
          style={[styles.sheet, full && { height: '92%' }]}
          onPress={(e) => e.stopPropagation()}>
          <View style={styles.sheetGrab} />
          <View style={styles.sheetHeader}>
            <Text style={styles.sheetTitle} numberOfLines={1}>
              {title}
            </Text>
            <IconButton icon="close" onPress={onClose} />
          </View>
          <ScrollView
            style={{ flexShrink: 1 }}
            contentContainerStyle={styles.sheetBody}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}>
            {children}
          </ScrollView>
          {footer ? <View style={styles.sheetFooter}>{footer}</View> : null}
        </Pressable>
      </Pressable>
    </KeyboardAvoidingView>
  </Modal>
);

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.panel,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
  },
  cardPad: { padding: 14 },
  sectionRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 22,
    marginBottom: 10,
  },
  sectionTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: '700',
    letterSpacing: -0.2,
  },
  sectionAction: { color: colors.accent, fontSize: 13, fontWeight: '600' },
  stat: {
    flex: 1,
    backgroundColor: colors.panel,
    borderRadius: radii.lg,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 14,
  },
  statTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  statLabel: { color: colors.textSecondary, fontSize: 12, fontWeight: '600', flex: 1 },
  statValue: {
    color: colors.textPrimary,
    fontSize: 24,
    fontWeight: '800',
    marginTop: 8,
    letterSpacing: -0.5,
  },
  statHint: { color: colors.textMuted, fontSize: 11, marginTop: 2 },
  row: { flexDirection: 'row', alignItems: 'center' },
  divider: { height: 1, backgroundColor: colors.borderSoft },

  btn: {
    height: 46,
    borderRadius: radii.md,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  btnSmall: { height: 36, paddingHorizontal: 12, borderRadius: radii.sm },
  btnPrimary: { backgroundColor: colors.accent },
  btnSecondary: {
    backgroundColor: colors.panelMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnGhost: { backgroundColor: 'transparent' },
  btnDanger: {
    backgroundColor: 'rgba(248,113,113,0.1)',
    borderWidth: 1,
    borderColor: 'rgba(248,113,113,0.3)',
  },
  btnText: { fontSize: 15, fontWeight: '700' },
  btnTextSmall: { fontSize: 13 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 19,
    alignItems: 'center',
    justifyContent: 'center',
  },

  chipRow: { gap: 8, paddingRight: 16 },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 34,
    paddingHorizontal: 13,
    borderRadius: radii.pill,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  chipText: { color: colors.textSecondary, fontSize: 13, fontWeight: '600' },
  chipTextActive: { color: colors.onAccent },
  chipCount: { color: colors.textMuted, fontSize: 11, fontWeight: '700' },

  search: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    height: 44,
    paddingHorizontal: 12,
    borderRadius: radii.md,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  searchInput: { flex: 1, color: colors.textPrimary, fontSize: 14, padding: 0 },

  field: { marginBottom: 14 },
  fieldLabel: {
    color: colors.textSecondary,
    fontSize: 12,
    fontWeight: '600',
    marginBottom: 6,
  },
  fieldHint: { color: colors.textMuted, fontSize: 11, marginTop: 5 },
  input: {
    minHeight: 46,
    borderRadius: radii.md,
    backgroundColor: colors.panelMuted,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: 14,
    paddingHorizontal: 12,
  },
  inputMulti: { minHeight: 96, paddingTop: 12, textAlignVertical: 'top' },

  badge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: radii.pill,
    borderWidth: 1,
  },
  badgeText: { fontSize: 11, fontWeight: '700' },
  avatar: {
    backgroundColor: colors.accentDim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarText: { color: colors.accent, fontWeight: '800' },

  empty: { alignItems: 'center', justifyContent: 'center', padding: 36, gap: 8 },
  emptyTitle: { color: colors.textSecondary, fontSize: 14, fontWeight: '600' },
  emptySub: { color: colors.textMuted, fontSize: 12, textAlign: 'center' },

  barTrack: { backgroundColor: colors.panelMuted, overflow: 'hidden' },

  sheetBackdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    maxHeight: '92%',
  },
  sheetGrab: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: 8,
  },
  sheetHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingLeft: 18,
    paddingRight: 8,
    paddingTop: 6,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: 17, fontWeight: '800', flex: 1 },
  sheetBody: { padding: 18, paddingTop: 10 },
  sheetFooter: {
    padding: 14,
    paddingBottom: 18,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    flexDirection: 'row',
    gap: 10,
  },
});
