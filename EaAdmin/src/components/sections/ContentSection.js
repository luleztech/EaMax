import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  PanResponder,
  ToastAndroid,
  Platform,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminChannelsAPI } from '../../config/api';

const { width } = Dimensions.get('window');
const CHANNEL_ROW_HEIGHT = 80;

const logReorder = (msg, extra) => {
  if (extra != null) {
    console.warn('[EaAdmin:Reorder]', msg, extra);
  } else {
    console.warn('[EaAdmin:Reorder]', msg);
  }
};

const toastReorder = (msg) => {
  if (Platform.OS === 'android') {
    ToastAndroid.show(String(msg).slice(0, 120), ToastAndroid.SHORT);
  }
};

const channelIdEq = (a, b) => Number(a) === Number(b);

const sortChannelsByOrder = (list) =>
  [...list].sort(
    (a, b) =>
      (Number(a.sort_order) || Number(a.id)) - (Number(b.sort_order) || Number(b.id)),
  );

/** Virtual section — same as user app “Chaneli za bure”. */
const BURE_SECTION_KEY = '__bure__';

const BURE_DEF = {
  key: BURE_SECTION_KEY,
  name: 'Chaneli za bure',
  icon: 'gift',
  color: '#22c55e',
  app: 'bure',
};

/** Category order aligned with user app: Bure, Kabumbu, Habari, then Movies sub-categories. */
const CATEGORY_DEFS = [
  { key: 'football', name: 'Mpira / Football', icon: 'soccer', color: '#10b981', app: 'kabumbu' },
  { key: 'habari', name: 'Habari', icon: 'newspaper-variant', color: '#ef4444', app: 'habari' },
  { key: 'tamthilia', name: 'Tamthilia', icon: 'drama-masks', color: '#ec4899', app: 'moviesapp' },
  { key: 'movies', name: 'Filamu', icon: 'movie', color: '#3b82f6', app: 'moviesapp' },
  { key: 'wanyama', name: 'Wanyama', icon: 'paw', color: '#22c55e', app: 'moviesapp' },
  { key: 'katuni', name: 'Katuni', icon: 'animation', color: '#f59e0b', app: 'moviesapp' },
  { key: 'sayansi', name: 'Sayansi', icon: 'atom', color: '#8b5cf6', app: 'moviesapp' },
];

const CATEGORY_KEYS = CATEGORY_DEFS.map((c) => c.key);

const APP_GROUPS = [
  { id: 'bure', label: 'Chaneli za bure', icon: 'gift', color: '#22c55e' },
  { id: 'kabumbu', label: 'Kabumbu app', icon: 'soccer', color: '#10b981' },
  { id: 'habari', label: 'Habari app', icon: 'newspaper-variant', color: '#ef4444' },
  { id: 'moviesapp', label: 'Movies app', icon: 'movie', color: '#a855f7' },
];

/** Za bure = admin set Access → Free (`unlock_to_free`). Points alone do not make a channel free. */
const hasFreeAccess = (ch) =>
  !!(ch?.unlock_to_free === true || ch?.unlockToFree === true);

const isFreeChannel = hasFreeAccess;

const hasPremiumAccess = (ch) => !hasFreeAccess(ch);

/** Free channels in current list order (no re-sort — avoids snap-back after drag). */
const getFreeChannelsInOrder = (channels) => (channels || []).filter(isFreeChannel);

const getFreeChannels = (channels) =>
  getFreeChannelsInOrder(channels).sort(
    (a, b) => (Number(a.sort_order) || Number(a.id)) - (Number(b.sort_order) || Number(b.id)),
  );

const getCategoryDef = (key) =>
  CATEGORY_DEFS.find((c) => c.key === key) || {
    key,
    name: key,
    icon: 'television',
    color: '#7c3aed',
    app: 'moviesapp',
  };

const groupChannelsByCategory = (channels) => {
  const map = {};
  CATEGORY_KEYS.forEach((k) => {
    map[k] = [];
  });
  (channels || []).forEach((ch) => {
    const key = String(ch.category || 'football').toLowerCase();
    if (!map[key]) map[key] = [];
    map[key].push(ch);
  });
  return map;
};

const flattenGroupedChannels = (grouped, fallbackList = [], freeOrdered = []) => {
  const out = [];
  const seen = new Set();
  (freeOrdered || []).forEach((ch) => {
    out.push(ch);
    seen.add(ch.id);
  });
  CATEGORY_KEYS.forEach((key) => {
    (grouped[key] || []).forEach((ch) => {
      if (!seen.has(ch.id)) {
        out.push(ch);
        seen.add(ch.id);
      }
    });
  });
  fallbackList.forEach((ch) => {
    if (!seen.has(ch.id)) out.push(ch);
  });
  return out;
};

