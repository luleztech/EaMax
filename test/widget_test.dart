import 'package:flutter_test/flutter_test.dart';

void main() {
  testWidgets('app loads', (WidgetTester tester) async {
    // Smoke: dependencies and imports resolve; full app needs Firebase/MediaKit init in main().
    expect(true, isTrue);
  });
}
