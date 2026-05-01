import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  Dimensions,
  Modal,
  ActivityIndicator,
  RefreshControl,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { adminUsersAPI, dashboardAPI } from '../../config/api';

const { width } = Dimensions.get('window');

// Generate gradient colors based on user ID
const getGradientColors = (id) => {
  const gradients = [
    ['#3b82f6', '#7c3aed'],
    ['#10b981', '#3b82f6'],
    ['#f97316', '#ef4444'],
    ['#ec4899', '#7c3aed'],
    ['#06b6d4', '#3b82f6'],
    ['#8b5cf6', '#ec4899'],
  ];
  return gradients[id % gradients.length];
};

// Get initials from external_id (e.g., "User-A2F34" -> "UA")
const getInitials = (externalId) => {
  if (!externalId) return 'U';
  const parts = externalId.split('-');
  if (parts.length > 1) {
    return parts[1].substring(0, 2).toUpperCase();
  }
  return externalId.substring(0, 2).toUpperCase();
};

const UsersSection = ({ isActive }) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [users, setUsers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [selectedUser, setSelectedUser] = useState(null);
  const [managementModalVisible, setManagementModalVisible] = useState(false);
  const [specialAccessModalVisible, setSpecialAccessModalVisible] = useState(false);
  const [accessType, setAccessType] = useState('days'); // 'days', 'hours', 'weeks', 'months'
  const [accessValue, setAccessValue] = useState('');
  const [statusModalVisible, setStatusModalVisible] = useState(false);
  const [statusModalTitle, setStatusModalTitle] = useState('');
  const [statusModalMessage, setStatusModalMessage] = useState('');
  const [statusModalType, setStatusModalType] = useState('success'); // 'success' or 'error'
  const [grantingAccess, setGrantingAccess] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all', 'free', 'premium', 'expired'
  const [totalUsers, setTotalUsers] = useState(0);
  const wasActiveRef = useRef(false);

  // Show status modal
  const showStatusModal = useCallback((type, title, message) => {
    setStatusModalType(type);
    setStatusModalTitle(title);
    setStatusModalMessage(message);
    setStatusModalVisible(true);
  }, [setStatusModalType, setStatusModalTitle, setStatusModalMessage, setStatusModalVisible]);

  // Fetch users from backend with filters
  const fetchUsers = useCallback(async () => {
    try {
      const { users: data, total } = await dashboardAPI.getUsers(200, 0, filter, searchQuery);
      
      // Format users for display
      const formattedUsers = data.map((user, index) => {
        const isPremium =
          user.is_premium === true &&
          (!user.premium_expires_at || new Date(user.premium_expires_at) > new Date());
        
        const isExpired =
          user.is_premium === true &&
          user.premium_expires_at &&
          new Date(user.premium_expires_at) <= new Date();
        
        let statusText = 'Free';
        if (isPremium) {
          statusText = 'Premium';
        } else if (isExpired) {
          statusText = 'Expired';
        }
        
        return {
          id: user.id,
          name: user.external_id || `User-${user.id}`,
          initials: getInitials(user.external_id),
          status: statusText,
          gradient: getGradientColors(index),
          blocked: user.blocked || false,
          premiumExpiresAt: user.premium_expires_at,
          createdAt: user.created_at,
          rawData: user,
        };
      });
      
      setUsers(formattedUsers);
      setTotalUsers(total);
    } catch (error) {
      console.error('Failed to fetch users:', error);
      showStatusModal('error', 'Error', 'Failed to load users. Please try again.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filter, searchQuery, showStatusModal]);

  useEffect(() => {
    fetchUsers();
  }, [filter, searchQuery, fetchUsers]);

  // When user switches to Users tab, refetch so premium status is up to date (e.g. after payment)
  useEffect(() => {
    if (isActive && !wasActiveRef.current) {
      fetchUsers();
    }
    wasActiveRef.current = !!isActive;
  }, [isActive, fetchUsers]);

  // Auto-refresh every 15s while Users tab is active so premium status updates when payment succeeds
  useEffect(() => {
    if (!isActive) return;
    const id = setInterval(() => fetchUsers(), 15000);
    return () => clearInterval(id);
  }, [isActive, filter, searchQuery, fetchUsers]);

  const onRefresh = () => {
    setRefreshing(true);
    fetchUsers();
  };

  // Handle block user
  const handleBlockUser = async () => {
    if (!selectedUser?.rawData) return;
    
    try {
      await adminUsersAPI.blockUser(selectedUser.rawData.id, !selectedUser.blocked);
      showStatusModal(
        'success',
        'User Updated',
        `${selectedUser.name} has been ${!selectedUser.blocked ? 'blocked' : 'unblocked'} from accessing content`
      );
      setManagementModalVisible(false);
      fetchUsers(); // Refresh list
    } catch (error) {
      console.error('Failed to block user:', error);
      showStatusModal('error', 'Update Failed', 'Failed to update user. Please try again.');
    }
  };

  // Handle special access
  const handleGrantSpecialAccess = async () => {
    if (!accessValue || parseInt(accessValue) <= 0) {
      showStatusModal('error', 'Invalid Duration', 'Please enter a valid duration');
      return;
    }

    if (!selectedUser?.rawData) return;

    try {
      setGrantingAccess(true);
      await adminUsersAPI.giveSpecialAccess(
        selectedUser.rawData.id,
        parseInt(accessValue),
        accessType
      );
      showStatusModal(
        'success',
        'Access Granted',
        `Special access granted: ${accessValue} ${accessType} of premium access for ${selectedUser.name}. All channels have been unlocked.`
      );
      setSpecialAccessModalVisible(false);
      setAccessValue('');
      setAccessType('days');
      fetchUsers(); // Refresh list
    } catch (error) {
      console.error('Failed to grant special access:', error);
      showStatusModal('error', 'Grant Failed', 'Failed to grant access. Please try again.');
    } finally {
      setGrantingAccess(false);
    }
  };

  if (loading) {
    return (
      <View style={[styles.container, styles.loadingContainer]}>
        <ActivityIndicator size="large" color="#7c3aed" />
        <Text style={styles.loadingText}>Loading users...</Text>
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
      {/* Header Stats */}
      <View style={styles.statsRow}>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{totalUsers}</Text>
          <Text style={styles.statLabel}>Total</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.filter(u => u.status === 'Premium').length}</Text>
          <Text style={styles.statLabel}>Premium</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.filter(u => u.status === 'Free').length}</Text>
          <Text style={styles.statLabel}>Free</Text>
        </View>
        <View style={styles.statCard}>
          <Text style={styles.statValue}>{users.filter(u => u.status === 'Expired').length}</Text>
          <Text style={styles.statLabel}>Expired</Text>
        </View>
      </View>

      {/* Search */}
      <View style={styles.searchContainer}>
        <View style={styles.searchBox}>
          <Icon name="magnify" size={20} color="#9ca3af" />
          <TextInput
            style={styles.searchInput}
            placeholder="Search users..."
            placeholderTextColor="#6b7280"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
        </View>
      </View>

      {/* Filter Tabs */}
      <ScrollView 
        horizontal 
        showsHorizontalScrollIndicator={false} 
        style={styles.filterContainer}
        contentContainerStyle={styles.filterScroll}>
        <TouchableOpacity
          style={[styles.filterTab, filter === 'all' && styles.filterTabActive]}
          onPress={() => setFilter('all')}
          activeOpacity={0.7}>
          <Icon 
            name="account-group" 
            size={16} 
            color={filter === 'all' ? '#fff' : '#9ca3af'} 
          />
          <Text style={[styles.filterTabText, filter === 'all' && styles.filterTabTextActive]}>
            All
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterTab, filter === 'premium' && styles.filterTabActive]}
          onPress={() => setFilter('premium')}
          activeOpacity={0.7}>
          <Icon 
            name="star" 
            size={16} 
            color={filter === 'premium' ? '#fff' : '#9ca3af'} 
          />
          <Text style={[styles.filterTabText, filter === 'premium' && styles.filterTabTextActive]}>
            Premium
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterTab, filter === 'free' && styles.filterTabActive]}
          onPress={() => setFilter('free')}
          activeOpacity={0.7}>
          <Icon 
            name="account" 
            size={16} 
            color={filter === 'free' ? '#fff' : '#9ca3af'} 
          />
          <Text style={[styles.filterTabText, filter === 'free' && styles.filterTabTextActive]}>
            Free
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.filterTab, filter === 'expired' && styles.filterTabActive]}
          onPress={() => setFilter('expired')}
          activeOpacity={0.7}>
          <Icon 
            name="clock-alert" 
            size={16} 
            color={filter === 'expired' ? '#fff' : '#9ca3af'} 
          />
          <Text style={[styles.filterTabText, filter === 'expired' && styles.filterTabTextActive]}>
            Expired
          </Text>
        </TouchableOpacity>
      </ScrollView>

      {/* Users Table */}
      <View style={styles.tableCard}>
        <View style={styles.tableHeader}>
          <Text style={styles.tableHeaderText}>
            {filter === 'all' ? 'All Users' : 
             filter === 'premium' ? 'Premium Users' : 
             filter === 'free' ? 'Free Users' : 'Expired'} ({users.length})
          </Text>
          {isActive && (
            <View style={styles.autoRefreshIndicator}>
              <View style={styles.autoRefreshDot} />
              <Text style={styles.autoRefreshText}>Live</Text>
            </View>
          )}
        </View>
        {users.length === 0 ? (
          <View style={styles.emptyState}>
            <Icon name="account-off" size={48} color="#6b7280" />
            <Text style={styles.emptyStateText}>
              {filter === 'all' ? 'No users found' :
               filter === 'premium' ? 'No premium users' :
               filter === 'free' ? 'No free users' : 'No expired subscriptions'}
            </Text>
          </View>
        ) : (
          users.map((user) => (
          <View key={user.id} style={styles.tableRow}>
            <View style={styles.userCell}>
              <LinearGradient
                colors={user.gradient}
                style={styles.userAvatar}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}>
                <Text style={styles.userInitials}>{user.initials}</Text>
              </LinearGradient>
              <View style={styles.userInfo}>
                <Text style={styles.userName}>{user.name}</Text>
                <View
                  style={[
                    styles.statusBadge,
                    user.status === 'Premium'
                      ? styles.premiumBadge
                      : user.status === 'Expired'
                      ? styles.expiredBadge
                      : styles.freeBadge,
                  ]}>
                  <Text
                    style={[
                      styles.statusText,
                      user.status === 'Premium'
                        ? styles.premiumText
                        : user.status === 'Expired'
                        ? styles.expiredText
                        : styles.freeText,
                    ]}>
                    {user.status}
                  </Text>
                </View>
                {user.premiumExpiresAt && user.status === 'Premium' && (
                  <Text style={styles.expiryText}>
                    Expires: {new Date(user.premiumExpiresAt).toLocaleDateString()}
                  </Text>
                )}
                {user.premiumExpiresAt && user.status === 'Expired' && (
                  <Text style={styles.expiredAtText}>
                    Expired: {new Date(user.premiumExpiresAt).toLocaleDateString()}
                  </Text>
                )}
              </View>
            </View>
            <TouchableOpacity
              style={styles.actionButton}
              onPress={() => {
                setSelectedUser(user);
                setManagementModalVisible(true);
              }}
              activeOpacity={0.7}
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}>
              <Icon name="dots-vertical" size={20} color="#9ca3af" />
            </TouchableOpacity>
          </View>
          ))
        )}
      </View>

      {/* User Management Modal */}
      <Modal
        visible={managementModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setManagementModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <LinearGradient
            colors={['#030712', '#111827', '#1f2937']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>
                Manage {selectedUser?.name}
              </Text>
              <TouchableOpacity
                onPress={() => setManagementModalVisible(false)}
                style={styles.closeButton}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <View style={styles.modalBody}>
              <TouchableOpacity
                style={styles.managementOption}
                onPress={handleBlockUser}>
                <View style={styles.optionIconContainer}>
                  <Icon name="block" size={24} color="#ef4444" />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionTitle}>Block User</Text>
                  <Text style={styles.optionDescription}>
                    Prevent user from accessing content
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color="#9ca3af" />
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.managementOption}
                onPress={() => {
                  setManagementModalVisible(false);
                  setSpecialAccessModalVisible(true);
                }}>
                <View style={[styles.optionIconContainer, { backgroundColor: 'rgba(16, 185, 129, 0.2)' }]}>
                  <Icon name="gift" size={24} color="#10b981" />
                </View>
                <View style={styles.optionContent}>
                  <Text style={styles.optionTitle}>Give Special Access</Text>
                  <Text style={styles.optionDescription}>
                    Grant temporary premium access
                  </Text>
                </View>
                <Icon name="chevron-right" size={20} color="#9ca3af" />
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Special Access Modal */}
      <Modal
        visible={specialAccessModalVisible}
        animationType="slide"
        transparent={true}
        onRequestClose={() => setSpecialAccessModalVisible(false)}>
        <SafeAreaView style={styles.modalContainer}>
          <LinearGradient
            colors={['#030712', '#111827', '#1f2937']}
            style={StyleSheet.absoluteFill}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
          />
          <View style={styles.modalContent}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Special Access</Text>
              <TouchableOpacity
                onPress={() => {
                  setSpecialAccessModalVisible(false);
                  setAccessValue('');
                  setAccessType('days');
                }}
                style={styles.closeButton}>
                <Icon name="close" size={24} color="#9ca3af" />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.modalBody} showsVerticalScrollIndicator={false}>
              <Text style={styles.modalSubtitle}>
                Grant premium access to {selectedUser?.name}
              </Text>

              {/* Access Type Selection */}
              <View style={styles.accessTypeContainer}>
                <Text style={styles.inputLabel}>Access Duration</Text>
                <View style={styles.accessTypeButtons}>
                  {[
                    { id: 'hours', label: 'Hours' },
                    { id: 'days', label: 'Days' },
                    { id: 'weeks', label: 'Weeks' },
                    { id: 'months', label: 'Months' },
                  ].map((type) => (
                    <TouchableOpacity
                      key={type.id}
                      style={[
                        styles.accessTypeButton,
                        accessType === type.id && styles.accessTypeButtonActive,
                      ]}
                      onPress={() => setAccessType(type.id)}>
                      <Text
                        style={[
                          styles.accessTypeButtonText,
                          accessType === type.id && styles.accessTypeButtonTextActive,
                        ]}>
                        {type.label}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>
              </View>

              {/* Access Value Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Duration</Text>
                <TextInput
                  style={styles.input}
                  placeholder={`Enter number of ${accessType}`}
                  placeholderTextColor="#6b7280"
                  value={accessValue}
                  onChangeText={setAccessValue}
                  keyboardType="numeric"
                />
              </View>

              {/* Action Buttons */}
              <View style={styles.modalActions}>
                <TouchableOpacity
                  style={styles.cancelButton}
                  onPress={() => {
                    setSpecialAccessModalVisible(false);
                    setAccessValue('');
                    setAccessType('days');
                  }}>
                  <Text style={styles.cancelButtonText}>Cancel</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[
                    styles.confirmButton,
                    grantingAccess && { opacity: 0.7 },
                  ]}
                  onPress={handleGrantSpecialAccess}
                  disabled={grantingAccess}>
                  {grantingAccess ? (
                    <ActivityIndicator size="small" color="#fff" />
                  ) : (
                    <Text style={styles.confirmButtonText}>Grant Access</Text>
                  )}
                </TouchableOpacity>
              </View>
            </ScrollView>
          </View>
        </SafeAreaView>
      </Modal>

      {/* Status Modal */}
      <Modal
        visible={statusModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setStatusModalVisible(false)}>
        <View style={styles.statusModalOverlay}>
          <View style={styles.statusModalContent}>
            <View style={[
              styles.statusModalIconContainer,
              statusModalType === 'success' 
                ? styles.statusModalIconSuccess 
                : styles.statusModalIconError
            ]}>
              <Icon
                name={statusModalType === 'success' ? 'check-circle' : 'alert-circle'}
                size={48}
                color={statusModalType === 'success' ? '#10b981' : '#ef4444'}
              />
            </View>
            <Text style={styles.statusModalTitle}>{statusModalTitle}</Text>
            <Text style={styles.statusModalMessage}>{statusModalMessage}</Text>
            <TouchableOpacity
              style={[
                styles.statusModalButton,
                statusModalType === 'success' 
                  ? styles.statusModalButtonSuccess 
                  : styles.statusModalButtonError
              ]}
              onPress={() => setStatusModalVisible(false)}
              activeOpacity={0.8}>
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
  searchContainer: {
    marginBottom: 16,
  },
  searchBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 12,
    paddingHorizontal: 16,
    gap: 12,
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  searchInput: {
    flex: 1,
    color: '#fff',
    fontSize: 14,
    paddingVertical: 12,
  },
  tableCard: {
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#1f2937',
    overflow: 'hidden',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  tableHeaderText: {
    flex: 1,
    fontSize: 13,
    fontWeight: '600',
    color: '#fff',
  },
  tableRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  userCell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginRight: 16,
  },
  userInfo: {
    flex: 1,
    gap: 6,
  },
  userAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    justifyContent: 'center',
    alignItems: 'center',
  },
  userInitials: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  userName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
  },
  actionButton: {
    padding: 4,
    width: 50,
    alignItems: 'flex-end',
  },
  statusBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  premiumBadge: {
    backgroundColor: 'rgba(234, 179, 8, 0.2)',
  },
  freeBadge: {
    backgroundColor: 'rgba(55, 65, 81, 0.5)',
  },
  expiredBadge: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusText: {
    fontSize: 11,
    fontWeight: '600',
  },
  premiumText: {
    color: '#fbbf24',
  },
  freeText: {
    color: '#d1d5db',
  },
  expiredText: {
    color: '#f87171',
  },
  expiryText: {
    fontSize: 11,
    color: '#10b981',
    marginTop: 2,
  },
  expiredAtText: {
    fontSize: 11,
    color: '#ef4444',
    marginTop: 2,
  },
  statsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  statCard: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderRadius: 12,
    padding: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  statValue: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  statLabel: {
    fontSize: 11,
    color: '#9ca3af',
    marginTop: 4,
  },
  filterContainer: {
    marginBottom: 16,
  },
  filterScroll: {
    gap: 8,
  },
  filterTab: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: 'rgba(17, 24, 39, 0.8)',
    borderWidth: 1,
    borderColor: '#1f2937',
  },
  filterTabActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  filterTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#9ca3af',
  },
  filterTabTextActive: {
    color: '#fff',
  },
  autoRefreshIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  autoRefreshDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10b981',
  },
  autoRefreshText: {
    fontSize: 11,
    color: '#10b981',
  },
  modalContainer: {
    flex: 1,
  },
  modalContent: {
    flex: 1,
    backgroundColor: 'rgba(17, 24, 39, 0.95)',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    marginTop: 100,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#1f2937',
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  closeButton: {
    padding: 4,
  },
  modalBody: {
    flex: 1,
    padding: 16,
  },
  modalSubtitle: {
    fontSize: 14,
    color: '#9ca3af',
    marginBottom: 24,
  },
  managementOption: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: 16,
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 12,
    marginBottom: 12,
    gap: 16,
  },
  optionIconContainer: {
    width: 48,
    height: 48,
    borderRadius: 12,
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  optionContent: {
    flex: 1,
  },
  optionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  optionDescription: {
    fontSize: 13,
    color: '#9ca3af',
  },
  accessTypeContainer: {
    marginBottom: 24,
  },
  inputLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 12,
  },
  accessTypeButtons: {
    flexDirection: 'row',
    gap: 8,
    flexWrap: 'wrap',
  },
  accessTypeButton: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#374151',
  },
  accessTypeButtonActive: {
    backgroundColor: '#7c3aed',
    borderColor: '#7c3aed',
  },
  accessTypeButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#9ca3af',
  },
  accessTypeButtonTextActive: {
    color: '#fff',
  },
  inputContainer: {
    marginBottom: 24,
  },
  input: {
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderWidth: 1,
    borderColor: '#374151',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    marginTop: 24,
    marginBottom: 32,
  },
  cancelButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 12,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  cancelButtonText: {
    color: '#9ca3af',
    fontSize: 16,
    fontWeight: '600',
  },
  confirmButton: {
    flex: 1,
    paddingVertical: 14,
    backgroundColor: '#7c3aed',
    borderRadius: 12,
    alignItems: 'center',
  },
  confirmButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingTop: 100,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#9ca3af',
  },
  emptyState: {
    padding: 48,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyStateText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#9ca3af',
    marginTop: 16,
    marginBottom: 8,
  },
  emptyStateSubtext: {
    fontSize: 14,
    color: '#6b7280',
    textAlign: 'center',
  },
  statusModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.8)',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  statusModalContent: {
    backgroundColor: '#1f2937',
    borderRadius: 20,
    padding: 24,
    width: '100%',
    maxWidth: 400,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#374151',
  },
  statusModalIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  statusModalIconSuccess: {
    backgroundColor: 'rgba(16, 185, 129, 0.2)',
  },
  statusModalIconError: {
    backgroundColor: 'rgba(239, 68, 68, 0.2)',
  },
  statusModalTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 12,
    textAlign: 'center',
  },
  statusModalMessage: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    marginBottom: 24,
    lineHeight: 20,
  },
  statusModalButton: {
    width: '100%',
    paddingVertical: 14,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusModalButtonSuccess: {
    backgroundColor: '#10b981',
  },
  statusModalButtonError: {
    backgroundColor: '#ef4444',
  },
  statusModalButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
});

export default UsersSection;
