import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../data/repositories/auth_repository.dart';
import '../../data/workspace_source.dart';
import 'pwa_widgets.dart';

/// Create/edit form for a catalog product.
///
/// Writes to the `properties` table through the same repository the rest of the
/// app uses. Returns `true` when something was saved so the caller can refresh.
Future<bool?> showProductFormSheet({
  required BuildContext context,
  ProjectSeed? existing,
}) {
  return showNoboSheet<bool>(
    context: context,
    builder: (BuildContext ctx) =>
        _ProductFormSheet(existing: existing),
  );
}

class _ProductFormSheet extends ConsumerStatefulWidget {
  const _ProductFormSheet({this.existing});

  final ProjectSeed? existing;

  @override
  ConsumerState<_ProductFormSheet> createState() => _ProductFormSheetState();
}

class _ProductFormSheetState extends ConsumerState<_ProductFormSheet> {
  late final TextEditingController _title = TextEditingController(
    text: widget.existing?.title ?? '',
  );
  late final TextEditingController _address = TextEditingController(
    text: widget.existing?.address ?? '',
  );
  late final TextEditingController _price = TextEditingController(
    text: _initialPrice(),
  );
  late final TextEditingController _type = TextEditingController(
    text: widget.existing?.type ?? '',
  );
  late final TextEditingController _description = TextEditingController(
    text: widget.existing?.description ?? '',
  );
  late final TextEditingController _image = TextEditingController(
    text: widget.existing?.cover ?? '',
  );

  bool _saving = false;
  String? _error;

  /// `price` is stored as text; show only the numeric part back to the editor.
  String _initialPrice() {
    final String raw = widget.existing?.price ?? '';
    final String digits = raw.replaceAll(RegExp(r'[^0-9.]'), '');
    return digits;
  }

  @override
  void dispose() {
    _title.dispose();
    _address.dispose();
    _price.dispose();
    _type.dispose();
    _description.dispose();
    _image.dispose();
    super.dispose();
  }

