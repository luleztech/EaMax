import React, { useMemo, useState } from 'react';
import DashboardSection from './sections/DashboardSection';
import UsersSection from './sections/UsersSection';
import ContentSection from './sections/ContentSection';
import AdsSection from './sections/AdsSection';
import AnalyticsSection from './sections/AnalyticsSection';
import SettingsSection from './sections/SettingsSection';
import PromotionSection from './sections/PromotionSection';
import SubscriptionPlansSection from './sections/SubscriptionPlansSection';
import ControlCenterSection from './sections/ControlCenterSection';
import NotificationsPanel from './NotificationsPanel';
import AppShell from './ui/AppShell';

const AdminApp = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [notificationsPanelVisible, setNotificationsPanelVisible] = useState(false);
  const [dashboardRefreshTrigger, setDashboardRefreshTrigger] = useState(0);

  const primaryNavItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview', shortLabel: 'Home', icon: 'view-dashboard-outline' },
      { id: 'users', label: 'Users', shortLabel: 'Users', icon: 'account-group-outline' },
      { id: 'channels', label: 'Channels', shortLabel: 'Library', icon: 'television-classic' },
      { id: 'control', label: 'Control', shortLabel: 'Control', icon: 'tune-variant' },
    ],
    []
  );

  const menuNavItems = useMemo(
    () => [
      { id: 'promotions', label: 'Promotions', icon: 'bullhorn-variant-outline' },
      { id: 'plans', label: 'Vifurushi', icon: 'ticket-percent-outline' },
      { id: 'ads', label: 'Ads & Points', icon: 'chart-box-outline' },
      { id: 'analytics', label: 'Analytics', icon: 'chart-timeline-variant' },
      { id: 'settings', label: 'Settings', icon: 'cog-outline' },
    ],
    []
  );

  const navGroups = useMemo(
    () => [
      { label: 'Operate', items: primaryNavItems.slice(0, 2) },
      { label: 'Library', items: [primaryNavItems[2], primaryNavItems[3]] },
      { label: 'Grow', items: menuNavItems.slice(0, 3) },
      { label: 'System', items: menuNavItems.slice(3) },
    ],
    [primaryNavItems, menuNavItems]
  );

  const navItems = useMemo(
    () => [...primaryNavItems, ...menuNavItems],
    [primaryNavItems, menuNavItems]
  );

  const activeMeta = useMemo(() => {
    const map = {
      overview: { title: 'Overview', subtitle: 'Live installs, revenue, and home content' },
      users: { title: 'Users', subtitle: 'Search, access, and subscription status' },
      channels: { title: 'Channel library', subtitle: 'Thumbnails, categories, and order' },
      promotions: { title: 'Promotions', subtitle: 'In-app offers and announcements' },
      plans: { title: 'Vifurushi', subtitle: 'Premium packages and pricing' },
      control: { title: 'Control Center', subtitle: 'Player engine and emergency switches' },
      ads: { title: 'Ads & Points', subtitle: 'Watch activity and rewards' },
      analytics: { title: 'Analytics', subtitle: 'Playback and platform mix' },
      settings: { title: 'Settings', subtitle: 'Support, access, and payments' },
    };
    return map[activeTab] || map.overview;
  }, [activeTab]);

  const renderSection = () => {
    switch (activeTab) {
      case 'overview':
        return (
          <DashboardSection refreshTrigger={dashboardRefreshTrigger} />
        );
      case 'users':
        return <UsersSection isActive={activeTab === 'users'} />;
      case 'channels':
        return <ContentSection />;
      case 'promotions':
        return <PromotionSection />;
      case 'plans':
        return <SubscriptionPlansSection />;
      case 'control':
        return <ControlCenterSection />;
      case 'ads':
        return <AdsSection />;
      case 'analytics':
        return <AnalyticsSection isActive={activeTab === 'analytics'} />;
      case 'settings':
        return <SettingsSection />;
      default:
        return (
          <DashboardSection refreshTrigger={dashboardRefreshTrigger} />
        );
    }
  };

  return (
    <AppShell
      navItems={navItems}
      navGroups={navGroups}
      primaryNavItems={primaryNavItems}
      menuNavItems={menuNavItems}
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId)}
      title={activeMeta.title}
      subtitle={activeMeta.subtitle}
      onOpenNotifications={() => setNotificationsPanelVisible(true)}>
      {renderSection()}
      <NotificationsPanel
        visible={notificationsPanelVisible}
        onClose={() => setNotificationsPanelVisible(false)}
        onNotificationSent={() => {
          setDashboardRefreshTrigger((k) => k + 1);
        }}
      />
    </AppShell>
  );
};

export default AdminApp;
