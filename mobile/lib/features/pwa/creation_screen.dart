import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/navigation.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Creation — reproduction of the web app's "AI Creator" screen.
///
/// Layout matches the web version: the AI Creator title block with Batch Mode /
/// 5-Min Delivery Plan / Brand Active pills, the Image|Video and 1:1·3:4·9:16
/// selectors, the catalog dropdown, the "Auto AI Layout" template card with the
/// Templates Library count, the empty workspace panel, the attached-image strip
/// and the prompt composer.
class CreationScreen extends ConsumerStatefulWidget {
  const CreationScreen({super.key});

  @override
  ConsumerState<CreationScreen> createState() => _CreationScreenState();
}

class _CreationScreenState extends ConsumerState<CreationScreen> {
  int _kind = 0; // 0 = Image, 1 = Video
  int _ratio = 1; // 1:1, 3:4, 9:16
  bool _batch = false;
  String? _productId;
  final TextEditingController _prompt = TextEditingController();

  static const List<String> _kinds = <String>['Image', 'Video'];
  static const List<String> _ratios = <String>['1:1', '3:4', '9:16'];

  @override
  void dispose() {
    _prompt.dispose();
    super.dispose();
  }

  Future<void> _startPrompt(String text) async {
    final String brief = text.trim();
    if (brief.isEmpty) return;
    final SessionsController ctl = ref.read(sessionsProvider.notifier);
    final created = await ctl.create(
      projectId: _productId,
    );
    if (!mounted) return;
    _prompt.clear();
    context.push(
      '${Routes.session(created.id)}?prompt=${Uri.encodeComponent(brief)}'
      '&title=${Uri.encodeComponent(_kinds[_kind])}',
    );
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final List<ProjectSeed> projects =
        ref.watch(projectsProvider).value ?? const <ProjectSeed>[];
    final List<AssetSeed> assets =
        (ref.watch(assetsProvider).value ?? const <AssetSeed>[])
            .take(6)
            .toList(growable: false);

    final ProjectSeed? selected = projects
        .where((ProjectSeed p) => p.id == _productId)
        .firstOrNull;

    return Column(
      children: <Widget>[
        Expanded(
          child: ListView(
            padding: EdgeInsets.zero,
            children: <Widget>[
              Padding(
                padding: const EdgeInsets.fromLTRB(
                  NoboSpace.gutter,
                  NoboSpace.md,
                  NoboSpace.gutter,
                  0,
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    // Title block: "AI Creator" beside the status pills.
                    Row(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: <Widget>[
                        Icon(
                          Icons.auto_awesome,
                          size: 22,
                          color: c.accent,
                        ),
                        const SizedBox(width: NoboSpace.sm),
                        Text(
                          'AI\nCreator',
                          style: NoboType.headline.copyWith(
                            color: c.ink,
                            fontSize: 22,
                            height: 1.05,
                            fontWeight: FontWeight.w800,
                            letterSpacing: -0.5,
                          ),
                        ),
                        const SizedBox(width: NoboSpace.md),
                        Expanded(
                          child: Wrap(
                            spacing: 6,
                            runSpacing: 6,
                            alignment: WrapAlignment.end,
                            children: <Widget>[
                              _StatusPill(
                                label: 'BATCH\nMODE',
                                icon: Icons.bolt_rounded,
                                bg: c.primary,
                                fg: c.onPrimary,
                                active: _batch,
                                onTap: () =>
                                    setState(() => _batch = !_batch),
                              ),
                              _StatusPill(
                                label: '5-MIN\nDELIVERY\nPLAN',
                                bg: c.accentWash,
                                fg: c.accent,
                                active: true,
                              ),
                              _StatusPill(
                                label: 'BRAND\nACTIVE',
                                bg: c.positiveWash,
                                fg: c.positive,
                                active: true,
                                dot: true,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: NoboSpace.base),

                    _Segmented(
                      options: _kinds,
                      index: _kind,
                      onChanged: (int i) => setState(() => _kind = i),
                    ),
                    const SizedBox(height: NoboSpace.sm),
                    _Segmented(
                      options: _ratios,
                      index: _ratio,
                      onChanged: (int i) => setState(() => _ratio = i),
                    ),
                    const SizedBox(height: NoboSpace.sm),
                    PwaSelect(
                      label: 'Select catalog product',
                      value: selected?.title,
                      icon: Icons.inventory_2_outlined,
                      onTap: () => _pickProduct(projects),
                    ),
                    const SizedBox(height: NoboSpace.base),

                    // Template card.
                    PwaCard(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: <Widget>[
                          Row(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: <Widget>[
                              Container(
                                width: 40,
                                height: 40,
                                decoration: BoxDecoration(
                                  color: c.primaryWash,
                                  borderRadius: NoboRadius.rMd,
                                ),
                                child: Icon(
                                  Icons.dashboard_customize_outlined,
                                  size: 20,
                                  color: c.primary,
                                ),
                              ),
                              const SizedBox(width: NoboSpace.md),
                              Expanded(
                                child: Column(
                                  crossAxisAlignment: CrossAxisAlignment.start,
                                  children: <Widget>[
                                    Row(
                                      children: <Widget>[
                                        Container(
                                          padding: const EdgeInsets.symmetric(
                                            horizontal: 6,
                                            vertical: 2,
                                          ),
                                          decoration: BoxDecoration(
                                            color: c.primaryWash,
                                            borderRadius: NoboRadius.rXs,
                                          ),
                                          child: Text(
                                            'AUTO AI',
                                            style: NoboType.micro.copyWith(
                                              color: c.primary,
                                              fontSize: 9,
                                            ),
                                          ),
                                        ),
                                        const SizedBox(width: 6),
                                        Text(
                                          'Design Template',
                                          style: NoboType.caption.copyWith(
                                            color: c.inkTertiary,
                                            fontSize: 11.5,
                                          ),
                                        ),
                                      ],
                                    ),
                                    const SizedBox(height: 4),
                                    Text(
                                      'Auto AI Layout (Balanced Aesthetic)',
                                      style: NoboType.label.copyWith(
                                        color: c.ink,
                                        fontSize: 13.5,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ],
                          ),
                          const SizedBox(height: NoboSpace.md),
                          Align(
                            alignment: Alignment.centerRight,
                            child: GestureDetector(
                              onTap: () {},
                              child: Container(
                                padding: const EdgeInsets.symmetric(
                                  horizontal: NoboSpace.base,
                                  vertical: 9,
                                ),
                                decoration: BoxDecoration(
                                  color: c.primary,
                                  borderRadius: NoboRadius.rPill,
                                ),
                                child: Row(
                                  mainAxisSize: MainAxisSize.min,
                                  children: <Widget>[
                                    Icon(
                                      Icons.grid_view_rounded,
                                      size: 14,
                                      color: c.onPrimary,
                                    ),
                                    const SizedBox(width: 6),
                                    Text(
                                      'Templates Library',
                                      style: NoboType.label.copyWith(
                                        color: c.onPrimary,
                                        fontSize: 12.5,
                                      ),
                                    ),
                                    const SizedBox(width: 6),
                                    Container(
                                      padding: const EdgeInsets.symmetric(
                                        horizontal: 6,
                                        vertical: 1,
                                      ),
                                      decoration: BoxDecoration(
                                        color: Colors.white.withValues(
                                          alpha: 0.24,
                                        ),
                                        borderRadius: NoboRadius.rPill,
                                      ),
                                      child: Text(
                                        '35',
                                        style: NoboType.caption.copyWith(
                                          color: c.onPrimary,
                                          fontSize: 10.5,
                                          fontWeight: FontWeight.w700,
                                        ),
                                      ),
                                    ),
                                  ],
                                ),
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: NoboSpace.xxl),

                    // Empty workspace panel.
                    Center(
                      child: Column(
                        children: <Widget>[
                          Container(
                            width: 64,
                            height: 64,
                            decoration: BoxDecoration(
                              color: c.primaryWash,
                              shape: BoxShape.circle,
                            ),
                            child: Icon(
                              Icons.auto_awesome,
                              size: 28,
                              color: c.primary,
                            ),
                          ),
                          const SizedBox(height: NoboSpace.base),
                          Text(
                            'AI Creator Workspace',
                            style: NoboType.subtitle.copyWith(
                              color: c.ink,
                              fontSize: 18,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Padding(
                            padding: const EdgeInsets.symmetric(
                              horizontal: NoboSpace.lg,
                            ),
                            child: Text(
                              'Configure your presenter model, aspect ratio, '
                              'duration and property assets above. Then type '
                              'your prompt below to start the creative process.',
                              textAlign: TextAlign.center,
                              style: NoboType.caption.copyWith(
                                color: c.inkSecondary,
                                height: 1.5,
                                fontSize: 12.5,
                              ),
                            ),
                          ),
                          const SizedBox(height: NoboSpace.base),
                          GestureDetector(
                            onTap: () => context.go(Routes.nobogent),
                            child: Container(
                              padding: const EdgeInsets.symmetric(
                                horizontal: NoboSpace.lg,
                                vertical: 11,
                              ),
                              decoration: BoxDecoration(
                                color: c.primary,
                                borderRadius: NoboRadius.rPill,
                              ),
                              child: Row(
                                mainAxisSize: MainAxisSize.min,
                                children: <Widget>[
                                  Icon(
                                    Icons.info_outline_rounded,
                                    size: 14,
                                    color: c.onPrimary,
                                  ),
                                  const SizedBox(width: 6),
                                  Text(
                                    'Open Active Chat',
                                    style: NoboType.label.copyWith(
                                      color: c.onPrimary,
                                      fontSize: 13,
                                    ),
                                  ),
                                ],
                              ),
                            ),
                          ),
                        ],
                      ),
                    ),
                    const SizedBox(height: NoboSpace.xxl),

                    if (assets.isNotEmpty) ...<Widget>[
                      PwaLabel('Images sent to image model (${assets.length}/16)'),
                      const SizedBox(height: NoboSpace.sm),
                      SizedBox(
                        height: 66,
                        child: ListView.separated(
                          scrollDirection: Axis.horizontal,
                          padding: EdgeInsets.zero,
                          itemCount: assets.length,
                          separatorBuilder: (_, _) =>
                              const SizedBox(width: NoboSpace.sm),
                          itemBuilder: (BuildContext context, int i) {
                            final AssetSeed a = assets[i];
                            return Stack(
                              children: <Widget>[
                                Container(
                                  width: 58,
                                  height: 58,
                                  decoration: BoxDecoration(
                                    color: c.surface,
                                    borderRadius: NoboRadius.rMd,
                                    border: Border.all(color: c.border),
                                  ),
                                  clipBehavior: Clip.antiAlias,
                                  child: a.preview == null
                                      ? Icon(
                                          Icons.image_outlined,
                                          size: 18,
                                          color: c.inkTertiary,
                                        )
                                      : Image.asset(
                                          a.preview!,
                                          fit: BoxFit.cover,
                                          errorBuilder: (_, _, _) => Icon(
                                            Icons.image_outlined,
                                            size: 18,
                                            color: c.inkTertiary,
                                          ),
                                        ),
                                ),
                                Positioned(
                                  top: -4,
                                  right: -4,
                                  child: Container(
                                    width: 18,
                                    height: 18,
                                    decoration: BoxDecoration(
                                      color: c.danger,
                                      shape: BoxShape.circle,
                                      border: Border.all(
                                        color: c.canvas,
                                        width: 1.5,
                                      ),
                                    ),
                                    child: const Icon(
                                      Icons.close_rounded,
                                      size: 11,
                                      color: Colors.white,
                                    ),
                                  ),
                                ),
                                Positioned(
                                  bottom: 0,
                                  left: 0,
                                  right: 0,
                                  child: Container(
                                    padding: const EdgeInsets.symmetric(
                                      vertical: 2,
                                    ),
                                    decoration: BoxDecoration(
                                      color: c.navy,
                                      borderRadius: const BorderRadius.vertical(
                                        bottom: Radius.circular(NoboRadius.md),
                                      ),
                                    ),
                                    child: Text(
                                      'LOGO',
                                      textAlign: TextAlign.center,
                                      style: NoboType.caption.copyWith(
                                        color: c.onNavy,
                                        fontSize: 8,
                                        fontWeight: FontWeight.w700,
                                      ),
                                    ),
                                  ),
                                ),
                              ],
                            );
                          },
                        ),
                      ),
                    ],
                    const SizedBox(height: NoboSpace.xxl),
                  ],
                ),
              ),
            ],
          ),
        ),

        // Composer.
        Container(
          decoration: BoxDecoration(
            color: c.surface,
            border: Border(top: BorderSide(color: c.border)),
          ),
          padding: EdgeInsets.fromLTRB(
            NoboSpace.gutter,
            NoboSpace.md,
            NoboSpace.gutter,
            NoboSpace.md + MediaQuery.viewInsetsOf(context).bottom,
          ),
          child: Row(
            children: <Widget>[
              PwaIconCircle(
                icon: Icons.upload_rounded,
                filled: false,
                onTap: () {},
                tooltip: 'Upload',
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.image_outlined,
                filled: false,
                onTap: () {},
                tooltip: 'Gallery',
              ),
              const SizedBox(width: NoboSpace.sm),
              Expanded(
                child: Container(
                  decoration: BoxDecoration(
                    color: c.surface,
                    borderRadius: NoboRadius.rPill,
                    border: Border.all(color: c.border),
                  ),
                  padding: const EdgeInsets.symmetric(
                    horizontal: NoboSpace.base,
                    vertical: 2,
                  ),
                  child: TextField(
                    controller: _prompt,
                    maxLines: 1,
                    style: NoboType.body.copyWith(color: c.ink, fontSize: 14.5),
                    cursorColor: c.primary,
                    onSubmitted: _startPrompt,
                    decoration: InputDecoration(
                      isDense: true,
                      filled: false,
                      border: InputBorder.none,
                      enabledBorder: InputBorder.none,
                      focusedBorder: InputBorder.none,
                      contentPadding: const EdgeInsets.symmetric(vertical: 11),
                      hintText: 'Describe what to generate…',
                      hintStyle: NoboType.body.copyWith(
                        color: c.inkTertiary,
                        fontSize: 14.5,
                      ),
                    ),
                  ),
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              PwaIconCircle(
                icon: Icons.send_rounded,
                tint: c.primary,
                onTap: () => _startPrompt(_prompt.text),
                tooltip: 'Generate',
              ),
            ],
          ),
        ),
      ],
    );
  }

  Future<void> _pickProduct(List<ProjectSeed> projects) async {
    await showModalBottomSheet<void>(
      context: context,
      backgroundColor: context.nobo.surface,
      shape: const RoundedRectangleBorder(
        borderRadius: NoboRadius.rSheetTop,
      ),
      builder: (BuildContext ctx) => SafeArea(
        top: false,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            const SizedBox(height: NoboSpace.base),
            PwaLabel('Select catalog product'),
            const SizedBox(height: NoboSpace.sm),
            for (final ProjectSeed p in projects)
              ListTile(
                leading: const Icon(Icons.inventory_2_outlined, size: 20),
                title: Text(p.title),
                onTap: () {
                  setState(() => _productId = p.id);
                  Navigator.of(ctx).pop();
                },
              ),
            const SizedBox(height: NoboSpace.sm),
          ],
        ),
      ),
    );
  }
}

/// The web app's two-option segmented control: white pill on a light track.
class _Segmented extends StatelessWidget {
  const _Segmented({
    required this.options,
    required this.index,
    required this.onChanged,
  });

  final List<String> options;
  final int index;
  final ValueChanged<int> onChanged;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Container(
      height: 44,
      padding: const EdgeInsets.all(3),
      decoration: BoxDecoration(
        color: c.surfaceSunken,
        borderRadius: NoboRadius.rPill,
      ),
      child: Row(
        children: <Widget>[
          for (int i = 0; i < options.length; i++)
            Expanded(
              child: GestureDetector(
                onTap: () => onChanged(i),
                behavior: HitTestBehavior.opaque,
                child: AnimatedContainer(
                  duration: NoboMotion.fast,
                  curve: NoboMotion.standard,
                  decoration: BoxDecoration(
                    color: i == index ? c.surface : Colors.transparent,
                    borderRadius: NoboRadius.rPill,
                    boxShadow: i == index ? NoboElevation.low : null,
                  ),
                  alignment: Alignment.center,
                  child: Text(
                    options[i],
                    style: NoboType.label.copyWith(
                      fontSize: 13.5,
                      color: i == index ? c.ink : c.inkSecondary,
                      fontWeight: i == index
                          ? FontWeight.w700
                          : FontWeight.w500,
                    ),
                  ),
                ),
              ),
            ),
        ],
      ),
    );
  }
}

class _StatusPill extends StatelessWidget {
  const _StatusPill({
    required this.label,
    required this.bg,
    required this.fg,
    this.icon,
    this.active = false,
    this.dot = false,
    this.onTap,
  });

  final String label;
  final Color bg;
  final Color fg;
  final IconData? icon;
  final bool active;
  final bool dot;
  final VoidCallback? onTap;

  @override
  Widget build(BuildContext context) {
    return GestureDetector(
      onTap: onTap,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 9, vertical: 6),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: NoboRadius.rPill,
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: <Widget>[
            if (dot)
              Container(
                width: 5,
                height: 5,
                margin: const EdgeInsets.only(right: 5),
                decoration: BoxDecoration(color: fg, shape: BoxShape.circle),
              )
            else if (icon != null) ...<Widget>[
              Icon(icon, size: 11, color: fg),
              const SizedBox(width: 4),
            ],
            Text(
              label,
              style: NoboType.micro.copyWith(
                color: fg,
                fontSize: 8.5,
                height: 1.15,
                letterSpacing: 0.3,
                fontWeight: FontWeight.w700,
              ),
            ),
          ],
        ),
      ),
    );
  }
}
