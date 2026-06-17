import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
  Modal,
  Pressable,
  ScrollView,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import colors from '../../theme/colors';

const DESKTOP_BREAKPOINT = 1100;

const AppShell = ({
  navItems,
  primaryNavItems,
  menuNavItems,
  activeTab,
  onSelectTab,
  title,
  onOpenNotifications,
  children,
}) => {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);

  const desktopNav = navItems || [...(primaryNavItems || []), ...(menuNavItems || [])];
  const mobilePrimary = primaryNavItems || desktopNav;
  const mobileMenu = menuNavItems || [];

  const selectTab = (tabId) => {
    onSelectTab(tabId);
    setMenuOpen(false);
  };

  const renderSidebar = () => (
    <View style={styles.sidebar}>
      <View style={styles.brandBlock}>
        <LinearGradient
          colors={[colors.primary, colors.success]}
          style={styles.brandIcon}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <Icon name="shield-crown" size={20} color="#fff" />
        </LinearGradient>
        <View>
          <Text style={styles.brandTitle}>EaAdmin</Text>
        </View>
      </View>

      <View style={styles.navList}>
        {desktopNav.map((item) => {
          const focused = item.id === activeTab;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.sidebarItem, focused && styles.sidebarItemActive]}
              onPress={() => selectTab(item.id)}>
              <Icon
                name={item.icon}
                size={20}
                color={focused ? colors.textPrimary : colors.textSecondary}
              />
              <Text style={[styles.sidebarText, focused && styles.sidebarTextActive]}>
                {item.label}
              </Text>
            </TouchableOpacity>
          );
        })}
      </View>
    </View>
  );

  const renderMenuDrawer = () => (
    <Modal
      visible={menuOpen}
      transparent
      animationType="fade"
      onRequestClose={() => setMenuOpen(false)}>
      <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
        <Pressable style={styles.menuPanel} onPress={(e) => e.stopPropagation()}>
          <View style={styles.menuHeader}>
            <Text style={styles.menuTitle}>Menyu</Text>
            <TouchableOpacity onPress={() => setMenuOpen(false)} hitSlop={12}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {mobileMenu.map((item) => {
              const focused = item.id === activeTab;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={[styles.menuItem, focused && styles.menuItemActive]}
                  onPress={() => selectTab(item.id)}>
                  <Icon
                    name={item.icon}
                    size={22}
                    color={focused ? colors.primary : colors.textSecondary}
                  />
                  <Text style={[styles.menuItemText, focused && styles.menuItemTextActive]}>
                    {item.label}
                  </Text>
                  {focused ? (
                    <Icon name="check" size={18} color={colors.primary} />
                  ) : null}
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        {!isDesktop && mobileMenu.length > 0 ? (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setMenuOpen(true)}
            hitSlop={8}>
            <Icon name="menu" size={24} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : null}
        <Text style={styles.pageTitle} numberOfLines={1}>
          {title}
        </Text>
      </View>
      <TouchableOpacity style={styles.topAction} onPress={onOpenNotifications}>
        <Icon name="bell-outline" size={20} color={colors.textSecondary} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={[colors.background, '#0b1324', '#111827']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {isDesktop ? (
        <View style={styles.desktopLayout}>
          {renderSidebar()}
          <View style={styles.mainArea}>
            {renderTopBar()}
            <View style={styles.pageBody}>{children}</View>
          </View>
        </View>
      ) : (
        <View style={styles.mobileLayout}>
          {renderTopBar()}
          <View style={styles.pageBody}>{children}</View>
          <View style={styles.mobileNav}>
            {mobilePrimary.map((item) => {
              const focused = item.id === activeTab;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.mobileNavItem}
                  onPress={() => selectTab(item.id)}>
                  <Icon
                    name={item.icon}
                    size={22}
                    color={focused ? colors.primary : colors.textMuted}
                  />
                  <Text
                    style={[
                      styles.mobileNavText,
                      focused && styles.mobileNavTextActive,
                    ]}>
                    {item.shortLabel || item.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </View>
          {renderMenuDrawer()}
        </View>
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.background,
  },
  desktopLayout: {
    flex: 1,
    flexDirection: 'row',
  },
  sidebar: {
    width: 260,
    paddingHorizontal: 14,
    paddingVertical: 18,
    backgroundColor: colors.panel,
    borderRightWidth: 1,
    borderRightColor: colors.borderSoft,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 22,
  },
  brandIcon: {
    width: 40,
    height: 40,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  brandTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  navList: {
    marginTop: 8,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 11,
    paddingHorizontal: 10,
    borderRadius: 10,
    marginBottom: 6,
    borderWidth: 1,
    borderColor: 'transparent',
  },
  sidebarItemActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.22)',
    borderColor: 'rgba(168, 85, 247, 0.35)',
  },
  sidebarText: {
    marginLeft: 10,
    fontSize: 14,
    color: colors.textSecondary,
  },
  sidebarTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
  mainArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panelSoft,
  },
  topBarLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    marginRight: 8,
  },
  menuButton: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 6,
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageTitle: {
    flex: 1,
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  topAction: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
  },
  pageBody: {
    flex: 1,
  },
  mobileLayout: {
    flex: 1,
  },
  mobileNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(3, 7, 18, 0.98)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 8,
  },
  mobileNavItem: {
    flex: 1,
    alignItems: 'center',
    paddingHorizontal: 4,
  },
  mobileNavText: {
    marginTop: 3,
    fontSize: 11,
    color: colors.textMuted,
  },
  mobileNavTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.55)',
    flexDirection: 'row',
  },
  menuPanel: {
    width: '78%',
    maxWidth: 300,
    backgroundColor: colors.panel,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 8,
    paddingBottom: 24,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.borderSoft,
    marginBottom: 8,
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 18,
    gap: 12,
  },
  menuItemActive: {
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
  },
  menuItemTextActive: {
    color: colors.textPrimary,
    fontWeight: '600',
  },
});

export default AppShell;
