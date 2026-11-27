import React, { useMemo, useState } from 'react';
import OverviewSection from './sections/OverviewSection';
import DashboardSection from './sections/DashboardSection';
import UsersSection from './sections/UsersSection';
import ChannelsSection from './sections/ChannelsSection';
import AdsSection from './sections/AdsSection';
import AnalyticsSection from './sections/AnalyticsSection';
import SettingsSection from './sections/SettingsSection';
import PromotionSection from './sections/PromotionSection';
import SubscriptionPlansSection from './sections/SubscriptionPlansSection';
import ControlCenterSection from './sections/ControlCenterSection';
import NotificationsPanel from './NotificationsPanel';
import AppShell from './ui/AppShell';

const TABS = [
  { id: 'overview', label: 'Overview', icon: 'view-dashboard-outline' },
  { id: 'users', label: 'Users', icon: 'account-group-outline' },
  { id: 'channels', label: 'Channels', icon: 'television-classic' },
  { id: 'stats', label: 'Stats', icon: 'chart-line' },
];

const MORE = [
  { id: 'home', label: 'Home content', icon: 'home-edit-outline' },
  { id: 'control', label: 'Control', icon: 'tune-variant' },
  { id: 'promotions', label: 'Promotions', icon: 'bullhorn-outline' },
  { id: 'plans', label: 'Plans', icon: 'ticket-percent-outline' },
  { id: 'ads', label: 'Ads & Points', icon: 'gift-outline' },
  { id: 'settings', label: 'Settings', icon: 'cog-outline' },
];

const META = {
  overview: ['Overview', 'Today at a glance'],
  users: ['Users', 'Search, access and reminders'],
  channels: ['Channels', 'Hold and drag to reorder'],
  stats: ['Stats', 'Playback and audience'],
  home: ['Home content', 'Carousels and schedule'],
  control: ['Control', 'Player and emergency switches'],
  promotions: ['Promotions', 'In-app offers'],
  plans: ['Plans', 'Packages and pricing'],
  ads: ['Ads & Points', 'Rewards activity'],
  settings: ['Settings', 'Support and payments'],
};

const AdminApp = () => {
  const [activeTab, setActiveTab] = useState('overview');
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const [title, subtitle] = META[activeTab] || META.overview;

  const content = useMemo(() => {
    switch (activeTab) {
      case 'users':
        return <UsersSection isActive />;
      case 'channels':
        return <ChannelsSection />;
      case 'stats':
        return <AnalyticsSection isActive />;
      case 'home':
        return <DashboardSection refreshTrigger={refreshKey} />;
      case 'control':
        return <ControlCenterSection />;
      case 'promotions':
        return <PromotionSection />;
      case 'plans':
        return <SubscriptionPlansSection />;
      case 'ads':
        return <AdsSection />;
      case 'settings':
        return <SettingsSection />;
      default:
        return (
          <OverviewSection
            refreshKey={refreshKey}
            onNavigate={setActiveTab}
            onNotify={() => setNotifyOpen(true)}
          />
        );
    }
  }, [activeTab, refreshKey]);

  return (
    <AppShell
      tabs={TABS}
      moreItems={MORE}
      activeTab={activeTab}
      onSelectTab={setActiveTab}
      title={title}
      subtitle={subtitle}
      onOpenNotifications={() => setNotifyOpen(true)}>
      {content}
      <NotificationsPanel
        visible={notifyOpen}
        onClose={() => setNotifyOpen(false)}
        onNotificationSent={() => setRefreshKey((k) => k + 1)}
      />
    </AppShell>
  );
};

export default AdminApp;
