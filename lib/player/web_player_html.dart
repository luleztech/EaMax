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
    required Map<String, String> licenseHeaders,
  }) {
    final clearKeys = WebDrmUtils.parseClearKeys(clearKeyRaw);
    final hasClearKeys = clearKeys != null && clearKeys.isNotEmpty;
    final servers = <String, String>{};
    final dt = drmType.toUpperCase().replaceAll(RegExp(r'[\s\-]+'), '_');
    // ClearKey keys alone are enough — do not also attach Widevine servers
    // (Shaka then probes WV first → intermittent Android WebView 6001).
    if (!hasClearKeys && licenseUrl.isNotEmpty) {
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
    } else if (hasClearKeys &&
        licenseUrl.isNotEmpty &&
        (dt == 'CLEARKEY' || dt == 'CLEAR_KEY')) {
      servers['org.w3.clearkey'] = licenseUrl;
    }
    return {
      'clearKeys': clearKeys ?? {},
      'servers': servers,
      'licenseHeaders': licenseHeaders,
      'preferClearKey': hasClearKeys,
      'widevineLicense': (!hasClearKeys && licenseUrl.isNotEmpty) ? licenseUrl : '',
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
    Map<String, String> licenseHeaders = const {},
  }) {
    final urlJs = _jsString(url);
    final headersJs = _jsString(headers);
    // License-only headers (nv-authorizations). Prefer relay URL when CORS blocks custom headers.
    final licHdrs = Map<String, String>.from(licenseHeaders);
    if (licHdrs.isEmpty) {
      headers.forEach((k, v) {
        if (k.toLowerCase() == 'nv-authorizations') licHdrs[k] = v;
      });
    }
    final drmJs = _jsString(_drmJs(
      drmType: drmType,
      licenseUrl: licenseUrl,
      clearKeyRaw: clearKeyRaw,
      licenseHeaders: licHdrs,
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
  var drmModes=['clearkey','soft','l3','empty'];
  var drmIdx=0;
  var active=null;
  function rob(mode){
    if(mode==='l3') return ['SW_SECURE_CRYPTO',''];
    if(mode==='empty') return [''];
    return ['','SW_SECURE_CRYPTO'];
  }
  function buildDrm(mode){
    var hasCk=drm.clearKeys&&Object.keys(drm.clearKeys).length;
    if(mode==='clearkey'){
      if(!hasCk) return null;
      return {
        preferredKeySystems:['org.w3.clearkey'],
        clearKeys:drm.clearKeys,
        retryParameters:{maxAttempts:3,baseDelay:600,backoffFactor:2,fuzzFactor:0.5,timeout:15000}
      };
    }
    var r=rob(mode);
    var cfg={
      preferredKeySystems:['com.widevine.alpha'],
      defaultAudioRobustnessForWidevine:r[0]||'',
      defaultVideoRobustnessForWidevine:r[0]||'',
      advanced:{'com.widevine.alpha':{
        videoRobustness:r,audioRobustness:r,
        distinctiveIdentifierRequired:false,persistentStateRequired:false
      }},
      retryParameters:{maxAttempts:3,baseDelay:600,backoffFactor:2,fuzzFactor:0.5,timeout:15000}
    };
    if(drm.servers&&Object.keys(drm.servers).length) cfg.servers=drm.servers;
    return cfg;
  }
  function nextMode(){
    while(++drmIdx<drmModes.length){
      var m=drmModes[drmIdx];
      if(m==='clearkey'&&!(drm.clearKeys&&Object.keys(drm.clearKeys).length)) continue;
      if(m!=='clearkey'&&!(drm.servers&&Object.keys(drm.servers).length)) continue;
      return m;
    }
    return null;
  }
  function destroy(){ try{ if(active) active.destroy(); }catch(e){} active=null; }
  function start(mode){
    var drmCfg=buildDrm(mode);
    if(!drmCfg){
      var n=nextMode();
      if(n){ start(n); return; }
      // No DRM needed (clear stream).
      drmCfg={};
    }
    var player=new shaka.Player(v);
    active=player;
    player.getNetworkingEngine().registerRequestFilter(function(type,req){
      req.allowCrossSiteCredentials=true;
      Object.keys(headers||{}).forEach(function(k){
        if(headers[k]==null) return;
        if(String(k).toLowerCase()==='nv-authorizations') return;
        req.headers[k]=String(headers[k]);
      });
      if(type===shaka.net.NetworkingEngine.RequestType.MANIFEST){
        req.headers['Accept']=req.headers['Accept']||'application/dash+xml,application/vnd.apple.mpegurl,*/*';
      }
      if(type===shaka.net.NetworkingEngine.RequestType.LICENSE&&drm.licenseHeaders){
        Object.keys(drm.licenseHeaders).forEach(function(k){
          if(drm.licenseHeaders[k]!=null) req.headers[k]=String(drm.licenseHeaders[k]);
        });
      }
    });
    player.configure({
      streaming:{bufferingGoal:8,rebufferingGoal:1.5,retryParameters:{maxAttempts:5,baseDelay:600,timeout:20000}},
      drm:drmCfg,
      abr:{enabled:true,restrictions:{maxHeight:maxH,maxWidth:maxW}}
    });
    function retryOrFail(code){
      if(code===6001||code===4012||code===6007){
        var n=nextMode();
        if(n){ destroy(); start(n); return; }
      }
      fail(true);
    }
    player.addEventListener('error',function(ev){
      retryOrFail(ev&&ev.detail&&ev.detail.code);
    });
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
    }).catch(function(e){ retryOrFail(e&&e.code); });
  }
  waitShaka(function(ok){
    if(!ok){ fail(true); return; }
    shaka.polyfill.installAll();
    var hasCk=drm.clearKeys&&Object.keys(drm.clearKeys).length;
    var hasSrv=drm.servers&&Object.keys(drm.servers).length;
    if(!hasCk&&!hasSrv){
      // Clear / progressive — do not probe Widevine (that alone can 6001).
      drmIdx=drmModes.length;
      var player=new shaka.Player(v);
      active=player;
      player.getNetworkingEngine().registerRequestFilter(function(type,req){
        req.allowCrossSiteCredentials=true;
        Object.keys(headers||{}).forEach(function(k){
          if(headers[k]==null) return;
          if(String(k).toLowerCase()==='nv-authorizations') return;
          req.headers[k]=String(headers[k]);
        });
      });
      player.configure({
        streaming:{bufferingGoal:8,rebufferingGoal:1.5,retryParameters:{maxAttempts:5,baseDelay:600,timeout:20000}},
        abr:{enabled:true,restrictions:{maxHeight:maxH,maxWidth:maxW}}
      });
      player.addEventListener('error',function(){ fail(true); });
      v.addEventListener('playing', ready);
      player.load(url).then(ready).catch(function(){ fail(true); });
      return;
    }
    var first=hasCk?'clearkey':'soft';
    drmIdx=drmModes.indexOf(first);
    if(drmIdx<0) drmIdx=0;
    start(first);
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
    Map<String, String> licenseHeaders = const {},
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
        licenseHeaders: licenseHeaders,
      );

  /// DASH — Shaka Player.
  static String dash(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
    Map<String, String> licenseHeaders = const {},
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
        licenseHeaders: licenseHeaders,
      );

  /// Unknown format — Shaka auto-detects HLS vs DASH.
  static String adaptive(
    String url,
    Map<String, String> headers, {
    int maxHeight = 360,
    String drmType = 'NONE',
    String licenseUrl = '',
    String clearKeyRaw = '',
    Map<String, String> licenseHeaders = const {},
  }) =>
      shaka(
        url,
        headers,
        maxHeight: maxHeight,
        drmType: drmType,
        licenseUrl: licenseUrl,
        clearKeyRaw: clearKeyRaw,
        licenseHeaders: licenseHeaders,
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
