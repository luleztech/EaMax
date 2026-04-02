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
