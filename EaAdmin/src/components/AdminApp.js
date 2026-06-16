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

  const navItems = useMemo(
    () => [
      { id: 'overview', label: 'Overview', shortLabel: 'Home', icon: 'view-dashboard' },
      { id: 'users', label: 'Users', shortLabel: 'Users', icon: 'account-group' },
      { id: 'channels', label: 'Channels', shortLabel: 'Channels', icon: 'movie-open' },
      { id: 'promotions', label: 'Promotion Center', shortLabel: 'Promo', icon: 'bullhorn-variant' },
      { id: 'plans', label: 'Subscription Plans', shortLabel: 'Plans', icon: 'cash-multiple' },
      { id: 'control', label: 'Control Center', shortLabel: 'Control', icon: 'shield-alert' },
      { id: 'ads', label: 'Ads & Points', shortLabel: 'Ads', icon: 'bullhorn' },
      { id: 'analytics', label: 'Analytics', shortLabel: 'Stats', icon: 'chart-bar' },
      { id: 'settings', label: 'Settings', shortLabel: 'Settings', icon: 'cog' },
    ],
    []
  );

  const activeMeta = useMemo(() => {
    const map = {
      overview: {
        title: 'Overview',
        subtitle: '',
      },
      users: {
        title: 'Users Management',
        subtitle: 'Search, block, and grant premium access quickly',
      },
      channels: {
        title: 'Channels Management',
        subtitle: 'Drag to reorder · Premium · Active — tap to edit',
      },
      promotions: {
        title: 'Promotion Center',
        subtitle: 'Picha · Ujumbe · Tangazo · Ofa',
      },
      plans: {
        title: 'Subscription Plans',
        subtitle: 'Bei na muda wa malipo — inaonekana kwenye app ya wateja',
      },
      control: {
        title: 'Control Center',
        subtitle: 'Dharura, player, flags — wateja hawahitaji kusasisha app',
      },
      ads: {
        title: 'Ads & Points',
        subtitle: 'Matangazo',
      },
      analytics: {
        title: 'Analytics',
        subtitle: 'data kwa ujumla ',
      },
      settings: {
        title: 'Platform Settings',
        subtitle: 'mpangilioo',
      },
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
      activeTab={activeTab}
      onSelectTab={(tabId) => setActiveTab(tabId)}
      title={activeMeta.title}
      subtitle={activeMeta.subtitle}
      onOpenNotifications={() => setNotificationsPanelVisible(true)}>
      {renderSection()}
      {/* Notifications Panel */}
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
