import 'dart:async';

import 'package:flutter/material.dart';
import 'package:flutter_webrtc/flutter_webrtc.dart';
import 'package:http/http.dart' as http;

/// WebRTC playback (WHEP / WHIP-style POST) for low-latency streams.
class WebRtcPlayerView extends StatefulWidget {
  const WebRtcPlayerView({
    super.key,
    required this.url,
    this.httpHeaders = const {},
    this.onError,
    this.onPlaying,
  });

  final String url;
  final Map<String, String> httpHeaders;
  final ValueChanged<String>? onError;
  final VoidCallback? onPlaying;

  @override
  State<WebRtcPlayerView> createState() => _WebRtcPlayerViewState();
}

class _WebRtcPlayerViewState extends State<WebRtcPlayerView> {
  final RTCVideoRenderer _renderer = RTCVideoRenderer();
  RTCPeerConnection? _pc;
  bool _loading = true;
  String? _error;
  bool _playingNotified = false;

  @override
  void initState() {
    super.initState();
    unawaited(_init());
  }

  Future<void> _init() async {
    try {
      await _renderer.initialize();
      _pc = await createPeerConnection({
        'sdpSemantics': 'unified-plan',
        'iceServers': [
          {'urls': 'stun:stun.l.google.com:19302'},
        ],
      });

      _pc!.onTrack = (event) {
        if (event.track.kind == 'video' && event.streams.isNotEmpty) {
          _renderer.srcObject = event.streams.first;
          if (!_playingNotified) {
            _playingNotified = true;
            widget.onPlaying?.call();
          }
          if (mounted) setState(() => _loading = false);
        }
      };

      _pc!.onConnectionState = (state) {
        if (state == RTCPeerConnectionState.RTCPeerConnectionStateFailed && mounted) {
          setState(() {
            _error = 'WebRTC connection failed';
            _loading = false;
          });
          widget.onError?.call(_error!);
        }
      };

      await _pc!.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeVideo,
        init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly),
      );
      await _pc!.addTransceiver(
        kind: RTCRtpMediaType.RTCRtpMediaTypeAudio,
        init: RTCRtpTransceiverInit(direction: TransceiverDirection.RecvOnly),
      );

      final offer = await _pc!.createOffer({
        'offerToReceiveAudio': true,
        'offerToReceiveVideo': true,
      });
      await _pc!.setLocalDescription(offer);

      final answerSdp = await _exchangeSdp(widget.url, offer.sdp ?? '');
      if (answerSdp == null || answerSdp.trim().isEmpty) {
        throw StateError('No SDP answer from WebRTC endpoint');
      }
      await _pc!.setRemoteDescription(
        RTCSessionDescription(answerSdp, 'answer'),
      );

      if (mounted) setState(() => _loading = false);
    } catch (e) {
      if (mounted) {
        setState(() {
          _loading = false;
          _error = '$e';
        });
        widget.onError?.call('$e');
      }
    }
  }

  Future<String?> _exchangeSdp(String endpoint, String offerSdp) async {
    final uri = Uri.parse(endpoint);
    final headers = <String, String>{
      'Content-Type': 'application/sdp',
      'Accept': 'application/sdp',
      ...widget.httpHeaders,
    };
    final response = await http
        .post(uri, headers: headers, body: offerSdp)
        .timeout(const Duration(seconds: 20));
    if (response.statusCode >= 200 && response.statusCode < 300) {
      return response.body;
    }
    throw StateError('WebRTC signaling HTTP ${response.statusCode}');
  }

  @override
  void dispose() {
    unawaited(_pc?.close());
    unawaited(_renderer.dispose());
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    if (_loading) {
      return const Center(child: CircularProgressIndicator());
    }
    if (_error != null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Text(
            _error!,
            style: const TextStyle(color: Colors.white70),
            textAlign: TextAlign.center,
          ),
        ),
      );
    }
    return OrientationBuilder(
      builder: (context, orientation) {
        return SizedBox.expand(
          child: RTCVideoView(
            _renderer,
            objectFit: orientation == Orientation.landscape
                ? RTCVideoViewObjectFit.RTCVideoViewObjectFitCover
                : RTCVideoViewObjectFit.RTCVideoViewObjectFitContain,
          ),
        );
      },
    );
  }
}
