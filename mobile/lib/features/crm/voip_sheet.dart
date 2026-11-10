import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/media.dart';
import '../../data/repositories/auth_repository.dart';

enum _CallState { idle, dialing, ringing, failed }

/// Native equivalent of the web app's VoIP softphone sheet.
///
/// The web version streams the agent's audio through a WebSocket bridge. Two-way
/// in-app audio is not ported (it needs a full media stack), so this sheet offers
/// what the app can reliably do today:
///
///  * **VoIP call** — the same server-side Vobiz dial the web softphone triggers,
///    which rings the lead through the workspace DID and records + transcribes.
///  * **Phone dialer** — hand off to the device dialer.
///
/// The UI states the limitation plainly rather than implying two-way audio.
Future<void> showVoipSheet({
  required BuildContext context,
  required WidgetRef ref,
  required String name,
  required String phone,
  String? leadId,
}) {
  return showNoboSheet<void>(
    context: context,
    builder: (BuildContext ctx) => _VoipSheet(
      name: name,
      phone: phone,
      leadId: leadId,
      ref: ref,
    ),
  );
}

class _VoipSheet extends StatefulWidget {
  const _VoipSheet({
    required this.name,
    required this.phone,
    required this.leadId,
    required this.ref,
  });

  final String name;
  final String phone;
  final String? leadId;
  final WidgetRef ref;

  @override
  State<_VoipSheet> createState() => _VoipSheetState();
}

class _VoipSheetState extends State<_VoipSheet> {
  _CallState _state = _CallState.idle;
  String? _callUuid;
  String? _error;
  String _status = 'Ready to call';

  String get _digits => widget.phone.replaceAll(RegExp(r'[^0-9+]'), '');

  Future<void> _dial() async {
    setState(() {
      _state = _CallState.dialing;
      _error = null;
      _status = 'Dialing ${widget.phone} via VoIP…';
    });
    try {
      final Map<String, dynamic> res = await widget.ref
          .read(workspaceRepositoryProvider)
          .dialVoip(phone: _digits, leadId: widget.leadId);
      if (!mounted) return;
      final String? uuid = (res['callUuid'] ?? res['call_uuid'])?.toString();
      final bool ok = res['success'] == true || uuid != null;
      setState(() {
        _callUuid = uuid;
        _state = ok ? _CallState.ringing : _CallState.failed;
        _status = ok
            ? 'Ringing ${widget.name} — the call is recorded and transcribed.'
            : 'The call could not be placed.';
        _error = ok ? null : (res['error']?.toString() ?? 'Unknown error');
      });
    } on NoboFailure catch (e) {
      if (!mounted) return;
      setState(() {
        _state = _CallState.failed;
        _error = e.message;
        _status = 'Call failed';
      });
    }
  }

  Future<void> _hangUp() async {
    final String? uuid = _callUuid;
    if (uuid != null) {
      try {
        await widget.ref
            .read(workspaceRepositoryProvider)
            .endVoip(callUuid: uuid, leadId: widget.leadId);
      } on NoboFailure catch (_) {
        // Ending a call is best-effort; never block closing the sheet.
      }
    }
    if (mounted) Navigator.of(context).pop();
  }

  Future<void> _openDialer() async {
    final Uri? uri = Uri.tryParse('tel:$_digits');
    if (uri == null) return;
    try {
      await launchUrl(uri, mode: LaunchMode.externalApplication);
    } catch (_) {
      if (mounted) {
        setState(() => _error = 'No phone app is available on this device.');
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool busy =
        _state == _CallState.dialing || _state == _CallState.ringing;

    return Padding(
      padding: EdgeInsets.fromLTRB(
        NoboSpace.gutter,
        NoboSpace.xs,
        NoboSpace.gutter,
        NoboSpace.xl + MediaQuery.viewInsetsOf(context).bottom,
      ),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: <Widget>[
          Row(
            children: <Widget>[
              const Expanded(
                child: Text(
                  'VoIP Call',
                  style: TextStyle(fontSize: 17, fontWeight: FontWeight.w700),
                ),
              ),
              IconButton(
                onPressed: () => Navigator.of(context).pop(),
                icon: Icon(Icons.close_rounded, color: c.inkSecondary),
                tooltip: 'Close',
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          NoboAvatar(name: widget.name, size: 68),
          const SizedBox(height: NoboSpace.md),
          Text(
            widget.name,
            textAlign: TextAlign.center,
            style: NoboType.subtitle.copyWith(
              color: c.ink,
              fontSize: 17,
              fontWeight: FontWeight.w700,
            ),
          ),
          const SizedBox(height: 2),
          Text(
            widget.phone,
            style: NoboType.body.copyWith(color: c.inkSecondary),
          ),
          const SizedBox(height: NoboSpace.base),
          if (busy)
            SizedBox(
              width: 18,
              height: 18,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(c.primary),
              ),
            ),
          const SizedBox(height: NoboSpace.sm),
          Text(
            _status,
            textAlign: TextAlign.center,
            style: NoboType.caption.copyWith(
              color: c.inkSecondary,
              height: 1.45,
            ),
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
          const SizedBox(height: NoboSpace.lg),
          Row(
            children: <Widget>[
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: FilledButton.icon(
                    onPressed: busy ? null : (_state == _CallState.ringing ? _hangUp : _dial),
                    icon: Icon(
                      _state == _CallState.ringing
                          ? Icons.call_end_rounded
                          : Icons.phone_in_talk_rounded,
                      size: 18,
                    ),
                    label: Text(
                      _state == _CallState.ringing ? 'Hang up' : 'VoIP call',
                    ),
                  ),
                ),
              ),
              const SizedBox(width: NoboSpace.sm),
              Expanded(
                child: SizedBox(
                  height: 48,
                  child: OutlinedButton.icon(
                    onPressed: _openDialer,
                    icon: const Icon(Icons.dialpad_rounded, size: 18),
                    label: const Text('Phone'),
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: NoboSpace.md),
          Text(
            'The VoIP call is placed by the Nobogent server through your '
            'workspace number and is recorded and transcribed. Two-way audio '
            'inside the app is not available yet — use Phone to talk directly.',
            textAlign: TextAlign.center,
            style: NoboType.caption.copyWith(
              color: c.inkTertiary,
              fontSize: 11,
              height: 1.45,
            ),
          ),
        ],
      ),
    );
  }
}
