import 'package:webview_flutter_platform_interface/webview_flutter_platform_interface.dart';
import 'package:webview_flutter_web/webview_flutter_web.dart';

/// Required on Flutter Web: `webview_flutter` has no default [WebViewPlatform] otherwise.
void registerWebViewPlatformForWeb() {
  WebViewPlatform.instance = WebWebViewPlatform();
}
