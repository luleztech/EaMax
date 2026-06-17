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
      { id: 'overview', label: 'Overview', shortLabel: 'Home', icon: 'view-dashboard' },
      { id: 'users', label: 'Users', shortLabel: 'Users', icon: 'account-group' },
      { id: 'channels', label: 'Channels', shortLabel: 'Channels', icon: 'movie-open' },
      { id: 'control', label: 'Control Center', shortLabel: 'Control', icon: 'shield-alert' },
    ],
    []
  );

  const menuNavItems = useMemo(
    () => [
      { id: 'promotions', label: 'Promotion Center', icon: 'bullhorn-variant' },
      { id: 'plans', label: 'Vifurushi', icon: 'cash-multiple' },
      { id: 'ads', label: 'Ads & Points', icon: 'bullhorn' },
      { id: 'analytics', label: 'Analytics', icon: 'chart-bar' },
      { id: 'settings', label: 'Settings', icon: 'cog' },
    ],
    []
  );

  const navItems = useMemo(
    () => [...primaryNavItems, ...menuNavItems],
    [primaryNavItems, menuNavItems]
  );

  const activeMeta = useMemo(() => {
    const map = {
      overview: { title: 'Overview' },
      users: { title: 'Users' },
      channels: { title: 'Channels' },
      promotions: { title: 'Promotion Center' },
      plans: { title: 'Vifurushi' },
      control: { title: 'Control Center' },
      ads: { title: 'Ads & Points' },
      analytics: { title: 'Analytics' },
      settings: { title: 'Settings' },
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
      primaryNavItems={primaryNavItems}
      menuNavItems={menuNavItems}
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId)}
      title={activeMeta.title}
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
