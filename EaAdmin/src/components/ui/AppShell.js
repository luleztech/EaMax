import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import colors from '../../theme/colors';

const DESKTOP_BREAKPOINT = 1100;

const AppShell = ({
  navItems,
  activeTab,
  onSelectTab,
  title,
  subtitle,
  onOpenNotifications,
  children,
}) => {
  const { width } = useWindowDimensions();
  const isDesktop = width >= DESKTOP_BREAKPOINT;

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
          <Text style={styles.brandSubtitle}>Control Center</Text>
        </View>
      </View>

      <View style={styles.navList}>
        {navItems.map((item) => {
          const focused = item.id === activeTab;
          return (
            <TouchableOpacity
              key={item.id}
              style={[styles.sidebarItem, focused && styles.sidebarItemActive]}
              onPress={() => onSelectTab(item.id)}>
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

  const renderTopBar = () => (
    <View style={styles.topBar}>
      <View style={styles.topBarTextContainer}>
        <Text style={styles.pageTitle}>{title}</Text>
        {!!subtitle && <Text style={styles.pageSubtitle}>{subtitle}</Text>}
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
            {navItems.map((item) => {
              const focused = item.id === activeTab;
              return (
                <TouchableOpacity
                  key={item.id}
                  style={styles.mobileNavItem}
                  onPress={() => onSelectTab(item.id)}>
                  <Icon
                    name={item.icon}
                    size={21}
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
  brandSubtitle: {
    marginTop: 1,
    fontSize: 12,
    color: colors.textSecondary,
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
    paddingHorizontal: 18,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
    backgroundColor: colors.panelSoft,
  },
  topBarTextContainer: {
    flex: 1,
  },
  pageTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  pageSubtitle: {
    marginTop: 2,
    fontSize: 12,
    color: colors.textSecondary,
  },
  topAction: {
    width: 38,
    height: 38,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 12,
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
    justifyContent: 'space-between',
    backgroundColor: 'rgba(3, 7, 18, 0.98)',
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  mobileNavItem: {
    flex: 1,
    alignItems: 'center',
  },
  mobileNavText: {
    marginTop: 3,
    fontSize: 10,
    color: colors.textMuted,
  },
  mobileNavTextActive: {
    color: colors.primary,
    fontWeight: '600',
  },
});

export default AppShell;
