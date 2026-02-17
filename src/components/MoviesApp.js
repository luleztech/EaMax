import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  Dimensions,
  TextInput,
} from 'react-native';
import LinearGradient from 'react-native-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import AntDesign from 'react-native-vector-icons/AntDesign';
import FontAwesome from 'react-native-vector-icons/FontAwesome';
import PaymentsScreen from './PaymentsScreen';
import ProfileScreen from './ProfileScreen';

const { width } = Dimensions.get('window');

const MoviesApp = ({ isPremium, userPoints, onWatchAd, onPaymentsActiveChange }) => {
  const [activeTab, setActiveTab] = useState('home');
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (onPaymentsActiveChange) {
      onPaymentsActiveChange(activeTab === 'payments' || activeTab === 'profile' || activeTab === 'search');
    }
  }, [activeTab, onPaymentsActiveChange]);
  const trendingMovies = [
    { title: 'Dark Waters', rating: 7.8, duration: '1h 45m', points: 20, color: '#7c3aed' },
    { title: 'Summer Love', rating: 8.2, duration: '2h 05m', points: 25, color: '#ec4899' },
    { title: 'Space Quest', rating: 9.1, duration: '2h 30m', points: 30, color: '#2563eb' },
    { title: 'Mystery Manor', rating: 7.5, duration: '1h 50m', points: 20, color: '#ea580c' },
  ];

  const genres = [
    { name: 'Tamthilia', count: '120+', icon: 'drama-masks', color: '#ec4899' },
    { name: 'Movies', count: '85+', icon: 'movie', color: '#3b82f6' },
    { name: 'Wanyama', count: '95+', icon: 'paw', color: '#10b981' },
    { name: 'Katuni', count: '70+', icon: 'animation', color: '#f59e0b' },
    { name: 'Habari', count: '150+', icon: 'newspaper-variant', color: '#ef4444' },
    { name: 'Sayansi', count: '60+', icon: 'atom', color: '#8b5cf6' },
  ];

  return (
    <View style={styles.container}>
      <LinearGradient
        colors={['#581c87', '#111827', '#000000']}
        style={StyleSheet.absoluteFill}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
      />
      {/* Header */}
      {activeTab !== 'payments' && activeTab !== 'profile' && activeTab !== 'search' && (
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Icon name="movie" size={24} color="#a855f7" />
            <Text style={styles.headerTitle}>Bure kwa Points</Text>
          </View>
          <View style={styles.headerRight}>
            <View style={styles.pointsBadge}>
              <AntDesign name="star" size={16} color="#fbbf24" />
              <Text style={styles.pointsText}>{userPoints} pts</Text>
            </View>
            {!isPremium && (
              <TouchableOpacity style={styles.premiumButton}>
                <AntDesign name="star" size={14} color="#fff" />
                <Text style={styles.premiumButtonText}>Go Premium</Text>
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {activeTab === 'payments' ? (
        <PaymentsScreen accentColor="#a855f7" />
      ) : activeTab === 'profile' ? (
        <ProfileScreen accentColor="#a855f7" />
      ) : activeTab === 'search' ? (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          <View style={styles.searchContainer}>
            {/* Search Box */}
            <View style={styles.searchBoxContainer}>
              <View style={styles.searchBox}>
                <Icon name="magnify" size={24} color="#a855f7" />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Tafuta filamu, tamthilia, habari..."
                  placeholderTextColor="#6b7280"
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                />
                {searchQuery.length > 0 && (
                  <TouchableOpacity
                    onPress={() => setSearchQuery('')}
                    style={styles.clearButton}>
                    <Icon name="close-circle" size={20} color="#9ca3af" />
                  </TouchableOpacity>
                )}
              </View>
            </View>

            {/* All Categories */}
            <View style={styles.searchCategoriesSection}>
              <Text style={styles.searchSectionTitle}>Machaguo mbalimbali</Text>
              <View style={styles.searchGenresGrid}>
                {genres.map((genre, index) => (
                  <TouchableOpacity
                    key={index}
                    style={styles.searchGenreCard}
                    activeOpacity={0.8}>
                    <LinearGradient
                      colors={[genre.color + '20', genre.color + '10', 'transparent']}
                      style={styles.searchGenreGradient}
                      start={{ x: 0, y: 0 }}
                      end={{ x: 1, y: 1 }}>
                      <View style={[styles.searchGenreIconContainer, { backgroundColor: genre.color + '30' }]}>
                        <Icon name={genre.icon} size={36} color={genre.color} />
                      </View>
                      <Text style={styles.searchGenreName}>{genre.name}</Text>
                      <Text style={styles.searchGenreCount}>{genre.count} videos</Text>
                    </LinearGradient>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>
        </ScrollView>
      ) : (
        <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
          {/* Featured Movie */}
          <View style={styles.heroContainer}>
          <LinearGradient
            colors={['#581c87', '#111827', '#000000']}
            style={styles.heroImage}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}>
            <View style={styles.heroOverlay} />
            <View style={styles.newBadge}>
              <Text style={styles.newBadgeText}>NEW RELEASE</Text>
            </View>
            <View style={styles.heroContent}>
              <Text style={styles.movieTitle}>The Last Mission</Text>
              <View style={styles.movieInfo}>
                <View style={styles.ratingContainer}>
                  <AntDesign name="star" size={14} color="#fbbf24" />
                  <Text style={styles.ratingText}>8.5</Text>
                </View>
                <Text style={styles.separator}>•</Text>
                <Text style={styles.durationText}>2h 15m</Text>
                <Text style={styles.separator}>•</Text>
                <Text style={styles.genreText}>Action</Text>
              </View>
              <Text style={styles.movieDescription}>
                An elite team embarks on their final dangerous mission to save the world from a catastrophic threat.
              </Text>
              <TouchableOpacity style={styles.watchButton} onPress={onWatchAd}>
                <Icon name="play" size={20} color="#fff" />
                <Text style={styles.watchButtonText}>
                  {isPremium ? 'Watch Now' : 'Watch Ad to Stream'}
                </Text>
              </TouchableOpacity>
              {!isPremium && (
                <View style={styles.pointsInfo}>
                  <AntDesign name="star" size={12} color="#fbbf24" />
                  <Text style={styles.pointsInfoText}>Earn 25 points</Text>
                </View>
              )}
            </View>
          </LinearGradient>
        </View>

        {/* Trending Section */}
        <View style={styles.trendingSection}>
          <View style={styles.sectionHeader}>
            <View style={styles.sectionTitleContainer}>
              <Icon name="trending-up" size={20} color="#a855f7" />
              <Text style={styles.sectionTitle}>Trending Now</Text>
            </View>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.trendingScroll}>
            {trendingMovies.map((movie, index) => (
              <View key={index} style={styles.movieCard}>
                <LinearGradient
                  colors={[movie.color, '#1f2937']}
                  style={styles.movieCardImage}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 1 }}>
                  <View style={styles.movieCardRating}>
                    <AntDesign name="star" size={12} color="#fbbf24" />
                    <Text style={styles.movieCardRatingText}>{movie.rating}</Text>
                  </View>
                  {!isPremium && (
                    <View style={styles.movieCardPoints}>
                      <AntDesign name="star" size={10} color="#fff" />
                      <Text style={styles.movieCardPointsText}>{movie.points}</Text>
                    </View>
                  )}
                </LinearGradient>
                <Text style={styles.movieCardTitle}>{movie.title}</Text>
                <Text style={styles.movieCardDuration}>{movie.duration}</Text>
              </View>
            ))}
          </ScrollView>

          {/* Categories */}
          <View style={styles.categoriesSection}>
            <Text style={styles.sectionTitle}>Machaguo mbalimbali</Text>
            <View style={styles.genresGrid}>
              {genres.map((genre, index) => (
                <TouchableOpacity key={index} style={styles.genreCard} activeOpacity={0.8}>
                  <View style={[styles.genreIconContainer, { backgroundColor: genre.color + '20' }]}>
                    <Icon name={genre.icon} size={32} color={genre.color} />
                  </View>
                  <Text style={styles.genreName}>{genre.name}</Text>
                  <Text style={styles.genreCount}>{genre.count}</Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        </View>
      </ScrollView>
      )}

      {/* Bottom Navigation */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('home')}>
          <Icon
            name="home"
            size={24}
            color={activeTab === 'home' ? '#a855f7' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'home' && styles.navTextActive,
            ]}>
            Home
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('search')}>
          <Icon
            name="magnify"
            size={24}
            color={activeTab === 'search' ? '#a855f7' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'search' && styles.navTextActive,
            ]}>
            Search
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('payments')}>
          <Icon
            name="wallet"
            size={24}
            color={activeTab === 'payments' ? '#a855f7' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'payments' && styles.navTextActive,
            ]}>
            Payments
          </Text>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => setActiveTab('profile')}>
          <Icon
            name="account"
            size={24}
            color={activeTab === 'profile' ? '#a855f7' : '#9ca3af'}
          />
          <Text
            style={[
              styles.navText,
              activeTab === 'profile' && styles.navTextActive,
            ]}>
            Profile
          </Text>
        </TouchableOpacity>
      </View>
    </View>
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
    padding: 16,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(168, 85, 247, 0.3)',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  pointsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: 'rgba(168, 85, 247, 0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: 'rgba(168, 85, 247, 0.3)',
  },
  pointsText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  premiumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#eab308',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  premiumButtonText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 12,
  },
  scrollView: {
    flex: 1,
  },
  heroContainer: {
    padding: 16,
  },
  heroImage: {
    height: 256,
    borderRadius: 16,
    overflow: 'hidden',
  },
  heroOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  newBadge: {
    position: 'absolute',
    top: 12,
    left: 12,
    backgroundColor: '#9333ea',
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 20,
  },
  newBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  heroContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  movieTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 8,
    textAlign: 'center',
  },
  movieInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    marginBottom: 12,
  },
  ratingContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  ratingText: {
    color: '#fff',
    fontWeight: '600',
    fontSize: 14,
  },
  separator: {
    color: '#9ca3af',
  },
  durationText: {
    color: '#fff',
    fontSize: 14,
  },
  genreText: {
    color: '#fff',
    fontSize: 14,
  },
  movieDescription: {
    fontSize: 14,
    color: '#d1d5db',
    textAlign: 'center',
    marginBottom: 16,
    maxWidth: 300,
  },
  watchButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#9333ea',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 20,
  },
  watchButtonText: {
    color: '#fff',
    fontWeight: 'bold',
    fontSize: 14,
  },
  pointsInfo: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginTop: 8,
  },
  pointsInfoText: {
    fontSize: 12,
    color: '#fbbf24',
  },
  trendingSection: {
    padding: 16,
    paddingBottom: 100,
  },
  sectionHeader: {
    marginBottom: 12,
  },
  sectionTitleContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
  },
  trendingScroll: {
    marginBottom: 24,
  },
  movieCard: {
    width: 160,
    marginRight: 12,
  },
  movieCardImage: {
    height: 224,
    borderRadius: 8,
    marginBottom: 8,
    position: 'relative',
  },
  movieCardRating: {
    position: 'absolute',
    top: 8,
    right: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  movieCardRatingText: {
    color: '#fff',
    fontSize: 12,
  },
  movieCardPoints: {
    position: 'absolute',
    top: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(234, 179, 8, 0.9)',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  movieCardPointsText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: 'bold',
  },
  movieCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#fff',
    marginBottom: 4,
  },
  movieCardDuration: {
    fontSize: 12,
    color: '#9ca3af',
  },
  categoriesSection: {
    marginTop: 24,
  },
  genresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 12,
    marginTop: 12,
  },
  genreCard: {
    flex: 1,
    minWidth: '45%',
    backgroundColor: 'rgba(31, 41, 55, 0.5)',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
    alignItems: 'center',
    marginBottom: 12,
  },
  genreIconContainer: {
    width: 64,
    height: 64,
    borderRadius: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  genreName: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  genreCount: {
    fontSize: 13,
    color: '#9ca3af',
    textAlign: 'center',
  },
  bottomNav: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    justifyContent: 'space-around',
    backgroundColor: 'rgba(0, 0, 0, 0.9)',
    paddingVertical: 12,
    borderTopWidth: 1,
    borderTopColor: '#1f2937',
  },
  navItem: {
    alignItems: 'center',
    gap: 4,
  },
  navText: {
    fontSize: 12,
    color: '#9ca3af',
  },
  navTextActive: {
    color: '#a855f7',
  },
  searchContainer: {
    flex: 1,
    padding: 16,
    paddingTop: 24,
    paddingBottom: 100,
  },
  searchBoxContainer: {
    marginBottom: 32,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: 'rgba(31, 41, 55, 0.8)',
    borderRadius: 16,
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderWidth: 2,
    borderColor: 'rgba(168, 85, 247, 0.3)',
    gap: 12,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    color: '#fff',
    padding: 0,
  },
  clearButton: {
    padding: 4,
  },
  searchCategoriesSection: {
    marginTop: 8,
  },
  searchSectionTitle: {
    fontSize: 22,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 20,
  },
  searchGenresGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    gap: 16,
  },
  searchGenreCard: {
    width: (width - 48) / 2,
    borderRadius: 20,
    overflow: 'hidden',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(55, 65, 81, 0.5)',
  },
  searchGenreGradient: {
    padding: 20,
    minHeight: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  searchGenreIconContainer: {
    width: 72,
    height: 72,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.1)',
  },
  searchGenreName: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#fff',
    marginBottom: 6,
    textAlign: 'center',
  },
  searchGenreCount: {
    fontSize: 13,
    color: '#d1d5db',
    textAlign: 'center',
  },
});

export default MoviesApp;