  Future<void> _save() async {
    final String title = _title.text.trim();
    if (title.isEmpty) {
      setState(() => _error = 'A product name is required.');
      return;
    }
    setState(() {
      _saving = true;
      _error = null;
    });

    final num? price = num.tryParse(_price.text.trim());
    final String? image = _image.text.trim().isEmpty
        ? null
        : _image.text.trim();

    try {
      final repo = ref.read(workspaceRepositoryProvider);
      final ProjectSeed? existing = widget.existing;
      if (existing == null) {
        await repo.createProject(
          title: title,
          address: _address.text,
          price: price,
          description: _description.text,
          propertyType: _type.text,
          imageUrl: image,
        );
      } else {
        await repo.updateProject(
          existing.id,
          title: title,
          address: _address.text,
          price: price,
          description: _description.text,
          propertyType: _type.text,
          imageUrl: image,
        );
      }
      if (!mounted) return;
      Navigator.of(context).pop(true);
    } on NoboFailure catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _saving = false;
      });
    }
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool editing = widget.existing != null;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.xs,
        NoboSpace.gutter,
        NoboSpace.lg + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: <Widget>[
            Row(
              children: <Widget>[
                Expanded(
                  child: Text(
                    editing ? 'Edit product' : 'Add product',
                    style: NoboType.subtitle.copyWith(
                      color: c.ink,
                      fontSize: 18,
                      fontWeight: FontWeight.w700,
                    ),
                  ),
                ),
                IconButton(
                  onPressed: () => Navigator.of(context).pop(false),
                  icon: Icon(Icons.close_rounded, color: c.inkSecondary),
                  tooltip: 'Close',
                ),
              ],
            ),
            const SizedBox(height: NoboSpace.sm),
            _Field(
              label: 'Product name',
              controller: _title,
              hint: 'Bluesquare Infra — Sector 82',
              required: true,
              textCapitalization: TextCapitalization.words,
            ),
            _Field(
              label: 'Location',
              controller: _address,
              hint: 'Sector 82, Mohali',
              textCapitalization: TextCapitalization.words,
            ),
            _Field(
              label: 'Price',
              controller: _price,
              hint: '8650000',
              keyboardType: TextInputType.number,
              inputFormatters: <TextInputFormatter>[
                FilteringTextInputFormatter.allow(RegExp(r'[0-9.]')),
              ],
              helper: 'Numbers only — displayed as ₹86.50 L.',
            ),
            _Field(
              label: 'Type',
              controller: _type,
              hint: 'Premium residential floors',
              textCapitalization: TextCapitalization.words,
            ),
            _Field(
              label: 'Description',
              controller: _description,
              hint: 'What makes this product worth marketing?',
              maxLines: 3,
              textCapitalization: TextCapitalization.sentences,
            ),
            _Field(
              label: 'Cover image URL',
              controller: _image,
              hint: 'https://…',
              keyboardType: TextInputType.url,
              helper: 'Leave blank to use your brand logo.',
            ),
            if (_error != null) ...<Widget>[
              const SizedBox(height: NoboSpace.sm),
              Container(
                padding: const EdgeInsets.all(NoboSpace.md),
                decoration: BoxDecoration(
                  color: c.dangerWash,
                  borderRadius: NoboRadius.rSm,
                ),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: <Widget>[
                    Icon(
                      Icons.error_outline_rounded,
                      size: 15,
                      color: c.danger,
                    ),
                    const SizedBox(width: NoboSpace.sm),
                    Expanded(
                      child: Text(
                        _error!,
                        style: NoboType.caption.copyWith(color: c.danger),
                      ),
                    ),
                  ],
                ),
              ),
            ],
            const SizedBox(height: NoboSpace.base),
            PwaPrimaryButton(
              label: editing ? 'Save changes' : 'Add product',
              icon: editing ? Icons.check_rounded : Icons.add_rounded,
              loading: _saving,
              onPressed: _saving ? null : _save,
            ),
            const SizedBox(height: NoboSpace.md),
          ],
        ),
      ),
    );
  }
}

class _Field extends StatelessWidget {
  const _Field({
    required this.label,
    required this.controller,
    this.hint,
    this.helper,
    this.maxLines = 1,
    this.keyboardType,
    this.inputFormatters,
    this.textCapitalization = TextCapitalization.none,
    this.required = false,
  });

  final String label;
  final TextEditingController controller;
  final String? hint;
  final String? helper;
  final int maxLines;
  final TextInputType? keyboardType;
  final List<TextInputFormatter>? inputFormatters;
  final TextCapitalization textCapitalization;
  final bool required;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Padding(
      padding: const EdgeInsets.only(bottom: NoboSpace.md),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Row(
            children: <Widget>[
              Text(
                label.toUpperCase(),
                style: NoboType.micro.copyWith(
                  color: c.inkTertiary,
                  fontSize: 10,
                ),
              ),
              if (required)
                Text(
                  ' *',
                  style: NoboType.micro.copyWith(
                    color: c.danger,
                    fontSize: 10,
                  ),
                ),
            ],
          ),
          const SizedBox(height: 6),
          TextField(
            controller: controller,
            maxLines: maxLines,
            keyboardType: keyboardType,
            inputFormatters: inputFormatters,
            textCapitalization: textCapitalization,
            style: NoboType.body.copyWith(color: c.ink, fontSize: 14.5),
            cursorColor: c.primary,
            decoration: InputDecoration(
              hintText: hint,
              hintStyle: NoboType.body.copyWith(
                color: c.inkTertiary,
                fontSize: 14.5,
              ),
            ),
          ),
          if (helper != null)
            Padding(
              padding: const EdgeInsets.only(top: 4),
              child: Text(
                helper!,
                style: NoboType.caption.copyWith(
                  color: c.inkTertiary,
                  fontSize: 11,
                ),
              ),
            ),
        ],
      ),
    );
  }
}
