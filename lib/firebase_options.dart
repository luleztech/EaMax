// Generated from android/app/google-services.json (EaMax Firebase project)
import 'package:firebase_core/firebase_core.dart' show FirebaseOptions;
import 'package:flutter/foundation.dart' show defaultTargetPlatform, kIsWeb, TargetPlatform;

class DefaultFirebaseOptions {
  static FirebaseOptions get currentPlatform {
    if (kIsWeb) {
      throw UnsupportedError('Web is not configured for this app.');
    }
    switch (defaultTargetPlatform) {
      case TargetPlatform.android:
        return android;
      case TargetPlatform.iOS:
        throw UnsupportedError('Add iOS Firebase config when building for iOS.');
      default:
        throw UnsupportedError('Unsupported platform.');
    }
  }

  static const FirebaseOptions android = FirebaseOptions(
    apiKey: 'AIzaSyCsw0MRemneORCfpmN241biVRvoCntCx4o',
    appId: '1:485407618160:android:6ca2cc94510fc58b28b0b5',
    messagingSenderId: '485407618160',
    projectId: 'eamax-48771',
    storageBucket: 'eamax-48771.firebasestorage.app',
  );
}