const flattenAllChannels = (channels) => {
  const free = getFreeChannelsInOrder(channels);
  const freeIds = new Set(free.map((c) => c.id));
  const nonFree = channels.filter((c) => !freeIds.has(c.id));
  const grouped = groupChannelsByCategory(nonFree);
  return flattenGroupedChannels(grouped, channels, free);
};

const getListForCategoryKeyFromList = (categoryKey, prev, hideFreeInCategories) => {
  if (categoryKey === BURE_SECTION_KEY) {
    return getFreeChannelsInOrder(prev);
  }
  const freeIds = hideFreeInCategories
    ? new Set(getFreeChannelsInOrder(prev).map((c) => c.id))
    : new Set();
  const grouped = groupChannelsByCategory(prev);
  let list = grouped[categoryKey] || [];
  if (hideFreeInCategories) {
    list = list.filter((ch) => !freeIds.has(ch.id));
  }
  return list;
};

const applyChannelMove = (prev, categoryKey, fromIndex, toIndex, hideFreeInCategories) => {
  if (fromIndex === toIndex) return prev;

  let free = getFreeChannelsInOrder(prev);
  const freeIds = new Set(free.map((c) => c.id));

  if (categoryKey === BURE_SECTION_KEY) {
    const list = [...getFreeChannelsInOrder(prev)];
    const [item] = list.splice(fromIndex, 1);
    list.splice(toIndex, 0, item);
    free = list;
    const nonFree = prev.filter((c) => !freeIds.has(c.id));
    const grouped = groupChannelsByCategory(nonFree);
    return flattenGroupedChannels(grouped, prev, free);
  }

  let list = getListForCategoryKeyFromList(categoryKey, prev, hideFreeInCategories);
  const [item] = list.splice(fromIndex, 1);
  list.splice(toIndex, 0, item);

  if (hideFreeInCategories) {
    const nonFree = prev.filter((c) => !freeIds.has(c.id));
    const grouped = groupChannelsByCategory(nonFree);
    grouped[categoryKey] = list;
    return flattenGroupedChannels(grouped, prev, free);
  }

  const grouped = groupChannelsByCategory(prev);
  grouped[categoryKey] = list;
  return flattenGroupedChannels(grouped, prev, free);
};

