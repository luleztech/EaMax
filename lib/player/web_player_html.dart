import 'dart:convert';

import 'web_drm_utils.dart';

/// Shaka Player 4.11.4 — unified web player for HLS, DASH, and live streams.
class WebPlayerHtml {
  static const _userError = '';

  static const _shakaCdn =
      'https://cdn.jsdelivr.net/npm/shaka-player@4.11.4/dist/shaka-player.compiled.js';
  static const _shakaCdnFallback =
      'https://cdnjs.cloudflare.com/ajax/libs/shaka-player/4.11.4/shaka-player.compiled.min.js';
  static const _muxCdn =
      'https://cdn.jsdelivr.net/npm/mux.js@6.3.0/dist/mux.js';

  static const _shellCss = '''
*{margin:0;padding:0;box-sizing:border-box}
html,body{background:#000;height:100%;width:100%;overflow:hidden}
video{width:100%;height:100%;background:#000;object-fit:contain;display:block}
@media (orientation:landscape){
  video{object-fit:cover}
}
video::-webkit-media-controls-enclosure{display:none!important}
video::-webkit-media-controls{display:none!important}
video::-webkit-media-controls-panel{display:none!important}
video::-webkit-media-controls-mute-button{display:none!important}
video::-webkit-media-controls-fullscreen-button{display:none!important}
video::-webkit-media-controls-overflow-button{display:none!important}
video::-webkit-media-controls-timeline{display:none!important}
video::-webkit-media-controls-current-time-display,
video::-webkit-media-controls-time-remaining-display,
video::-webkit-media-controls-duration-display,
video::-webkit-media-controls-timeline{display:none!important}
.shaka-controls-container,.shaka-bottom-controls,.shaka-overflow-menu,
.shaka-overflow-menu-button,.shaka-fullscreen-button,.vjs-control-bar,
.jw-controlbar,.plyr__controls{display:none!important;pointer-events:none!important}
#err{display:none;position:fixed;inset:0;align-items:center;justify-content:center;
     color:#fff;font:15px/1.5 system-ui,sans-serif;text-align:center;padding:24px}
#err.show{display:flex}
#spin{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:#000;color:#666;font:14px system-ui,sans-serif}
''';

  static String _jsString(dynamic value) => jsonEncode(value);

  static Map<String, dynamic> _drmJs({
    required String drmType,
    required String licenseUrl,
    required String clearKeyRaw,
    required Map<String, String> headers,
  }) {
    final clearKeys = WebDrmUtils.parseClearKeys(clearKeyRaw);
    final servers = <String, String>{};
    if (licenseUrl.isNotEmpty) {
      final dt = drmType.toUpperCase().replaceAll(RegExp(r'[\s\-]+'), '_');
      if (dt == 'PLAYREADY') {
        servers['com.microsoft.playready'] = licenseUrl;
      } else if (dt.startsWith('WIDEVINE')) {
        servers['com.widevine.alpha'] = licenseUrl;
      } else if (dt == 'CLEARKEY' || dt == 'CLEAR_KEY') {
        servers['org.w3.clearkey'] = licenseUrl;
      } else if (licenseUrl.toLowerCase().contains('playready')) {
        servers['com.microsoft.playready'] = licenseUrl;
      } else {
        servers['com.widevine.alpha'] = licenseUrl;
      }
    }
    return {
      'clearKeys': clearKeys ?? {},
      'servers': servers,
      'licenseHeaders': headers,
    };
  }

  static int _widthForHeight(int h) {
    if (h >= 1080) return 1920;
    if (h >= 720) return 1280;
    if (h >= 480) return 854;
    if (h >= 360) return 640;
    return 426;
  }

