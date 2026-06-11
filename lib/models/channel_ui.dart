/// How the top-right badge on a channel card should look (label + icon treatment).
enum ChannelBadgeKind {
  /// Star icon — points count or “Bure”.
  pointsOrBure,
  /// Lock icon — channel requires Premium while user is not subscribed.
  lockedProChannel,
  /// Open-lock icon — user has Premium, channel is available.
  premiumMemberUnlocked,
}

class ChannelBadgeUi {
  const ChannelBadgeUi({
    required this.label,
    this.kind = ChannelBadgeKind.pointsOrBure,
  });

  final String label;
  final ChannelBadgeKind kind;
}

/// Admin + subscription rules for the top-right channel badge.
ChannelBadgeUi channelBadgeFor(
  ChannelUi ch, {
  required bool isPremium,
  required bool channelsPremiumOnly,
}) {
  // Free channels always show Bure — even when the user has Premium.
  if (channelIsFreeForCatalog(ch, channelsPremiumOnly)) {
    return const ChannelBadgeUi(label: 'Bure');
  }
  if (isPremium) {
    return const ChannelBadgeUi(
      label: 'Imefunguliwa',
      kind: ChannelBadgeKind.premiumMemberUnlocked,
    );
  }
  if (channelsPremiumOnly) {
    return const ChannelBadgeUi(
      label: 'Imefungwa',
      kind: ChannelBadgeKind.lockedProChannel,
    );
  }
  return ChannelBadgeUi(label: '${ch.pointsRequired}');
}

/// Whether the channel belongs in “Chaneli za bure” / free filters.
bool channelIsFreeForCatalog(ChannelUi ch, bool channelsPremiumOnly) =>
    channelsPremiumOnly ? ch.unlockToFree : ch.pointsRequired <= 0;

class ChannelUi {
  ChannelUi({
    required this.id,
    required this.name,
    this.streamUrl,
    this.thumbnailUrl,
    this.thumbnailEmoji,
    this.color = '#22c55e',
    this.category,
    this.pointsRequired = 0,
    this.unlockToFree = false,
    this.isLive = true,
    this.icon = 'television',
    /// Full channel object from `GET /api/channels` (tokens, drm, headers) for fast playback.
    this.apiRow,
  });

  final int id;
  final String name;
  final String? streamUrl;
  final String? thumbnailUrl;
  final String? thumbnailEmoji;
  final String color;
  final String? category;
  final int pointsRequired;
  final bool unlockToFree;
  final bool isLive;
  final String icon;
  final Map<String, dynamic>? apiRow;
}

class ChannelSection {
  ChannelSection({
    required this.key,
    required this.name,
    required this.icon,
    required this.color,
    required this.channels,
  });

  final String key;
  final String name;
  final String icon;
  final String color;
  final List<ChannelUi> channels;
}
