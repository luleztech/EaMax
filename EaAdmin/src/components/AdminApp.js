import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import DashboardSection from './sections/DashboardSection';
import UsersSection from './sections/UsersSection';
import ContentSection from './sections/ContentSection';
import AdsSection from './sections/AdsSection';
import AnalyticsSection from './sections/AnalyticsSection';
import SettingsSection from './sections/SettingsSection';
import NotificationsPanel from './NotificationsPanel';

const { width } = Dimensions.get('window');

const AdminApp = () => {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [notificationsPanelVisible, setNotificationsPanelVisible] = useState(false);
  const [dashboardRefreshTrigger, setDashboardRefreshTrigger] = useState(0);

  const renderContent = () => {
    switch (activeTab) {
      case 'dashboard':
        return (
          <DashboardSection
            onNavigate={setActiveTab}
            refreshTrigger={dashboardRefreshTrigger}
          />
        );
      case 'users':
        return <UsersSection />;
      case 'content':
        return <ContentSection />;
      case 'ads':
        return <AdsSection />;
      case 'analytics':
        return <AnalyticsSection />;
      case 'settings':
        return <SettingsSection />;
      default:
        return <DashboardSection />;
    }
  };


  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <LinearGradient
        colors={['#030712', '#111827', '#1f2937']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />

      {/* Header */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <View style={styles.logoContainer}>
            <LinearGradient
              colors={['#a855f7', '#10b981']}
              style={styles.logoGradient}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}>
              <Icon name="shield-check" size={24} color="#fff" />
            </LinearGradient>
            <View style={styles.logoText}>
              <Text style={styles.logoTitle}>EaAdmin Dashboard</Text>
            </View>
          </View>
        </View>
        <View style={styles.headerRight}>
          <TouchableOpacity
            style={styles.headerButton}
            onPress={() => setNotificationsPanelVisible(true)}>
            <Icon name="bell-outline" size={20} color="#9ca3af" />
          </TouchableOpacity>
        </View>
      </View>

      {/* Content Area */}
      <View style={styles.contentArea}>
        {renderContent()}
      </View>

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('dashboard')}>
          <Icon
            name="view-dashboard"
            size={24}
            color={activeTab === 'dashboard' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'dashboard' && styles.navTextActive,
            ]}>
            Dashboard
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('users')}>
          <Icon
            name="account-group"
            size={24}
            color={activeTab === 'users' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'users' && styles.navTextActive,
            ]}>
            Users
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('content')}>
          <Icon
            name="movie-open"
            size={24}
            color={activeTab === 'content' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'content' && styles.navTextActive,
            ]}>
            Channels
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('ads')}>
          <Icon
            name="bullhorn"
            size={24}
            color={activeTab === 'ads' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'ads' && styles.navTextActive,
            ]}>
            Ads
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('analytics')}>
          <Icon
            name="chart-bar"
            size={24}
            color={activeTab === 'analytics' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'analytics' && styles.navTextActive,
            ]}>
            Analytics
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('settings')}>
          <Icon
            name="cog"
            size={24}
            color={activeTab === 'settings' ? '#a855f7' : '#6b7280'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'settings' && styles.navTextActive,
            ]}>
            Settings
          </Text>
        </TouchableOpacity>
      </View>

      {/* Notifications Panel */}
      <NotificationsPanel
        visible={notificationsPanelVisible}
        onClose={() => setNotificationsPanelVisible(false)}
        onNotificationSent={() => setDashboardRefreshTrigger((k) => k + 1)}
      />
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#030712',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingVertical: 12,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  headerLeft: {
    flex: 1,
  },
  logoContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  logoGradient: {
    width: 40,
    height: 40,
    borderRadius: 10,
    justifyContent: 'center',
    alignItems: 'center',
  },
  logoText: {
    gap: 2,
  },
  logoTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  headerButton: {
    padding: 8,
    borderRadius: 8,
  },
  contentArea: {
    flex: 1,
  },
  bottomNav: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingVertical: 8,
    paddingBottom: 8,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
    paddingVertical: 4,
    minWidth: 60,
  },
  navText: {
    fontSize: 10,
    color: '#6b7280',
  },
  navTextActive: {
    color: '#a855f7',
    fontWeight: '600',
  },
});

export default AdminApp;
