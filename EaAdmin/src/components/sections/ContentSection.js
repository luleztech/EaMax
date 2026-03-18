import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  Modal,
  TextInput,
  Switch,
  ActivityIndicator,
  RefreshControl,
  ImageBackground,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminChannelsAPI } from '../../config/api';

const { width } = Dimensions.get('window');

const ContentSection = () => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [addChannelModalVisible, setAddChannelModalVisible] = useState(false);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [editingChannel, setEditingChannel] = useState(null);
  const [channelName, setChannelName] = useState('');
  const [channelCategory, setChannelCategory] = useState('football');
  const [thumbnailUrl, setThumbnailUrl] = useState('');
  const [thumbnailEmoji, setThumbnailEmoji] = useState('');
  const [videoUrl, setVideoUrl] = useState('');
  const [selectedColor, setSelectedColor] = useState('#7c3aed');
  const [isActive, setIsActive] = useState(true);
  const [drmType, setDrmType] = useState('NONE'); // NONE | CLEARKEY | WIDEVINE | PLAYREADY
  const [clearKey, setClearKey] = useState('');
  const [userId, setUserId] = useState('');
  const [useEmoji, setUseEmoji] = useState(false);
  const [pointsRequired, setPointsRequired] = useState('0');
  const [unlockToFree, setUnlockToFree] = useState(false);
  const [savingChannel, setSavingChannel] = useState(false);
  const [deleteConfirmChannel, setDeleteConfirmChannel] = useState(null);
  const [deletingChannel, setDeletingChannel] = useState(false);
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');
  const [channelSearchQuery, setChannelSearchQuery] = useState('');

  const showStatusModal = (title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  };

  // Load channels from backend
  const fetchChannels = async () => {
    try {
      const data = await adminChannelsAPI.getChannels();
      setChannels(data);
    } catch (error) {
      console.error('Failed to load channels:', error);
      showStatusModal('Failed to load channels', 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    fetchChannels();
  }, []);

  const onRefresh = () => {
    setRefreshing(true);
    fetchChannels();
  };

  const colorOptions = [
    { id: 1, color: '#e11d48', name: 'Red' },
    { id: 2, color: '#3b82f6', name: 'Blue' },
    { id: 3, color: '#10b981', name: 'Green' },
    { id: 4, color: '#f59e0b', name: 'Orange' },
    { id: 5, color: '#7c3aed', name: 'Purple' },
    { id: 6, color: '#ec4899', name: 'Pink' },
    { id: 7, color: '#06b6d4', name: 'Cyan' },
    { id: 8, color: '#8b5cf6', name: 'Violet' },
  ];

  const resetForm = () => {
    setChannelName('');
    setChannelCategory('football');
    setThumbnailUrl('');
    setThumbnailEmoji('');
    setVideoUrl('');
    setSelectedColor('#7c3aed');
    setIsActive(true);
    setDrmType('NONE');
    setClearKey('');
    setUserId('');
    setUseEmoji(false);
    setEditingChannel(null);
    setPointsRequired('0');
    setUnlockToFree(false);
  };

  const handleSaveChannel = async () => {
    if (!channelName.trim()) {
      showStatusModal('Missing name', 'Please enter channel name.');
      return;
    }
    if (!videoUrl.trim()) {
      showStatusModal('Missing video URL', 'Please enter video URL.');
      return;
    }
    if (!useEmoji && !thumbnailUrl.trim()) {
      showStatusModal(
        'Missing thumbnail',
        'Please enter thumbnail URL or switch to emoji.',
      );
      return;
    }
    if (useEmoji && !thumbnailEmoji.trim()) {
      showStatusModal('Missing emoji', 'Please enter thumbnail emoji.');
      return;
    }
    if (drmType === 'CLEARKEY' && !String(clearKey || '').trim()) {
      showStatusModal('ClearKey required', 'Enter kid:key (e.g. hexKid:hexKey) when DRM type is CLEARKEY.');
      return;
    }

    const pointsNum = parseInt(String(pointsRequired).trim() || '0', 10);
    const clearKeyTrimmed = drmType === 'CLEARKEY' ? String(clearKey || '').trim() || null : null;
    const payload = {
      name: channelName.trim(),
      category: channelCategory,
      streamUrl: videoUrl.trim(),
      color: selectedColor,
      isActive,
      drmType,
      pointsRequired: Number.isNaN(pointsNum) ? 0 : Math.max(0, pointsNum),
      drmClearKey: clearKeyTrimmed,
      unlockToFree: !!unlockToFree,
    };

    if (!useEmoji && thumbnailUrl.trim()) {
      payload.thumbnailUrl = thumbnailUrl.trim();
    }
    if (useEmoji && thumbnailEmoji.trim()) {
      payload.thumbnailEmoji = thumbnailEmoji.trim();
    }
    if (userId) {
      payload.ownerUserId = Number(userId);
    }

    try {
      setSavingChannel(true);
      if (editingChannel) {
        const updated = await adminChannelsAPI.updateChannel(editingChannel.id, payload);
        showStatusModal('Channel updated', 'Channel updated successfully.');
        setChannels((prev) =>
          prev.map((ch) =>
            ch.id === updated.id
              ? { ...ch, ...updated, drm_type: updated.drm_type ?? updated.drmType, drmType: updated.drmType ?? updated.drm_type, drm_clear_key: updated.drm_clear_key ?? updated.drmClearKey, drmClearKey: updated.drmClearKey ?? updated.drm_clear_key }
              : ch
          )
        );
      } else {
        const created = await adminChannelsAPI.createChannel(payload);
        showStatusModal('Channel added', 'Channel added successfully.');
        setChannels((prev) => [
          { ...created, drm_type: created.drm_type ?? created.drmType, drmType: created.drmType ?? created.drm_type, drm_clear_key: created.drm_clear_key ?? created.drmClearKey, drmClearKey: created.drmClearKey ?? created.drm_clear_key },
          ...prev,
        ]);
      }
      setAddChannelModalVisible(false);
      resetForm();
      fetchChannels();
    } catch (error) {
      console.error('Failed to save channel:', error);
      showStatusModal('Save failed', 'Failed to save channel. Please try again.');
    } finally {
      setSavingChannel(false);
    }
  };

  const filters = [
    { id: 'all', label: 'All Channels' },
    { id: 'football', label: 'Football' },
    { id: 'movies', label: 'Movies' },
    { id: 'habari', label: 'Habari' },
  ];

  const filteredChannels = activeFilter === 'all'
    ? channels
    : channels.filter(channel => channel.category === activeFilter);

  const searchTrimmed = (channelSearchQuery || '').trim().toLowerCase();
  const searchedChannels = searchTrimmed
    ? filteredChannels.filter(
        (ch) =>
          (ch.name && String(ch.name).toLowerCase().includes(searchTrimmed)) ||
          (ch.category && String(ch.category).toLowerCase().includes(searchTrimmed))
      )
    : filteredChannels;

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Loading channels...</Text>
      </View>
    );
  }

  return (
    <ScrollView
      style={styles.container}
      showsVerticalScrollIndicator={false}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} />
      }>
      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.filtersScrollContainer}
        contentContainerStyle={styles.filtersContainer}>
        {filters.map((filter) => (
          <TouchableOpacity
            key={filter.id}
            style={[
              styles.filterButton,
              activeFilter === filter.id && styles.filterButtonActive,
            ]}
            onPress={() => setActiveFilter(filter.id)}>
            <Text
              style={[
                styles.filterText,
                activeFilter === filter.id && styles.filterTextActive,
              ]}>
              {filter.label}
            </Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity
          style={styles.addIconButton}
          onPress={() => setAddChannelModalVisible(true)}>
          <Icon name="plus" size={24} color="#fff" />
        </TouchableOpacity>
      </ScrollView>

      {/* Search box */}
      <View style={styles.searchContainer}>
        <Icon name="magnify" size={20} color="#6b7280" style={styles.searchIcon} />
        <TextInput
          style={styles.searchInput}
          placeholder="Search channels by name or category..."
          placeholderTextColor="#6b7280"
          value={channelSearchQuery}
          onChangeText={setChannelSearchQuery}
          maxLength={100}
        />
        {channelSearchQuery.length > 0 ? (
          <TouchableOpacity
            style={styles.searchClearButton}
            onPress={() => setChannelSearchQuery('')}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="close-circle" size={20} color="#6b7280" />
          </TouchableOpacity>
        ) : null}
      </View>

      {/* Channels Grid */}
      <View style={styles.contentGrid}>
        {searchedChannels.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="television-off" size={48} color="#6b7280" />
            <Text style={styles.emptyStateText}>
              {searchTrimmed
                ? 'No channels match your search'
                : activeFilter === 'all'
                ? 'No channels yet'
                : 'No channels in this category'}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {searchTrimmed
                ? 'Try a different search or clear the search box'
                : 'Add a new channel using the + button above'}
            </Text>
          </View>
        ) : (
          searchedChannels.map((channel) => (
            <View key={channel.id} style={styles.contentCard}>
              <ImageBackground
                source={
                  channel.thumbnail_url ? { uri: channel.thumbnail_url } : undefined
                }
                style={styles.contentImage}
                imageStyle={styles.contentImageBackground}>
                <LinearGradient
                  colors={[channel.color || '#7c3aed', '#030712']}
                  style={styles.contentOverlay}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <View style={styles.channelIconContainer}>
                    {channel.thumbnail_emoji ? (
                      <Text style={styles.channelEmoji}>{channel.thumbnail_emoji}</Text>
                    ) : (
                      <Icon
                        name={
                          channel.category === 'football'
                            ? 'soccer'
                            : channel.category === 'movies'
                            ? 'movie'
                            : 'newspaper-variant'
                        }
                        size={40}
                        color="#fff"
                      />
                    )}
                  </View>
                  <Text style={styles.channelName}>{channel.name}</Text>
                  <Text style={styles.channelShow}>
                    {channel.category === 'football'
                      ? 'Football Channel'
                      : channel.category === 'movies'
                      ? 'Movies Channel'
                      : 'Habari Channel'}
                  </Text>
                </LinearGradient>
              </ImageBackground>
              <View style={styles.contentCardBody}>
                <View style={styles.contentCardInfo}>
                  <Text style={styles.contentCardSubtitle}>
                    {channel.category === 'football'
                      ? 'Football'
                      : channel.category === 'movies'
                      ? 'Movies'
                      : 'Habari'}
                  </Text>
                  <Text style={styles.contentCardViews}>
                    {channel.is_active ? 'Active' : 'Inactive'}
                  </Text>
                </View>
                <View style={styles.contentCardActions}>
                  <TouchableOpacity
                    style={styles.editButton}
                    onPress={() => {
                      setEditingChannel(channel);
                      setChannelName(channel.name || '');
                      setChannelCategory(channel.category || 'football');
                      setThumbnailUrl(channel.thumbnail_url || '');
                      setThumbnailEmoji(channel.thumbnail_emoji || '');
                      setUseEmoji(!!channel.thumbnail_emoji);
                      setVideoUrl(channel.stream_url || '');
                      setSelectedColor(channel.color || '#7c3aed');
                      setIsActive(
                        typeof channel.is_active === 'boolean'
                          ? channel.is_active
                          : true,
                      );
                      const savedDrmType = (channel.drm_type ?? channel.drmType ?? (channel.drm_protected ? 'CLEARKEY' : 'NONE')).toUpperCase();
                      setDrmType(savedDrmType === 'CLEARKEY' || savedDrmType === 'WIDEVINE' || savedDrmType === 'PLAYREADY' ? savedDrmType : 'NONE');
                      const savedClearKey = channel.drm_clear_key ?? channel.drmClearKey;
                      setClearKey(savedClearKey != null ? String(savedClearKey) : '');
                      setUserId(
                        channel.owner_user_id ? String(channel.owner_user_id) : '',
                      );
                      setPointsRequired(
                        String(channel.points_required ?? channel.pointsRequired ?? 0),
                      );
                      setUnlockToFree(!!(channel.unlock_to_free ?? channel.unlockToFree));
                      setAddChannelModalVisible(true);
                    }}>
                    <Text style={styles.editButtonText}>Edit</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.deleteButton}
                    onPress={() => setDeleteConfirmChannel(channel)}>
                    <Text style={styles.deleteButtonText}>Delete</Text>
                  </TouchableOpacity>
                </View>
              </View>
            </View>
          ))
        )}
      </View>

      {/* Add Channel Modal */}
      <Modal
        visible={addChannelModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setAddChannelModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <LinearGradient
            colors={['#030712', '#111827', '#1f2937']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <View style={styles.modalHeaderLeft}>
                <View style={styles.modalHeaderIconWrap}>
                  <Icon name="television" size={22} color="#a78bfa" />
                </View>
                <View>
                  <Text style={styles.modalTitle}>
                    {editingChannel ? 'Edit Channel' : 'Add New Channel'}
                  </Text>
                  <Text style={styles.modalSubtitle}>
                    {editingChannel ? 'Update channel details' : 'Create a new channel for the app'}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={() => {
                  setAddChannelModalVisible(false);
                  setChannelName('');
                  setThumbnailUrl('');
                  setThumbnailEmoji('');
                  setVideoUrl('');
                  setSelectedColor('#7c3aed');
                  setIsActive(true);
                  setDrmType('NONE');
                  setUserId('');
                  setUseEmoji(false);
                  setUnlockToFree(false);
                }}
                style={styles.closeButton}
                hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              {/* Basic info card */}
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Basic info</Text>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Channel name *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. Premier League Live"
                    placeholderTextColor="#6b7280"
                    value={channelName}
                    onChangeText={setChannelName}
                  />
                </View>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Category *</Text>
                  <View style={styles.categoryRow}>
                    {[
                      { id: 'football', label: 'Kabumbu (Football)' },
                      { id: 'movies', label: 'Movies' },
                      { id: 'habari', label: 'Habari' },
                    ].map((opt) => {
                      const active = channelCategory === opt.id;
                      return (
                        <TouchableOpacity
                          key={opt.id}
                          style={[styles.categoryChip, active && styles.categoryChipActive]}
                          onPress={() => setChannelCategory(opt.id)}>
                          <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                            {opt.label}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
              </View>

              {/* Media card */}
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Media</Text>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Thumbnail</Text>
                  <View style={styles.thumbnailTypeToggle}>
                    <TouchableOpacity
                      style={[styles.thumbnailTypeButton, !useEmoji && styles.thumbnailTypeButtonActive]}
                      onPress={() => setUseEmoji(false)}>
                      <Text style={[styles.thumbnailTypeButtonText, !useEmoji && styles.thumbnailTypeButtonTextActive]}>
                        Image URL
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      style={[styles.thumbnailTypeButton, useEmoji && styles.thumbnailTypeButtonActive]}
                      onPress={() => setUseEmoji(true)}>
                      <Text style={[styles.thumbnailTypeButtonText, useEmoji && styles.thumbnailTypeButtonTextActive]}>
                        Emoji
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
                {!useEmoji ? (
                  <View style={styles.inputSection}>
                    <Text style={styles.inputLabel}>Thumbnail URL *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="https://example.com/thumbnail.jpg"
                      placeholderTextColor="#6b7280"
                      value={thumbnailUrl}
                      onChangeText={setThumbnailUrl}
                      keyboardType="url"
                      autoCapitalize="none"
                    />
                  </View>
                ) : (
                  <View style={styles.inputSection}>
                    <Text style={styles.inputLabel}>Thumbnail emoji *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. 🎬 📺 ⚽"
                      placeholderTextColor="#6b7280"
                      value={thumbnailEmoji}
                      onChangeText={setThumbnailEmoji}
                      maxLength={2}
                    />
                  </View>
                )}
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Video / stream URL *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://example.com/video.m3u8"
                    placeholderTextColor="#6b7280"
                    value={videoUrl}
                    onChangeText={setVideoUrl}
                    keyboardType="url"
                    autoCapitalize="none"
                  />
                </View>
              </View>

              {/* Appearance & access card */}
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Appearance & access</Text>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Points required to unlock</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="0 = free, or number of points"
                    placeholderTextColor="#6b7280"
                    value={pointsRequired}
                    onChangeText={setPointsRequired}
                    keyboardType="numeric"
                  />
                  <Text style={styles.inputHint}>
                    Set 0 for free channels; otherwise users spend points to unlock.
                  </Text>
                </View>
                <View style={styles.toggleSection}>
                  <View style={styles.toggleInfo}>
                    <Text style={styles.toggleLabel}>Unlock to free (no ads)</Text>
                    <Text style={styles.toggleDescription}>
                      You can unlock any channel you want here to free with no ads on it
                    </Text>
                  </View>
                  <Switch
                    value={unlockToFree}
                    onValueChange={setUnlockToFree}
                    trackColor={{ false: '#374151', true: '#7c3aed' }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Channel color</Text>
                  <View style={styles.colorPicker}>
                    {colorOptions.map((option) => (
                      <TouchableOpacity
                        key={option.id}
                        style={[
                          styles.colorOption,
                          selectedColor === option.color && styles.colorOptionActive,
                          { backgroundColor: option.color },
                        ]}
                        onPress={() => setSelectedColor(option.color)}>
                        {selectedColor === option.color && (
                          <Icon name="check" size={20} color="#fff" />
                        )}
                      </TouchableOpacity>
                    ))}
                  </View>
                  <Text style={styles.colorPreviewText}>
                    {colorOptions.find(c => c.color === selectedColor)?.name || 'Custom'}
                  </Text>
                </View>
              </View>

              {/* Settings card */}
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Settings</Text>
                <View style={styles.toggleSection}>
                  <View style={styles.toggleInfo}>
                    <Text style={styles.toggleLabel}>Channel status</Text>
                    <Text style={styles.toggleDescription}>Visible in the app when enabled</Text>
                  </View>
                  <Switch
                    value={isActive}
                    onValueChange={setIsActive}
                    trackColor={{ false: '#374151', true: '#7c3aed' }}
                    thumbColor="#fff"
                  />
                </View>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>DRM type</Text>
                  <Text style={styles.inputHint}>NONE = no DRM. CLEARKEY = kid:key. WIDEVINE/PLAYREADY = license server (future).</Text>
                  <View style={styles.drmTypeRow}>
                    {['NONE', 'CLEARKEY', 'WIDEVINE', 'PLAYREADY'].map((opt) => {
                      const active = drmType === opt;
                      return (
                        <TouchableOpacity
                          key={opt}
                          style={[styles.categoryChip, active && styles.categoryChipActive]}
                          onPress={() => setDrmType(opt)}>
                          <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                            {opt}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                  </View>
                </View>
                {drmType === 'CLEARKEY' && (
                  <View style={styles.inputSection}>
                    <Text style={styles.inputLabel}>ClearKey (kid:key) *</Text>
                    <TextInput
                      style={styles.input}
                      placeholder="e.g. f59650be475e4c34a844d4e2062f71f3:119639e849ddee96c4cec2f2b6b09b40"
                      placeholderTextColor="#6b7280"
                      value={clearKey}
                      onChangeText={setClearKey}
                      autoCapitalize="none"
                      multiline={false}
                      maxLength={2048}
                    />
                    <Text style={styles.inputHint}>Hex kid and hex key separated by colon. Used by app and web player.</Text>
                  </View>
                )}
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Owner user ID (optional)</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="Leave empty for public"
                    placeholderTextColor="#6b7280"
                    value={userId}
                    onChangeText={setUserId}
                  />
                </View>
              </View>

              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setAddChannelModalVisible(false);
                    resetForm();
                  }}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.addButton, savingChannel && { opacity: 0.7 }]}
                  onPress={savingChannel ? undefined : handleSaveChannel}
                  disabled={savingChannel}>
                  {savingChannel ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <>
                      <Icon name={editingChannel ? 'content-save' : 'plus'} size={20} color="#fff" />
                      <Text style={styles.addButtonText}>
                        {editingChannel ? 'Save channel' : 'Add channel'}
                      </Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Delete Channel Confirm Modal */}
      <Modal
        visible={!!deleteConfirmChannel}
        transparent
        animationType="fade"
        onRequestClose={() => setDeleteConfirmChannel(null)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>Delete channel</Text>
            <Text style={styles.statusModalMessage}>
              Are you sure you want to delete{' '}
              {deleteConfirmChannel?.name || 'this channel'}?
            </Text>
            <View style={styles.statusModalActionsRow}>
              <TouchableOpacity
                style={styles.statusModalCancel}
                onPress={() => setDeleteConfirmChannel(null)}
                disabled={deletingChannel}>
                <Text style={styles.statusModalCancelText}>Cancel</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.statusModalConfirm,
                  deletingChannel && { opacity: 0.7 },
                ]}
                onPress={async () => {
                  if (!deleteConfirmChannel) return;
                  const channelToDelete = deleteConfirmChannel;
                  try {
                    setDeletingChannel(true);
                    await adminChannelsAPI.deleteChannel(channelToDelete.id);
                    setDeleteConfirmChannel(null);
                    setChannels((prev) => prev.filter((ch) => ch.id !== channelToDelete.id));
                    showStatusModal(
                      'Channel deleted',
                      'The channel has been deleted successfully.',
                    );
                    fetchChannels();
                  } catch (error) {
                    console.error('Failed to delete channel:', error);
                    const message = error?.message || 'Failed to delete channel. Please try again.';
                    showStatusModal('Delete failed', message);
                  } finally {
                    setDeletingChannel(false);
                  }
                }}
                disabled={deletingChannel}>
                <Text style={styles.statusModalConfirmText}>
                  {deletingChannel ? 'Deleting...' : 'Delete'}
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Status Modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <Text style={styles.statusModalTitle}>{statusModalTitle}</Text>
            <Text style={styles.statusModalMessage}>{statusModalMessage}</Text>
            <TouchableOpacity
              style={styles.statusModalButton}
              onPress={() => setStatusModalVisible(false)}>
              <Text style={styles.statusModalButtonText}>OK</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 16,
    paddingBottom: 100,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 16,
    color: '#9ca3af',
  },
  filtersScrollContainer: {
    marginBottom: 16,
  },
  filtersContainer: {
    flexDirection: 'row',
    gap: 12,
    alignItems: 'center',
    paddingRight: 16,
  },
  filterButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
  },
  filterButtonActive: {
    backgroundColor: '#7c3aed',
  },
  filterText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  filterTextActive: {
    color: '#fff',
  },
  addIconButton: {
    width: 44,
    height: 44,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    paddingHorizontal: 14,
    marginBottom: 16,
    minHeight: 48,
  },
  searchIcon: {
    marginRight: 10,
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 15,
    paddingVertical: 12,
  },
  searchClearButton: {
    padding: 4,
  },
  contentGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  contentCard: {
    width: (width - 44) / 2,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
    marginBottom: 12,
  },
  contentImage: {
    height: 160,
    position: 'relative',
  },
  contentImageBackground: {
    borderRadius: 16,
  },
  contentOverlay: {
    flex: 1,
    padding: 16,
    justifyContent: 'flex-end',
  },
  statusBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 12,
  },
  liveBadge: {
    backgroundColor: '#dc2626',
  },
  newBadge: {
    backgroundColor: '#7c3aed',
  },
  upcomingBadge: {
    backgroundColor: '#6b7280',
  },
  statusText: {
    fontSize: 11,
    fontWeight: 'bold',
    color: '#fff',
  },
  channelIconContainer: {
    marginBottom: 12,
    alignSelf: 'flex-start',
  },
  channelEmoji: {
    fontSize: 32,
  },
  channelName: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  channelShow: {
    fontSize: 13,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    paddingHorizontal: 16,
  },
  contentCardBody: {
    padding: 12,
  },
  contentCardInfo: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  contentCardSubtitle: {
    fontSize: 12,
    color: '#9ca3af',
  },
  contentCardViews: {
    fontSize: 13,
    fontWeight: '600',
    color: '#10b981',
  },
  contentCardViewsInactive: {
    color: '#9ca3af',
  },
  contentCardActions: {
    flexDirection: 'row',
    gap: 8,
  },
  editButton: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 8,
    alignItems: 'center',
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#fff',
  },
  deleteButton: {
    flex: 1,
    paddingVertical: 8,
    backgroundColor: 'rgba(220, 38, 38, 0.2)',
    borderRadius: 8,
    alignItems: 'center',
  },
  deleteButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#f87171',
  },
  modalContainer: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.98)',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    marginTop: 60,
    overflow: 'hidden',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 18,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.6)',
  },
  modalHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    flex: 1,
  },
  modalHeaderIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 12,
    backgroundColor: 'rgba(124, 58, 237, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#fff',
    letterSpacing: 0.3,
  },
  modalSubtitle: {
    fontSize: 13,
    color: '#9ca3af',
    marginTop: 2,
  },
  closeButton: {
    padding: 8,
  },
  modalBody: {
    flex: 1,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 32,
  },
  formCard: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    marginBottom: 20,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  formCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#e5e7eb',
    marginBottom: 16,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },
  inputSection: {
    marginBottom: 18,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#d1d5db',
    marginBottom: 8,
  },
  input: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 15,
  },
  inputHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 6,
    lineHeight: 18,
  },
  thumbnailTypeToggle: {
    flexDirection: 'row',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 12,
    padding: 4,
    gap: 4,
    borderWidth: 1,
    borderColor: '#374151',
  },
  thumbnailTypeButton: {
    flex: 1,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  thumbnailTypeButtonActive: {
    backgroundColor: '#7c3aed',
  },
  thumbnailTypeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  thumbnailTypeButtonTextActive: {
    color: '#fff',
  },
  colorPicker: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 8,
  },
  colorOption: {
    width: 48,
    height: 48,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 3,
    borderColor: 'transparent',
  },
  colorOptionActive: {
    borderColor: '#fff',
    shadowColor: '#fff',
    shadowOffset: { width: 0, height: 0 },
    shadowOpacity: 0.4,
    shadowRadius: 6,
    elevation: 4,
  },
  colorPreviewText: {
    fontSize: 12,
    color: '#9ca3af',
    marginTop: 10,
  },
  toggleSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    paddingHorizontal: 0,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.4)',
  },
  toggleInfo: {
    flex: 1,
    marginRight: 16,
  },
  toggleLabel: {
    fontSize: 15,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 2,
  },
  toggleDescription: {
    fontSize: 13,
    color: '#9ca3af',
  },
  categoryRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
  },
  drmTypeRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 10,
    marginTop: 6,
  },
  categoryChip: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
  },
  categoryChipActive: {
    borderColor: '#7c3aed',
    backgroundColor: 'rgba(124, 58, 237, 0.25)',
  },
  categoryChipText: {
    fontSize: 13,
    color: '#9ca3af',
    fontWeight: '600',
  },
  categoryChipTextActive: {
    color: '#e5e7eb',
  },
  modalActions: {
    flexDirection: 'row',
    gap: 14,
    marginTop: 8,
    marginBottom: 24,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 16,
    backgroundColor: 'transparent',
    borderRadius: 14,
    alignItems: 'center',
    borderWidth: 1.5,
    borderColor: '#4b5563',
  },
  cancelButtonText: {
    color: '#d1d5db',
    fontSize: 16,
    fontWeight: '600',
  },
  addButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 16,
    backgroundColor: '#7c3aed',
    borderRadius: 14,
    shadowColor: '#7c3aed',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 4,
  },
  addButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  emptyState: {
    paddingVertical: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    marginTop: 16,
    fontSize: 16,
    fontWeight: '600',
    color: '#e5e7eb',
  },
  emptyStateSubtext: {
    marginTop: 6,
    fontSize: 14,
    color: '#9ca3af',
    textAlign: 'center',
  },
  statusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.7)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 24,
  },
  statusModalContent: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#020617',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: '#4b5563',
  },
  statusModalTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#fff',
    marginBottom: 8,
  },
  statusModalMessage: {
    fontSize: 14,
    color: '#e5e7eb',
    marginBottom: 16,
  },
  statusModalButton: {
    alignSelf: 'flex-end',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#7c3aed',
  },
  statusModalButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 13,
  },
  statusModalActionsRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 8,
    marginTop: 8,
  },
  statusModalCancel: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#4b5563',
    backgroundColor: '#020617',
  },
  statusModalCancelText: {
    color: '#9ca3af',
    fontSize: 13,
    fontWeight: '500',
  },
  statusModalConfirm: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#dc2626',
  },
  statusModalConfirmText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
});

export default ContentSection;
