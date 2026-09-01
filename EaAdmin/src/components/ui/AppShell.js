import React, { useMemo, useState } from 'react';
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

const DESKTOP_BREAKPOINT = 1024;

const AppShell = ({
  navItems,
  navGroups,
  primaryNavItems,
  menuNavItems,
  activeTab,
  onSelectTab,
  title,
  subtitle,
  onOpenNotifications,
  children,
}) => {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;
  const [menuOpen, setMenuOpen] = useState(false);

  const desktopGroups = useMemo(() => {
    if (navGroups?.length) return navGroups;
    return [{ label: null, items: navItems || [...(primaryNavItems || []), ...(menuNavItems || [])] }];
  }, [navGroups, navItems, primaryNavItems, menuNavItems]);

  const mobilePrimary = primaryNavItems || [];
  const mobileMenu = menuNavItems || [];

  const selectTab = (tabId) => {
    onSelectTab(tabId);
    setMenuOpen(false);
  };

  const renderNavButton = (item) => {
    const focused = item.id === activeTab;
    return (
      <TouchableOpacity
        key={item.id}
        style={[styles.sidebarItem, focused && styles.sidebarItemActive]}
        onPress={() => selectTab(item.id)}
        activeOpacity={0.85}>
        <View style={[styles.navIconWrap, focused && styles.navIconWrapActive]}>
          <Icon name={item.icon} size={18} color={focused ? colors.primary : colors.textSecondary} />
        </View>
        <Text style={[styles.sidebarText, focused && styles.sidebarTextActive]} numberOfLines={1}>
          {item.label}
        </Text>
      </TouchableOpacity>
    );
  };

  const renderSidebar = () => (
    <View style={styles.sidebar}>
      <View style={styles.brandBlock}>
        <LinearGradient
          colors={['#14b8a6', '#6366f1']}
          style={styles.brandIcon}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}>
          <Icon name="shield-crown-outline" size={20} color="#fff" />
        </LinearGradient>
        <View style={{ flex: 1 }}>
          <Text style={styles.brandTitle}>EaAdmin</Text>
          <Text style={styles.brandSub}>Control studio</Text>
        </View>
      </View>

      <ScrollView style={styles.navList} showsVerticalScrollIndicator={false}>
        {desktopGroups.map((group) => (
          <View key={group.label || 'main'} style={styles.navGroup}>
            {group.label ? <Text style={styles.navGroupLabel}>{group.label}</Text> : null}
            {group.items.map((item) => renderNavButton(item))}
          </View>
        ))}
      </ScrollView>
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
            <View>
              <Text style={styles.menuKicker}>EaAdmin</Text>
              <Text style={styles.menuTitle}>More tools</Text>
            </View>
            <TouchableOpacity onPress={() => setMenuOpen(false)} hitSlop={12}>
              <Icon name="close" size={22} color={colors.textSecondary} />
            </TouchableOpacity>
          </View>
          <ScrollView showsVerticalScrollIndicator={false}>
            {desktopGroups.map((group) => (
              <View key={`m-${group.label || 'main'}`} style={styles.drawerGroup}>
                {group.label ? <Text style={styles.navGroupLabel}>{group.label}</Text> : null}
                {group.items.map((item) => {
                  const focused = item.id === activeTab;
                  return (
                    <TouchableOpacity
                      key={item.id}
                      style={[styles.menuItem, focused && styles.menuItemActive]}
                      onPress={() => selectTab(item.id)}>
                      <View style={[styles.navIconWrap, focused && styles.navIconWrapActive]}>
                        <Icon
                          name={item.icon}
                          size={18}
                          color={focused ? colors.primary : colors.textSecondary}
                        />
                      </View>
                      <Text style={[styles.menuItemText, focused && styles.menuItemTextActive]}>
                        {item.label}
                      </Text>
                      {focused ? <Icon name="chevron-right" size={18} color={colors.primary} /> : null}
                    </TouchableOpacity>
                  );
                })}
              </View>
            ))}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <View style={styles.topBarLeft}>
        {!isDesktop ? (
          <TouchableOpacity
            style={styles.menuButton}
            onPress={() => setMenuOpen(true)}
            hitSlop={8}>
            <Icon name="menu" size={22} color={colors.textPrimary} />
          </TouchableOpacity>
        ) : null}
        <View style={{ flex: 1 }}>
          <Text style={styles.pageTitle} numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Text style={styles.pageSubtitle} numberOfLines={1}>
              {subtitle}
            </Text>
          ) : null}
        </View>
      </View>
      <TouchableOpacity style={styles.topAction} onPress={onOpenNotifications}>
        <Icon name="bell-outline" size={20} color={colors.primary} />
      </TouchableOpacity>
    </View>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={['#05070d', '#07111c', '#05070d']}
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
                  <View style={[styles.mobileIcon, focused && styles.mobileIconActive]}>
                    <Icon
                      name={item.icon}
                      size={20}
                      color={focused ? colors.primary : colors.textMuted}
                    />
                  </View>
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
    width: 248,
    paddingHorizontal: 12,
    paddingTop: 18,
    paddingBottom: 12,
    backgroundColor: colors.panel,
    borderRightWidth: 1,
    borderRightColor: colors.border,
  },
  brandBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 18,
    paddingHorizontal: 6,
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
    fontSize: 17,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  brandSub: {
    fontSize: 11,
    color: colors.textMuted,
    marginTop: 1,
    letterSpacing: 0.4,
    textTransform: 'uppercase',
  },
  navList: {
    flex: 1,
  },
  navGroup: {
    marginBottom: 14,
  },
  navGroupLabel: {
    fontSize: 10,
    fontWeight: '800',
    color: colors.textMuted,
    letterSpacing: 1.2,
    textTransform: 'uppercase',
    paddingHorizontal: 10,
    marginBottom: 6,
    marginTop: 4,
  },
  sidebarItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    paddingHorizontal: 8,
    borderRadius: 12,
    marginBottom: 4,
  },
  sidebarItemActive: {
    backgroundColor: colors.primaryDim,
  },
  navIconWrap: {
    width: 32,
    height: 32,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.03)',
  },
  navIconWrapActive: {
    backgroundColor: 'rgba(20, 184, 166, 0.18)',
  },
  sidebarText: {
    marginLeft: 10,
    fontSize: 13.5,
    color: colors.textSecondary,
    fontWeight: '600',
    flex: 1,
  },
  sidebarTextActive: {
    color: colors.textPrimary,
  },
  mainArea: {
    flex: 1,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
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
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 8,
    backgroundColor: colors.panelMuted,
    borderWidth: 1,
    borderColor: colors.border,
  },
  pageTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    letterSpacing: -0.3,
  },
  pageSubtitle: {
    fontSize: 12,
    color: colors.textMuted,
    marginTop: 2,
  },
  topAction: {
    width: 40,
    height: 40,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: colors.panelMuted,
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
    backgroundColor: '#070b14',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 6,
    paddingBottom: 8,
    paddingHorizontal: 6,
  },
  mobileNavItem: {
    flex: 1,
    alignItems: 'center',
  },
  mobileIcon: {
    width: 44,
    height: 30,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mobileIconActive: {
    backgroundColor: colors.primaryDim,
  },
  mobileNavText: {
    marginTop: 2,
    fontSize: 10,
    color: colors.textMuted,
    fontWeight: '600',
  },
  mobileNavTextActive: {
    color: colors.primary,
  },
  menuBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.62)',
    flexDirection: 'row',
  },
  menuPanel: {
    width: '82%',
    maxWidth: 320,
    backgroundColor: colors.panel,
    borderRightWidth: 1,
    borderRightColor: colors.border,
    paddingTop: 10,
    paddingBottom: 28,
  },
  menuHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 18,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    marginBottom: 8,
  },
  menuKicker: {
    fontSize: 11,
    color: colors.primary,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
  },
  menuTitle: {
    fontSize: 18,
    fontWeight: '800',
    color: colors.textPrimary,
    marginTop: 2,
  },
  drawerGroup: {
    paddingHorizontal: 8,
    marginBottom: 8,
  },
  menuItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 10,
    paddingHorizontal: 10,
    borderRadius: 12,
    gap: 10,
  },
  menuItemActive: {
    backgroundColor: colors.primaryDim,
  },
  menuItemText: {
    flex: 1,
    fontSize: 15,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  menuItemTextActive: {
    color: colors.textPrimary,
  },
});

export default AppShell;