  /// Shaka Player — HLS (.m3u8), DASH (.mpd), and adaptive live URLs.
  static String shaka(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
  }) {
    final urlJs = _jsString(url);
    final headersJs = _jsString(headers);
    final drmJs = _jsString(_drmJs(
      drmType: drmType,
      licenseUrl: licenseUrl,
      clearKeyRaw: clearKeyRaw,
      headers: headers,
    ));
    final maxW = _widthForHeight(maxHeight);
    return '''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>$_shellCss</style>
<script src="$_muxCdn"></script>
<script id="shaka-script" src="$_shakaCdn" onerror="(function(){var s=document.createElement('script');s.src='$_shakaCdnFallback';document.head.appendChild(s);})();"></script>
</head><body>
<div id="spin">Connecting…</div>
<video id="v" autoplay playsinline webkit-playsinline></video>
<div id="err"></div>
<script>
(function(){
  var url=$urlJs, headers=$headersJs, drm=$drmJs, maxH=$maxHeight, maxW=$maxW;
  var v=document.getElementById('v'), spin=document.getElementById('spin'), err=document.getElementById('err');
  function fail(fatal){
    spin.style.display='none';
    err.textContent=${_jsString(_userError)};
    err.className='show';
    if(fatal) try{ parent.postMessage(JSON.stringify({type:'eamax-player-error',fatal:true}),'*'); }catch(e){}
  }
  function ready(){ spin.style.display='none'; err.className=''; v.play().catch(function(){}); }
  function waitShaka(cb){ var n=0;(function t(){ if(typeof shaka!=='undefined'){ cb(true); return; } if(++n>50){ cb(false); return; } setTimeout(t,120); })(); }
  waitShaka(function(ok){
    if(!ok){ fail(true); return; }
    shaka.polyfill.installAll();
    var player=new shaka.Player(v);
    player.getNetworkingEngine().registerRequestFilter(function(type,req){
      req.allowCrossSiteCredentials=true;
      Object.keys(headers||{}).forEach(function(k){ if(headers[k]!=null) req.headers[k]=String(headers[k]); });
      if(type===shaka.net.NetworkingEngine.RequestType.MANIFEST){
        req.headers['Accept']=req.headers['Accept']||'application/dash+xml,application/vnd.apple.mpegurl,*/*';
      }
      if(type===shaka.net.NetworkingEngine.RequestType.LICENSE&&drm.licenseHeaders){
        Object.keys(drm.licenseHeaders).forEach(function(k){
          if(drm.licenseHeaders[k]!=null) req.headers[k]=String(drm.licenseHeaders[k]);
        });
      }
    });
    var drmCfg={};
    if(drm.clearKeys&&Object.keys(drm.clearKeys).length) drmCfg.clearKeys=drm.clearKeys;
    if(drm.servers&&Object.keys(drm.servers).length) drmCfg.servers=drm.servers;
    player.configure({
      streaming:{bufferingGoal:20,rebufferingGoal:3,retryParameters:{maxAttempts:5,baseDelay:1000,timeout:30000}},
      drm:drmCfg,
      abr:{enabled:true,restrictions:{maxHeight:maxH,maxWidth:maxW}}
    });
    player.addEventListener('error',function(){ fail(true); });
    v.addEventListener('playing', ready);
    player.load(url).then(function(){
      try{
        var tracks=player.getVariantTracks();
        if(tracks&&tracks.length){
          var best=tracks[0],bestH=tracks[0].height||0;
          for(var i=0;i<tracks.length;i++){
            var h=tracks[i].height||0;
            if(h>0&&h<=maxH&&h>=bestH){ best=tracks[i]; bestH=h; }
          }
          if(best) player.selectVariantTrack(best,false,0);
        }
      }catch(e){}
      ready();
    }).catch(function(){ fail(true); });
  });
})();
</script></body></html>''';
  }

  /// HLS — Shaka Player (native HLS support).
  static String hls(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
      );

  /// DASH — Shaka Player.
  static String dash(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
      );

  /// Unknown format — Shaka auto-detects HLS vs DASH.
  static String adaptive(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
      );

  /// Progressive file (mp4, webm) — Shaka or native video.
  static String progressive(String url) {
    final urlJs = _jsString(url);
    return '''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>$_shellCss</style>
<script src="$_shakaCdn"></script>
</head><body>
<div id="spin">Connecting…</div>
<video id="v" autoplay playsinline webkit-playsinline></video>
<div id="err"></div>
<script>
(function(){
  var url=$urlJs;
  var v=document.getElementById('v'), spin=document.getElementById('spin'), err=document.getElementById('err');
  function fail(){
    spin.style.display='none';
    err.textContent=${_jsString(_userError)};
    err.className='show';
    try{ parent.postMessage(JSON.stringify({type:'eamax-player-error',fatal:true}),'*'); }catch(e){}
  }
  function ready(){ spin.style.display='none'; err.className=''; v.play().catch(function(){}); }
  function tryNative(){ v.src=url; v.onplaying=ready; v.onerror=function(){ tryShaka(); }; v.play().catch(function(){ tryShaka(); }); }
  function tryShaka(){
    if(typeof shaka==='undefined'){ fail(); return; }
    shaka.polyfill.installAll();
    var p=new shaka.Player(v);
    p.load(url).then(ready).catch(fail);
  }
  tryNative();
})();
</script></body></html>''';
  }

  /// Last-resort: hidden gateway iframe (only when stream URL could not be extracted).
  static String gatewayEmbed(String gatewayUrl) {
    final urlJs = _jsString(gatewayUrl);
    return '''<!DOCTYPE html>
<html><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
<style>
html,body{margin:0;padding:0;background:#000;height:100%;overflow:hidden}
#spin{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;
      background:#000;color:#666;font:14px system-ui,sans-serif;z-index:2}
#gw{position:fixed;inset:0;width:100%;height:100%;border:0;background:#000;opacity:0}
</style></head><body>
<div id="spin">Connecting…</div>
<iframe id="gw" allow="autoplay;encrypted-media;fullscreen"></iframe>
<script>
(function(){
  var gw=document.getElementById('gw'), spin=document.getElementById('spin');
  gw.src=$urlJs;
  var videoReady=false;
  function showVideo(doc){
    try{
      if(!doc||!doc.head) return;
      if(!doc.getElementById('__eaMaxGwStyle')){
        var css='html,body{background:#000!important;overflow:hidden!important}'+
          'video,.shaka-video-container{position:fixed!important;inset:0!important;width:100%!important;height:100%!important;object-fit:contain!important;z-index:99999!important}'+
          '@media (orientation:landscape){video,.shaka-video-container{object-fit:cover!important}}';
        var s=doc.createElement('style'); s.id='__eaMaxGwStyle'; s.textContent=css; doc.head.appendChild(s);
      }
      var v=doc.querySelector('video');
      if(v){
        gw.style.opacity='1'; spin.style.display='none';
        if(!videoReady){
          videoReady=true;
          v.setAttribute('playsinline',''); v.setAttribute('webkit-playsinline','');
          v.play().catch(function(){});
        }
      }
    }catch(e){}
  }
  gw.onload=function(){ try{ showVideo(gw.contentDocument); }catch(e){} };
  try{
    var obs=new MutationObserver(function(){ try{ showVideo(gw.contentDocument); }catch(e){} });
    gw.addEventListener('load',function(){
      try{ obs.observe(gw.contentDocument.documentElement,{childList:true,subtree:true}); }catch(e){}
    });
  }catch(e){}
  setTimeout(function(){ spin.style.display='none'; gw.style.opacity='1'; }, 15000);
})();
</script></body></html>''';
  }
}
