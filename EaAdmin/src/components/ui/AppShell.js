import React, { useState } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Modal, Pressable } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import colors from '../../theme/colors';

/**
 * Flat app shell: top bar, content, bottom tabs.
 * `tabs` are pinned in the bottom bar; `moreItems` live in the "More" sheet.
 */
const AppShell = ({
  tabs,
  moreItems,
  activeTab,
  onSelectTab,
  title,
  subtitle,
  onOpenNotifications,
  children,
}) => {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = (moreItems || []).some((i) => i.id === activeTab);

  const select = (id) => {
    setMoreOpen(false);
    onSelectTab(id);
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      <View style={styles.topBar}>
        <View style={{ flex: 1 }}>
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.subtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
        <TouchableOpacity style={styles.sendBtn} onPress={onOpenNotifications} activeOpacity={0.8}>
          <Icon name="bell-ring-outline" size={18} color={colors.onAccent} />
          <Text style={styles.sendBtnText}>Notify all</Text>
        </TouchableOpacity>
      </View>

      <View style={styles.body}>{children}</View>

      <View style={styles.nav}>
        {tabs.map((t) => {
          const focused = t.id === activeTab;
          return (
            <TouchableOpacity
              key={t.id}
              style={styles.navItem}
              activeOpacity={0.7}
              onPress={() => select(t.id)}>
              <Icon name={t.icon} size={22} color={focused ? colors.accent : colors.textMuted} />
              <Text style={[styles.navText, focused && styles.navTextActive]}>{t.label}</Text>
            </TouchableOpacity>
          );
        })}
        <TouchableOpacity
          style={styles.navItem}
          activeOpacity={0.7}
          onPress={() => setMoreOpen(true)}>
          <Icon
            name="dots-grid"
            size={22}
            color={moreActive ? colors.accent : colors.textMuted}
          />
          <Text style={[styles.navText, moreActive && styles.navTextActive]}>More</Text>
        </TouchableOpacity>
      </View>

      <Modal
        visible={moreOpen}
        transparent
        animationType="slide"
        onRequestClose={() => setMoreOpen(false)}>
        <Pressable style={styles.backdrop} onPress={() => setMoreOpen(false)}>
          <Pressable style={styles.sheet} onPress={(e) => e.stopPropagation()}>
            <View style={styles.grab} />
            <View style={styles.grid}>
              {(moreItems || []).map((item) => {
                const focused = item.id === activeTab;
                return (
                  <TouchableOpacity
                    key={item.id}
                    style={[styles.tile, focused && styles.tileActive]}
                    activeOpacity={0.8}
                    onPress={() => select(item.id)}>
                    <Icon
                      name={item.icon}
                      size={24}
                      color={focused ? colors.accent : colors.textSecondary}
                    />
                    <Text style={[styles.tileText, focused && { color: colors.accent }]}>
                      {item.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.background },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 12,
  },
  title: { color: colors.textPrimary, fontSize: 22, fontWeight: '800', letterSpacing: -0.5 },
  subtitle: { color: colors.textMuted, fontSize: 12, marginTop: 1 },
  sendBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingHorizontal: 14,
    borderRadius: 19,
    backgroundColor: colors.accent,
  },
  sendBtnText: { color: colors.onAccent, fontSize: 13, fontWeight: '800' },
  body: { flex: 1 },
  nav: {
    flexDirection: 'row',
    backgroundColor: colors.panel,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
    paddingBottom: 6,
  },
  navItem: { flex: 1, alignItems: 'center', gap: 3, paddingVertical: 2 },
  navText: { color: colors.textMuted, fontSize: 11, fontWeight: '600' },
  navTextActive: { color: colors.accent },
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.backgroundElevated,
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    borderTopWidth: 1,
    borderColor: colors.border,
    paddingBottom: 28,
  },
  grab: {
    alignSelf: 'center',
    width: 38,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
    marginTop: 8,
    marginBottom: 14,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', paddingHorizontal: 12, gap: 10 },
  tile: {
    width: '31%',
    flexGrow: 1,
    alignItems: 'center',
    gap: 8,
    paddingVertical: 18,
    borderRadius: 16,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tileActive: { borderColor: colors.accent, backgroundColor: colors.accentDim },
  tileText: { color: colors.textSecondary, fontSize: 12, fontWeight: '600' },
});

export default AppShell;
