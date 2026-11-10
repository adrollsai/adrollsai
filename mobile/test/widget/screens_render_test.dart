import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:nobogent_mobile/core/platform/nobo_platform.dart';
import 'package:nobogent_mobile/core/ui/navigation.dart';
import 'package:nobogent_mobile/features/pwa/agent_screen.dart';
import 'package:nobogent_mobile/features/crm/crm_screen.dart';
import 'package:nobogent_mobile/features/pwa/analytics_screen.dart';
import 'package:nobogent_mobile/features/pwa/ads_screen.dart';
import 'package:nobogent_mobile/features/pwa/assets_screen.dart';
import 'package:nobogent_mobile/features/pwa/gbp_screens.dart';
import 'package:nobogent_mobile/features/pwa/catalog_screen.dart';
import 'package:nobogent_mobile/features/pwa/creation_screen.dart';
import 'package:nobogent_mobile/features/pwa/notifications_screen.dart';
import 'package:nobogent_mobile/features/pwa/whatsapp_screen.dart';

import '../helpers/pump_app.dart';

/// Every primary screen must lay out cleanly on every supported device size, on
/// both platforms, in both themes, and at increased Dynamic Type — with no
/// RenderFlex overflow and no clipping exception.
void main() {
  final List<({String name, Widget Function() build})> screens =
      <({String name, Widget Function() build})>[
        (name: 'Analytics', build: AnalyticsScreen.new),
        (name: 'Catalog', build: CatalogScreen.new),
        (name: 'Assets', build: AssetsScreen.new),
        (name: 'Business/CRM', build: CrmScreen.new),
        (name: 'Creation', build: CreationScreen.new),
        (name: 'Nobogent', build: AgentScreen.new),
        (name: 'Notifications', build: NotificationsScreen.new),
        (name: 'Ads', build: AdsScreen.new),
        (name: 'WhatsApp', build: WhatsAppScreen.new),
        (name: 'GBP Suite', build: GbpScreen.new),
        (name: 'GBP Audit', build: GbpAuditScreen.new),
      ];

  for (final ({String name, Widget Function() build}) screen in screens) {
    group('${screen.name} screen', () {
      noboTestWidgets('renders on every Android size', (
        WidgetTester tester,
      ) async {
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

      noboTestWidgets('renders on every iPhone size', (
        WidgetTester tester,
      ) async {
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

  group('navigation', () {
    noboTestWidgets('exposes the web app eleven destinations in order', (
      WidgetTester tester,
    ) async {
      expect(noboDestinations.length, 11);
      expect(
        noboDestinations.map((NoboDestination d) => d.label).toList(),
        <String>[
          'Analytics',
          'Nobogent',
          'Catalog',
          'Creation',
          'Ads',
          'CRM',
          'WhatsApp',
          'GBP Suite',
          'GBP Audit',
          'Assets',
          'Profile',
        ],
      );
    });

    noboTestWidgets('renders the scrollable bottom bar', (
      WidgetTester tester,
    ) async {
      await pumpNobo(
        tester,
        Scaffold(
          body: const SizedBox.shrink(),
          bottomNavigationBar: NoboBottomNav(
            currentIndex: 2,
            onSelected: (_) {},
          ),
        ),
        platform: NoboPlatformKind.android,
      );
      expectNoLayoutError(tester);
      expect(find.text('Catalog'), findsOneWidget);
    });
  });
}