const ContentSection = () => {
  const [activeFilter, setActiveFilter] = useState('all');
  const [addChannelModalVisible, setAddChannelModalVisible] = useState(false);
  const [channels, setChannels] = useState([]);
  const [orderedChannels, setOrderedChannels] = useState([]);
  const [draggingChannelId, setDraggingChannelId] = useState(null);
  const [dragHoverIndex, setDragHoverIndex] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const orderedChannelsRef = useRef([]);
  const activeFilterRef = useRef('all');
  const isDraggingRef = useRef(false);
  const dragMetaRef = useRef(null);
  const rowHeightRef = useRef(CHANNEL_ROW_HEIGHT);
  const persistOrderInFlightRef = useRef(false);
  const persistDebounceRef = useRef(null);
  const panRespondersRef = useRef({});
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

  const showStatusModal = useCallback((title, message) => {
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  }, [setStatusModalTitle, setStatusModalMessage, setStatusModalVisible]);

  // Load channels from backend
  const fetchChannels = useCallback(async () => {
    try {
      const data = await adminChannelsAPI.getChannels();
      const sorted = sortChannelsByOrder(data);
      setChannels(sorted);
      setOrderedChannels(sorted);
    } catch (error) {
      console.error('Failed to load channels:', error);
      showStatusModal('Failed to load channels', 'Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [showStatusModal]);

  useEffect(() => {
    fetchChannels();
  }, [fetchChannels]);

  useEffect(() => {
    orderedChannelsRef.current = orderedChannels;
  }, [orderedChannels]);

  useEffect(() => {
    activeFilterRef.current = activeFilter;
  }, [activeFilter]);

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
    const urlValue = String(videoUrl || '').trim();

    if (!channelName.trim()) {
      showStatusModal('Missing name', 'Please enter channel name.');
      return;
    }
    if (!urlValue) {
      showStatusModal('Missing stream URL', 'Please enter the stream URL.');
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
      streamUrl: urlValue,
      color: selectedColor,
      isActive,
      drmType,
      pointsRequired: Number.isNaN(pointsNum) ? 0 : Math.max(0, pointsNum),
      drmClearKey: clearKeyTrimmed,
      unlockToFree: !!unlockToFree,
    };

    if (editingChannel) {
      payload.streamAlias = null;
    }

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
          sortChannelsByOrder(
            prev.map((ch) =>
              ch.id === updated.id
                ? { ...ch, ...updated, drm_type: updated.drm_type ?? updated.drmType, drmType: updated.drmType ?? updated.drm_type, drm_clear_key: updated.drm_clear_key ?? updated.drmClearKey, drmClearKey: updated.drmClearKey ?? updated.drm_clear_key }
                : ch
            ),
          ),
        );
      } else {
        const created = await adminChannelsAPI.createChannel(payload);
        showStatusModal('Channel added', 'Channel added successfully.');
        setChannels((prev) =>
          sortChannelsByOrder([
            { ...created, drm_type: created.drm_type ?? created.drmType, drmType: created.drmType ?? created.drm_type, drm_clear_key: created.drm_clear_key ?? created.drmClearKey, drmClearKey: created.drmClearKey ?? created.drm_clear_key },
            ...prev,
          ]),
        );
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
    { id: 'all', label: 'All' },
    { id: 'bure', label: 'Za bure' },
    { id: 'kabumbu', label: 'Kabumbu' },
    { id: 'habari', label: 'Habari' },
    { id: 'moviesapp', label: 'Movies' },
  ];

  const searchTrimmed = (channelSearchQuery || '').trim().toLowerCase();

  const channelsMatchingFilter = useCallback(() => {
    if (activeFilter === 'bure') {
      return getFreeChannelsInOrder(orderedChannels);
    }
    if (activeFilter === 'kabumbu') {
      return orderedChannels.filter((ch) => String(ch.category).toLowerCase() === 'football');
    }
    if (activeFilter === 'habari') {
      return orderedChannels.filter((ch) => String(ch.category).toLowerCase() === 'habari');
    }
    if (activeFilter === 'moviesapp') {
      return orderedChannels.filter((ch) => {
        const cat = String(ch.category).toLowerCase();
        return cat !== 'football' && cat !== 'habari';
      });
    }
    return orderedChannels;
  }, [activeFilter, orderedChannels]);

  const buildDisplayModel = useCallback(() => {
    let list = channelsMatchingFilter();
    if (searchTrimmed) {
      list = list.filter(
        (ch) =>
          (ch.name && String(ch.name).toLowerCase().includes(searchTrimmed)) ||
          (ch.category && String(ch.category).toLowerCase().includes(searchTrimmed)) ||
          (hasFreeAccess(ch) &&
            (searchTrimmed.includes('bure') || searchTrimmed.includes('free'))) ||
          (hasPremiumAccess(ch) && searchTrimmed.includes('premium')),
      );
    }

    const freeChannels = getFreeChannelsInOrder(
      activeFilter === 'bure' ? list : orderedChannels.filter((ch) => list.some((x) => x.id === ch.id)),
    );
    const freeIds = new Set(freeChannels.map((c) => c.id));
    const hideFreeInCategories = activeFilter === 'all';

    const grouped = groupChannelsByCategory(list);
    if (hideFreeInCategories) {
      CATEGORY_KEYS.forEach((key) => {
        grouped[key] = (grouped[key] || []).filter((ch) => !freeIds.has(ch.id));
      });
    }

    return { freeChannels, grouped, freeIds, hideFreeInCategories };
  }, [channelsMatchingFilter, searchTrimmed, activeFilter, orderedChannels]);

  const canReorder = !searchTrimmed;

  useEffect(() => {
    panRespondersRef.current = {};
  }, [canReorder, activeFilter, channelSearchQuery]);

  const indexFromDragDy = useCallback((startIndex, dy, listLength) => {
    const rowH = rowHeightRef.current || CHANNEL_ROW_HEIGHT;
    let idx = startIndex + Math.round(dy / rowH);
    if (idx === startIndex && Math.abs(dy) >= rowH * 0.4) {
      idx = startIndex + (dy > 0 ? 1 : -1);
    }
    return Math.max(0, Math.min(listLength - 1, idx));
  }, []);

  const moveDraggedRowToIndex = useCallback((hoverIndex) => {
    const meta = dragMetaRef.current;
    if (!meta) return false;

    const prev = orderedChannelsRef.current;
    const list = getListForCategoryKeyFromList(
      meta.categoryKey,
      prev,
      meta.hideFreeInCategories,
    );
    const fromIndex = list.findIndex((c) => channelIdEq(c.id, meta.channelId));
    if (fromIndex < 0 || fromIndex === hoverIndex) return false;

    const next = applyChannelMove(
      prev,
      meta.categoryKey,
      fromIndex,
      hoverIndex,
      meta.hideFreeInCategories,
    );
    orderedChannelsRef.current = next;
    setOrderedChannels(next);
    meta.startIndex = hoverIndex;
    return true;
  }, []);

  const persistChannelOrder = useCallback(async (ordered) => {
    if (persistOrderInFlightRef.current) return;

    const list = Array.isArray(ordered) ? ordered : orderedChannelsRef.current;
    if (!list.length) return;

    const flat = flattenAllChannels(list);
    const fullOrderIds = flat
      .map((ch) => Number(ch.id))
      .filter((id) => Number.isFinite(id) && id > 0);

    persistOrderInFlightRef.current = true;
    try {
      setSavingOrder(true);
      logReorder('Saving order…', { count: fullOrderIds.length });
      await adminChannelsAPI.reorderChannels(fullOrderIds, { fullOrderIds });
      const data = await adminChannelsAPI.getChannels();
      const synced = sortChannelsByOrder(data);
      setChannels(synced);
      setOrderedChannels(synced);
      orderedChannelsRef.current = synced;
      logReorder('Order saved');
      toastReorder('Saved — refresh EaMax app to see order');
    } catch (error) {
      console.error('Failed to save channel order:', error);
      logReorder('Save failed', { err: String(error?.message || error) });
      toastReorder('Save failed — check connection');
      const detail = error?.message ? String(error.message).slice(0, 180) : '';
      showStatusModal(
        'Reorder not saved',
        detail
          ? `${detail}\n\nOrder kept on screen — deploy latest backend to Railway, then try again.`
          : 'Order kept on screen. Deploy backend updates, then try again.',
      );
    } finally {
      setSavingOrder(false);
      persistOrderInFlightRef.current = false;
    }
  }, [showStatusModal]);

  const schedulePersistOrder = useCallback(
    (next) => {
      orderedChannelsRef.current = next;
      setOrderedChannels(next);
      if (persistDebounceRef.current) {
        clearTimeout(persistDebounceRef.current);
      }
      persistDebounceRef.current = setTimeout(() => {
        persistDebounceRef.current = null;
        persistChannelOrder(next);
      }, 450);
    },
    [persistChannelOrder],
  );

  const moveChannelOneStep = useCallback(
    (categoryKey, channelId, direction, hideFreeInCategories) => {
      const prev = orderedChannelsRef.current;
      const list = getListForCategoryKeyFromList(categoryKey, prev, hideFreeInCategories);
      const fromIndex = list.findIndex((c) => channelIdEq(c.id, channelId));
      const toIndex = fromIndex + direction;
      if (fromIndex < 0 || toIndex < 0 || toIndex >= list.length) {
        logReorder('Move blocked', { channelId, fromIndex, toIndex, listLen: list.length });
        return;
      }
      const next = applyChannelMove(
        prev,
        categoryKey,
        fromIndex,
        toIndex,
        hideFreeInCategories,
      );
      const name = list[fromIndex]?.name || 'Channel';
      const moveLabel = direction < 0 ? `Moved up: ${name}` : `Moved down: ${name}`;
      logReorder(moveLabel);
      toastReorder(moveLabel);
      schedulePersistOrder(next);
    },
    [schedulePersistOrder],
  );

  const endDragSession = useCallback(
    (shouldSave) => {
      isDraggingRef.current = false;
      dragMetaRef.current = null;
      setDraggingChannelId(null);
      setDragHoverIndex(null);

      if (shouldSave) {
        if (persistDebounceRef.current) {
          clearTimeout(persistDebounceRef.current);
          persistDebounceRef.current = null;
        }
        persistChannelOrder(orderedChannelsRef.current);
      }
    },
    [persistChannelOrder],
  );

  const getRowPanResponder = useCallback(
    (categoryKey, channelId, listIndex, hideFreeInCategories) => {
      if (!canReorder) return null;

      const cacheKey = `${categoryKey}:${channelId}:${hideFreeInCategories ? 1 : 0}`;
      if (panRespondersRef.current[cacheKey]) {
        return panRespondersRef.current[cacheKey];
      }

      const responder = PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onStartShouldSetPanResponderCapture: () => true,
        onMoveShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponderCapture: (_, gestureState) => Math.abs(gestureState.dy) > 4,
        onPanResponderTerminationRequest: () => false,
        onPanResponderGrant: () => {
          const list = getListForCategoryKeyFromList(
            categoryKey,
            orderedChannelsRef.current,
            hideFreeInCategories,
          );
          const start = list.findIndex((c) => channelIdEq(c.id, channelId));
          const startIndex = start >= 0 ? start : listIndex;
          logReorder('Drag start', { channelId, startIndex, categoryKey });

          dragMetaRef.current = {
            categoryKey,
            channelId,
            hideFreeInCategories,
            startIndex,
            gestureBaseline: 0,
          };
          isDraggingRef.current = true;
          setDraggingChannelId(channelId);
          setDragHoverIndex(startIndex);
        },
        onPanResponderMove: (_, gestureState) => {
          if (!isDraggingRef.current || !dragMetaRef.current) return;

          const meta = dragMetaRef.current;
          const list = getListForCategoryKeyFromList(
            meta.categoryKey,
            orderedChannelsRef.current,
            meta.hideFreeInCategories,
          );
          const relativeDy = gestureState.dy - (meta.gestureBaseline || 0);
          const hover = indexFromDragDy(meta.startIndex, relativeDy, list.length);
          setDragHoverIndex(hover);

          if (moveDraggedRowToIndex(hover)) {
            meta.gestureBaseline = gestureState.dy;
          }
        },
        onPanResponderRelease: () => {
          logReorder('Drag release');
          endDragSession(true);
        },
        onPanResponderTerminate: () => {
          endDragSession(false);
        },
      });

      panRespondersRef.current[cacheKey] = responder;
      return responder;
    },
    [canReorder, endDragSession, indexFromDragDy, moveDraggedRowToIndex],
  );

  const openEditChannel = (channel) => {
    setEditingChannel(channel);
    setChannelName(channel.name || '');
    setChannelCategory(channel.category || 'football');
    setThumbnailUrl(channel.thumbnail_url || '');
    setThumbnailEmoji(channel.thumbnail_emoji || '');
    setUseEmoji(!!channel.thumbnail_emoji);
    setVideoUrl(channel.stream_url || '');
    setSelectedColor(channel.color || '#7c3aed');
    setIsActive(typeof channel.is_active === 'boolean' ? channel.is_active : true);
    const savedDrmType = (
      channel.drm_type ?? channel.drmType ?? (channel.drm_protected ? 'CLEARKEY' : 'NONE')
    ).toUpperCase();
    setDrmType(
      savedDrmType === 'CLEARKEY' || savedDrmType === 'WIDEVINE' || savedDrmType === 'PLAYREADY'
        ? savedDrmType
        : 'NONE',
    );
    const savedClearKey = channel.drm_clear_key ?? channel.drmClearKey;
    setClearKey(savedClearKey != null ? String(savedClearKey) : '');
    setUserId(channel.owner_user_id ? String(channel.owner_user_id) : '');
    setPointsRequired(String(channel.points_required ?? channel.pointsRequired ?? 0));
    setUnlockToFree(!!(channel.unlock_to_free ?? channel.unlockToFree));
    setAddChannelModalVisible(true);
  };

  const renderChannelRow = (channel, index, categoryKey, categoryList, hideFreeInCategories) => {
    const panResponder = getRowPanResponder(
      categoryKey,
      channel.id,
      index,
      hideFreeInCategories,
    );
    const isDragging = draggingChannelId === channel.id;
    const canMoveUp = index > 0;
    const canMoveDown = index < categoryList.length - 1;
    const isDropTarget =
      dragHoverIndex != null &&
      draggingChannelId !== channel.id &&
      index === dragHoverIndex;
    const def =
      categoryKey === BURE_SECTION_KEY ? getCategoryDef(channel.category) : getCategoryDef(categoryKey);
    const isLast = index === categoryList.length - 1;
    const originDef = getCategoryDef(channel.category);

    return (
      <View
        key={channel.id}
        onLayout={(e) => {
          const h = e.nativeEvent.layout.height;
          if (h > 40) rowHeightRef.current = h;
        }}
        style={[
          styles.channelRow,
          isLast && styles.channelRowLast,
          isDragging && styles.channelRowDragging,
          isDropTarget && styles.channelRowDropTarget,
        ]}>
        {canReorder ? (
          <View style={styles.reorderColumn}>
            <TouchableOpacity
              style={[styles.reorderStepBtn, !canMoveUp && styles.reorderStepBtnDisabled]}
              onPress={() => moveChannelOneStep(categoryKey, channel.id, -1, hideFreeInCategories)}
              disabled={!canMoveUp || !!savingOrder}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Move channel up">
              <Icon name="chevron-up" size={20} color={canMoveUp ? '#c4b5fd' : '#4b5563'} />
            </TouchableOpacity>
            <View
              style={styles.dragHandle}
              {...(panResponder ? panResponder.panHandlers : {})}
              accessibilityLabel="Drag to reorder">
              <Icon name="drag-vertical" size={20} color={isDragging ? '#c4b5fd' : '#6b7280'} />
            </View>
            <TouchableOpacity
              style={[styles.reorderStepBtn, !canMoveDown && styles.reorderStepBtnDisabled]}
              onPress={() => moveChannelOneStep(categoryKey, channel.id, 1, hideFreeInCategories)}
              disabled={!canMoveDown || !!savingOrder}
              activeOpacity={0.6}
              hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              accessibilityLabel="Move channel down">
              <Icon name="chevron-down" size={20} color={canMoveDown ? '#c4b5fd' : '#4b5563'} />
            </TouchableOpacity>
          </View>
        ) : (
          <View style={styles.dragHandlePlaceholder} />
        )}
        <LinearGradient
          colors={[channel.color || def.color, '#1e293b']}
          style={styles.channelRowAccent}
          start={{ x: 0, y: 0 }}
          end={{ x: 0, y: 1 }}
        />
        <View style={styles.channelRowMain}>
          <View style={styles.channelRowTop}>
            <View style={[styles.channelThumb, { backgroundColor: `${channel.color || def.color}33` }]}>
              {channel.thumbnail_emoji ? (
                <Text style={styles.channelThumbEmoji}>{channel.thumbnail_emoji}</Text>
              ) : (
                <Icon name={def.icon} size={22} color="#fff" />
              )}
            </View>
            <View style={styles.channelRowInfo}>
              <Text style={styles.channelRowName} numberOfLines={1}>
                {channel.name}
              </Text>
              <View style={styles.channelRowMeta}>
                {categoryKey === BURE_SECTION_KEY ? (
                  <>
                    <Text style={styles.channelRowCategory}>{originDef.name}</Text>
                    <Text style={styles.channelRowDot}>·</Text>
                  </>
                ) : null}
                <Text
                  style={[
                    styles.channelRowStatus,
                    channel.is_active ? styles.channelRowStatusActive : styles.channelRowStatusOff,
                  ]}>
                  {channel.is_active ? 'Active' : 'Inactive'}
                </Text>
                {hasFreeAccess(channel) ? (
                  <>
                    <Text style={styles.channelRowDot}>·</Text>
                    <Text style={styles.channelRowBureTag}>Bure</Text>
                  </>
                ) : (
                  <>
                    <Text style={styles.channelRowDot}>·</Text>
                    <Text style={styles.channelRowPremiumTag}>Premium</Text>
                  </>
                )}
                <Text style={styles.channelRowDot}>·</Text>
                <Text style={styles.channelRowViews}>
                  {typeof channel.view_count === 'number' ? `${channel.view_count} views` : '0 views'}
                </Text>
              </View>
            </View>
          </View>
        </View>
        <View style={styles.channelRowActions}>
          <TouchableOpacity
            style={styles.channelIconBtn}
            onPress={() => openEditChannel(channel)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="pencil" size={20} color="#60a5fa" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.channelIconBtn, styles.channelIconBtnDanger]}
            onPress={() => setDeleteConfirmChannel(channel)}
            hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
            <Icon name="delete" size={20} color="#f87171" />
          </TouchableOpacity>
        </View>
      </View>
    );
  };

  const renderCategorySection = (catDef, categoryChannels, hideFreeInCategories) => {
    if (!categoryChannels.length) return null;
    return (
      <View key={catDef.key} style={styles.categorySection}>
        <View style={styles.categorySectionHeader}>
          <View style={styles.categorySectionHeaderLeft}>
            <View style={[styles.categorySectionIconWrap, { backgroundColor: `${catDef.color}22` }]}>
              <Icon name={catDef.icon} size={20} color={catDef.color} />
            </View>
            <Text style={styles.categorySectionTitle}>{catDef.name}</Text>
          </View>
          <Text style={styles.categorySectionCount}>{categoryChannels.length} channels</Text>
        </View>
        <View style={styles.categorySectionList}>
          {categoryChannels.map((channel, index) =>
            renderChannelRow(channel, index, catDef.key, categoryChannels, hideFreeInCategories),
          )}
        </View>
      </View>
    );
  };

  const { freeChannels, grouped, hideFreeInCategories } = buildDisplayModel();
  const categoriesToShow = CATEGORY_DEFS.filter((def) => {
    if (activeFilter === 'bure') return false;
    if (activeFilter === 'kabumbu') return def.app === 'kabumbu';
    if (activeFilter === 'habari') return def.app === 'habari';
    if (activeFilter === 'moviesapp') return def.app === 'moviesapp';
    return true;
  });
  const hasAnyChannel =
    (activeFilter === 'all' || activeFilter === 'bure' ? freeChannels.length > 0 : false) ||
    categoriesToShow.some((def) => (grouped[def.key] || []).length > 0);

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
      nestedScrollEnabled
      scrollEnabled={!draggingChannelId}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={onRefresh} enabled={!draggingChannelId} />
      }>
      {savingOrder ? (
        <View style={styles.savingOrderBanner}>
          <ActivityIndicator size="small" color="#a78bfa" />
          <Text style={styles.savingOrderText}>Saving order…</Text>
        </View>
      ) : null}

      {canReorder ? (
        <Text style={styles.reorderHint}>
          Use ↑ ↓ to move channels, or drag the ⋮⋮ handle. Order saves automatically.
        </Text>
      ) : searchTrimmed ? (
        <Text style={styles.reorderHint}>Clear search to reorder channels.</Text>
      ) : null}

      {/* Filters */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        scrollEnabled={!draggingChannelId}
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
          onPress={() => {
            resetForm();
            if (activeFilter === 'bure') {
              setChannelCategory('football');
              setUnlockToFree(true);
              setPointsRequired('0');
            } else if (activeFilter === 'kabumbu') setChannelCategory('football');
            else if (activeFilter === 'habari') setChannelCategory('habari');
            else if (activeFilter === 'moviesapp') setChannelCategory('movies');
            setAddChannelModalVisible(true);
          }}>
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

      {!hasAnyChannel ? (
        <View style={styles.channelListCard}>
          <View style={styles.emptyState}>
            <Icon name="television-off" size={48} color="#6b7280" />
            <Text style={styles.emptyStateText}>
              {searchTrimmed ? 'No channels match your search' : 'No channels in this view'}
            </Text>
            <Text style={styles.emptyStateSubtext}>
              {searchTrimmed
                ? 'Try a different search or clear the search box'
                : 'Add a channel with the + button above'}
            </Text>
          </View>
        </View>
      ) : (
        <View style={styles.groupedChannelsWrap}>
          {activeFilter === 'all'
            ? APP_GROUPS.map((appGroup) => {
                if (appGroup.id === 'bure') {
                  if (!freeChannels.length) return null;
                  return (
                    <View key="bure" style={styles.appGroupBlock}>
                      <View style={styles.appGroupHeader}>
                        <Icon name={appGroup.icon} size={22} color={appGroup.color} />
                        <Text style={styles.appGroupTitle}>{appGroup.label}</Text>
                      </View>
                      {renderCategorySection(BURE_DEF, freeChannels, hideFreeInCategories)}
                    </View>
                  );
                }
                const defs = CATEGORY_DEFS.filter((d) => d.app === appGroup.id);
                const groupHasChannels = defs.some((d) => (grouped[d.key] || []).length > 0);
                if (!groupHasChannels) return null;
                return (
                  <View key={appGroup.id} style={styles.appGroupBlock}>
                    <View style={styles.appGroupHeader}>
                      <Icon name={appGroup.icon} size={22} color={appGroup.color} />
                      <Text style={styles.appGroupTitle}>{appGroup.label}</Text>
                    </View>
                    {defs.map((def) =>
                      renderCategorySection(def, grouped[def.key] || [], hideFreeInCategories),
                    )}
                  </View>
                );
              })
            : activeFilter === 'bure'
              ? renderCategorySection(BURE_DEF, freeChannels, false)
              : categoriesToShow.map((def) =>
                  renderCategorySection(def, grouped[def.key] || [], hideFreeInCategories),
                )}
        </View>
      )}

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
                  {editingChannel?.id != null ? (
                    <View style={styles.channelIdRow}>
                      <Text style={styles.channelIdLabel}>Channel ID</Text>
                      <Text style={styles.channelIdValue}>#{String(editingChannel.id)}</Text>
                    </View>
                  ) : null}
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
                    {CATEGORY_DEFS.map((opt) => {
                      const active = channelCategory === opt.key;
                      return (
                        <TouchableOpacity
                          key={opt.key}
                          style={[styles.categoryChip, active && styles.categoryChipActive]}
                          onPress={() => setChannelCategory(opt.key)}>
                          <Text style={[styles.categoryChipText, active && styles.categoryChipTextActive]}>
                            {opt.name}
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
                  <Text style={styles.inputLabel}>Stream URL *</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="https://..."
                    placeholderTextColor="#6b7280"
                    value={videoUrl}
                    onChangeText={setVideoUrl}
                    autoCapitalize="none"
                    keyboardType="url"
                  />
                </View>
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
              </View>

              {/* Appearance & access card */}
              <View style={styles.formCard}>
                <Text style={styles.formCardTitle}>Appearance & access</Text>
                <View style={styles.inputSection}>
                  <Text style={styles.inputLabel}>Points required to unlock</Text>
                  <TextInput
                    style={styles.input}
                    placeholder="e.g. 15 (for points unlock — separate from Access)"
                    placeholderTextColor="#6b7280"
                    value={pointsRequired}
                    onChangeText={setPointsRequired}
                    keyboardType="numeric"
                  />
                </View>
                <View style={styles.accessToggleSection}>
                  <View style={styles.accessToggleLeft}>
                    <Text style={styles.toggleLabel}>Access</Text>
                    <View style={styles.accessPills}>
                      <Text
                        style={[
                          styles.accessPill,
                          !unlockToFree && styles.accessPillActivePremium,
                        ]}>
                        Premium
                      </Text>
                      <Text
                        style={[
                          styles.accessPill,
                          unlockToFree && styles.accessPillActiveFree,
                        ]}>
                        Free
                      </Text>
                    </View>
                    <Text style={styles.accessHint}>
                      {unlockToFree
                        ? 'Listed under Chaneli za bure — all users can watch without premium'
                        : 'Premium only — not shown in Za bure, even if points are 0'}
                    </Text>
                  </View>
                  <Switch
                    value={unlockToFree}
                    onValueChange={(next) => setUnlockToFree(!!next)}
                    trackColor={{ false: '#7c3aed', true: '#22c55e' }}
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
                    <Text style={styles.toggleLabel}>Active</Text>
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
                    setOrderedChannels((prev) => prev.filter((ch) => ch.id !== channelToDelete.id));
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
  groupedChannelsWrap: {
    gap: 16,
    marginBottom: 16,
  },
  appGroupBlock: {
    gap: 12,
  },
  appGroupHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 4,
    paddingVertical: 6,
  },
  appGroupTitle: {
    fontSize: 16,
    fontWeight: '800',
    color: '#e5e7eb',
    letterSpacing: 0.3,
  },
  categorySection: {
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  categorySectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 12,
    backgroundColor: 'rgba(31, 41, 55, 0.55)',
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  categorySectionHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  categorySectionIconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  categorySectionTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
  },
  categorySectionCount: {
    fontSize: 12,
    fontWeight: '600',
    color: '#9ca3af',
  },
  categorySectionList: {
    overflow: 'visible',
  },
  channelListCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.85)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
    marginBottom: 16,
  },
  channelRow: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: CHANNEL_ROW_HEIGHT,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
  },
  channelRowLast: {
    borderBottomWidth: 0,
  },
  channelRowDragging: {
    backgroundColor: 'rgba(124, 58, 237, 0.18)',
    borderColor: 'rgba(168, 85, 247, 0.45)',
  },
  channelRowDropTarget: {
    borderTopWidth: 2,
    borderTopColor: '#a855f7',
    backgroundColor: 'rgba(124, 58, 237, 0.08)',
  },
  savingOrderBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    marginHorizontal: 16,
    marginBottom: 8,
    paddingVertical: 10,
    borderRadius: 10,
    backgroundColor: 'rgba(124, 58, 237, 0.15)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
  },
  savingOrderText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#c4b5fd',
  },
  reorderHint: {
    fontSize: 12,
    color: '#9ca3af',
    marginHorizontal: 16,
    marginBottom: 10,
    lineHeight: 17,
  },
  reorderColumn: {
    width: 44,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 6,
    gap: 2,
  },
  reorderStepBtn: {
    width: 36,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(124, 58, 237, 0.12)',
  },
  reorderStepBtnDisabled: {
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
  },
  dragHandle: {
    width: 40,
    height: 32,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 8,
    backgroundColor: 'rgba(55, 65, 81, 0.6)',
  },
  dragHandlePlaceholder: {
    width: 44,
  },
  channelRowAccent: {
    width: 4,
    alignSelf: 'stretch',
  },
  channelRowMain: {
    flex: 1,
    paddingVertical: 12,
    paddingRight: 8,
  },
  channelRowTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  channelThumb: {
    width: 44,
    height: 44,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelThumbEmoji: {
    fontSize: 22,
  },
  channelRowInfo: {
    flex: 1,
    minWidth: 0,
  },
  channelRowName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#f8fafc',
    marginBottom: 4,
  },
  channelRowMeta: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    gap: 4,
  },
  channelRowCategory: {
    fontSize: 12,
    color: '#94a3b8',
    fontWeight: '600',
  },
  channelRowBureTag: {
    fontSize: 12,
    color: '#4ade80',
    fontWeight: '700',
  },
  channelRowPremiumTag: {
    fontSize: 12,
    color: '#c4b5fd',
    fontWeight: '700',
  },
  channelRowDot: {
    fontSize: 12,
    color: '#4b5563',
  },
  channelRowStatus: {
    fontSize: 12,
    fontWeight: '600',
  },
  channelRowStatusActive: {
    color: '#34d399',
  },
  channelRowStatusOff: {
    color: '#9ca3af',
  },
  channelRowViews: {
    fontSize: 12,
    color: '#6b7280',
  },
  channelRowActions: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 10,
  },
  channelIconBtn: {
    width: 38,
    height: 38,
    borderRadius: 10,
    backgroundColor: 'rgba(59, 130, 246, 0.15)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  channelIconBtnDanger: {
    backgroundColor: 'rgba(239, 68, 68, 0.15)',
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
  channelIdRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 8,
  },
  channelIdLabel: {
    fontSize: 12,
    color: '#9ca3af',
    fontWeight: '600',
  },
  channelIdValue: {
    fontSize: 12,
    color: '#fff',
    fontWeight: '800',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(124, 58, 237, 0.22)',
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.35)',
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
  accessToggleSection: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 14,
    marginBottom: 8,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(55, 65, 81, 0.4)',
    gap: 12,
  },
  accessToggleLeft: {
    flex: 1,
    marginRight: 8,
  },
  accessPills: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 8,
  },
  accessPill: {
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: '#6b7280',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#374151',
    backgroundColor: 'rgba(17, 24, 39, 0.6)',
    overflow: 'hidden',
  },
  accessPillActivePremium: {
    color: '#e9d5ff',
    borderColor: 'rgba(124, 58, 237, 0.55)',
    backgroundColor: 'rgba(124, 58, 237, 0.28)',
  },
  accessPillActiveFree: {
    color: '#bbf7d0',
    borderColor: 'rgba(34, 197, 94, 0.55)',
    backgroundColor: 'rgba(34, 197, 94, 0.22)',
  },
  accessHint: {
    marginTop: 8,
    fontSize: 12,
    color: '#9ca3af',
    lineHeight: 17,
    maxWidth: width - 120,
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
