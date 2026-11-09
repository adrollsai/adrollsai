import 'package:flutter/cupertino.dart';
import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/platform/nobo_platform.dart';
import 'package:nobogent_mobile/core/ui/navigation.dart';
import 'package:nobogent_mobile/features/create/create_screen.dart';
import 'package:nobogent_mobile/features/crm/crm_screen.dart';
import 'package:nobogent_mobile/features/home/home_screen.dart';
import 'package:nobogent_mobile/features/inbox/inbox_screen.dart';
import 'package:nobogent_mobile/features/projects/projects_screen.dart';

import '../helpers/pump_app.dart';

/// Every primary screen must lay out cleanly on every supported device size, on
/// both platforms, in both themes, and at increased Dynamic Type — with no
/// RenderFlex overflow and no clipping exception.
///
/// This is the automated counterpart to the screenshot review: screenshots show
/// what one device looks like, these catch the sizes and text scales nobody
/// opened by hand.
void main() {
  final List<({String name, Widget Function() build})> screens =
      <({String name, Widget Function() build})>[
        (name: 'Home', build: HomeScreen.new),
        (name: 'Create', build: CreateScreen.new),
        (name: 'Projects', build: ProjectsScreen.new),
        (name: 'Inbox', build: InboxScreen.new),
        (name: 'Business/CRM', build: CrmScreen.new),
      ];

  for (final ({String name, Widget Function() build}) screen in screens) {
    group('${screen.name} screen', () {
      noboTestWidgets('renders on every Android size', (WidgetTester tester) async {
        for (final Size size in Devices.android) {
          await pumpNobo(
            tester,
            screen.build(),
            size: size,
            platform: NoboPlatformKind.android,
          );
          expectNoLayoutError(tester);
        }
      });

      noboTestWidgets('renders on every iPhone size', (WidgetTester tester) async {
        for (final Size size in Devices.ios) {
          await pumpNobo(
            tester,
            screen.build(),
            size: size,
            platform: NoboPlatformKind.ios,
          );
          expectNoLayoutError(tester);
        }
      });

      noboTestWidgets('renders in dark mode', (WidgetTester tester) async {
        await pumpNobo(
          tester,
          screen.build(),
          brightness: Brightness.dark,
          platform: NoboPlatformKind.android,
        );
        expectNoLayoutError(tester);
      });

      noboTestWidgets('survives 1.3x Dynamic Type on the smallest device', (
        WidgetTester tester,
      ) async {
        await pumpNobo(
          tester,
          screen.build(),
          size: Devices.iphoneSmall,
          platform: NoboPlatformKind.ios,
          textScale: 1.3,
        );
        expectNoLayoutError(tester);
      });
    });
  }

  group('platform-specific navigation chrome', () {
    noboTestWidgets('Android uses a Material NavigationBar', (
      WidgetTester tester,
    ) async {
      await pumpNobo(
        tester,
        Scaffold(
          body: const SizedBox.shrink(),
          bottomNavigationBar: AndroidNavBar(
            currentIndex: 0,
            onSelected: (_) {},
            badges: const <int, int>{3: 2},
          ),
        ),
        platform: NoboPlatformKind.android,
      );
      expectNoLayoutError(tester);
      expect(find.byType(NavigationBar), findsOneWidget);
      expect(find.byType(CupertinoTabBar), findsNothing);
    });

    noboTestWidgets('iOS uses a CupertinoTabBar instead', (
      WidgetTester tester,
    ) async {
      await pumpNobo(
        tester,
        Scaffold(
          body: const SizedBox.shrink(),
          bottomNavigationBar: IosTabBar(
            currentIndex: 0,
            onSelected: (_) {},
            badges: const <int, int>{3: 2},
          ),
        ),
        platform: NoboPlatformKind.ios,
      );
      expectNoLayoutError(tester);
      expect(find.byType(CupertinoTabBar), findsOneWidget);
      expect(find.byType(NavigationBar), findsNothing);
    });

    noboTestWidgets('both bars expose the same five destinations', (
      WidgetTester tester,
    ) async {
      expect(noboDestinations.length, 5);
      expect(
        noboDestinations.map((NoboDestination d) => d.label),
        <String>['Home', 'Create', 'Projects', 'Inbox', 'Business'],
      );
    });
  });
}
