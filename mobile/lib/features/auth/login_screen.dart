import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';

import '../../app/router.dart';
import '../../core/design/nobo_colors.dart';
import '../../core/design/nobo_metrics.dart';
import '../../core/design/nobo_type.dart';
import '../../core/platform/nobo_platform.dart';
import '../../core/providers.dart';
import '../../core/ui/adaptive.dart';
import '../../core/ui/controls.dart';
import '../../core/ui/orbit_mark.dart';

/// Sign in to an existing Nobogent workspace.
///
/// Uses the same Supabase GoTrue instance as the PWA, so an existing account
/// works unchanged and no new credentials are introduced.
class LoginScreen extends ConsumerStatefulWidget {
  const LoginScreen({super.key});

  @override
  ConsumerState<LoginScreen> createState() => _LoginScreenState();
}

class _LoginScreenState extends ConsumerState<LoginScreen> {
  final TextEditingController _email = TextEditingController();
  final TextEditingController _password = TextEditingController();
  final TextEditingController _name = TextEditingController();
  final TextEditingController _business = TextEditingController();

  bool _busy = false;
  bool _creating = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    _name.dispose();
    _business.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    final String email = _email.text.trim();
    final String password = _password.text;

    if (email.isEmpty || password.isEmpty) {
      setState(() => _error = 'Enter your email and password.');
      return;
    }
    if (_creating && (_name.text.trim().isEmpty || _business.text.trim().isEmpty)) {
      setState(() => _error = 'Tell us your name and business name.');
      return;
    }

    setState(() {
      _busy = true;
      _error = null;
    });

    try {
      final AccountController ctl = ref.read(accountProvider.notifier);
      if (_creating) {
        await ctl.signUp(
          email: email,
          password: password,
          fullName: _name.text.trim(),
          businessName: _business.text.trim(),
        );
      } else {
        await ctl.signIn(email, password);
      }
      if (!mounted) return;
      final AsyncValue<dynamic> state = ref.read(accountProvider);
      if (state.hasError) {
        setState(() => _error = _friendly(state.error));
      } else if (state.value == null && !_creating) {
        setState(() => _error = 'That account has no workspace profile yet.');
      } else if (mounted) {
        context.go(Routes.analytics);
      }
    } finally {
      if (mounted) setState(() => _busy = false);
    }
  }

  String _friendly(Object? e) {
    final String s = e?.toString() ?? '';
    if (s.contains('invalid')) {
      return 'That email and password combination did not match.';
    }
    return 'We could not sign you in. Please try again.';
  }

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    final bool demo = ref.watch(demoModeProvider);
    final bool isDark = Theme.of(context).brightness == Brightness.dark;

    return Scaffold(
      resizeToAvoidBottomInset: true,
      body: DecoratedBox(
        decoration: BoxDecoration(
          gradient: LinearGradient(
            begin: Alignment.topLeft,
            end: Alignment.bottomRight,
            colors: isDark
                ? const <Color>[Color(0xFF120E22), Color(0xFF0A0910)]
                : const <Color>[Color(0xFFF7F4FF), Color(0xFFF1EDFB)],
          ),
        ),
        child: SafeArea(
          child: LayoutBuilder(
            builder: (BuildContext context, BoxConstraints constraints) {
              return SingleChildScrollView(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.gutter,
                  vertical: NoboSpace.xl,
                ),
                child: ConstrainedBox(
                  constraints: BoxConstraints(
                    minHeight: constraints.maxHeight - NoboSpace.huge,
                  ),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: <Widget>[
                      const SizedBox(height: NoboSpace.xxl),
                      _BrandHeader(isDark: isDark),
                      const SizedBox(height: NoboSpace.xxl),
                      _FormCard(
                        emailController: _email,
                        passwordController: _password,
                        nameController: _name,
                        businessController: _business,
                        creating: _creating,
                        busy: _busy,
                        error: _error,
                        demoMode: demo,
                        onToggleMode: () => setState(() {
                          _creating = !_creating;
                          _error = null;
                        }),
                        onSubmit: _submit,
                        onForgot: () => showNoboConfirm(
                          context: context,
                          title: 'Reset your password',
                          message:
                              'We will email a reset link to '
                              '${_email.text.trim().isEmpty ? 'your address' : _email.text.trim()}. '
                              'Open it on this phone to finish.',
                          confirmLabel: 'Send link',
                        ),
                      ),
                      const SizedBox(height: NoboSpace.xl),
                      Center(
                        child: Text(
                          'Nobogent · AI marketing for growing businesses',
                          style: NoboType.caption.copyWith(
                            color: c.inkTertiary,
                          ),
                        ),
                      ),
                    ],
                  ),
                ),
              );
            },
          ),
        ),
      ),
    );
  }
}

class _BrandHeader extends StatelessWidget {
  const _BrandHeader({required this.isDark});

  final bool isDark;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: <Widget>[
        const OrbitMark(size: 68, active: true),
        const SizedBox(height: NoboSpace.lg),
        Text(
          'nobogent',
          style: NoboType.display.copyWith(
            fontSize: 38,
            color: c.ink,
            letterSpacing: -1.4,
          ),
        ),
        const SizedBox(height: NoboSpace.sm),
        Text(
          'Your first AI marketing employee.\nTell it what to do — it does the work.',
          style: NoboType.body.copyWith(color: c.inkSecondary, height: 1.5),
        ),
      ],
    );
  }
}

class _FormCard extends StatelessWidget {
  const _FormCard({
    required this.emailController,
    required this.passwordController,
    required this.nameController,
    required this.businessController,
    required this.creating,
    required this.busy,
    required this.error,
    required this.demoMode,
    required this.onToggleMode,
    required this.onSubmit,
    required this.onForgot,
  });

  final TextEditingController emailController;
  final TextEditingController passwordController;
  final TextEditingController nameController;
  final TextEditingController businessController;
  final bool creating;
  final bool busy;
  final String? error;
  final bool demoMode;
  final VoidCallback onToggleMode;
  final VoidCallback onSubmit;
  final VoidCallback onForgot;

  @override
  Widget build(BuildContext context) {
    final NoboColors c = context.nobo;

    return Container(
      decoration: BoxDecoration(
        color: c.surface,
        borderRadius: BorderRadius.circular(NoboRadius.xl),
        border: Border.all(color: c.border),
        boxShadow: NoboElevation.high,
      ),
      padding: const EdgeInsets.all(NoboSpace.lg),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: <Widget>[
          Text(
            creating ? 'Create your workspace' : 'Welcome back',
            style: NoboType.headline.copyWith(color: c.ink),
          ),
          const SizedBox(height: 4),
          Text(
            creating
                ? 'Two minutes, then Nobogent starts working for you.'
                : 'Sign in with the same account you use on the web.',
            style: NoboType.caption.copyWith(color: c.inkSecondary),
          ),
          const SizedBox(height: NoboSpace.lg),

          if (creating) ...<Widget>[
            NoboTextField(
              controller: nameController,
              label: 'Your name',
              hint: 'Aarav Sharma',
              textCapitalization: TextCapitalization.words,
              prefixIcon: Icons.person_outline_rounded,
            ),
            const SizedBox(height: NoboSpace.base),
            NoboTextField(
              controller: businessController,
              label: 'Business name',
              hint: 'Bluesquare Infra',
              textCapitalization: TextCapitalization.words,
              prefixIcon: Icons.storefront_outlined,
            ),
            const SizedBox(height: NoboSpace.base),
          ],

          NoboTextField(
            controller: emailController,
            label: 'Email',
            hint: 'you@business.com',
            keyboardType: TextInputType.emailAddress,
            prefixIcon: Icons.alternate_email_rounded,
          ),
          const SizedBox(height: NoboSpace.base),
          NoboTextField(
            controller: passwordController,
            label: 'Password',
            hint: '••••••••',
            obscure: true,
            prefixIcon: Icons.lock_outline_rounded,
            onSubmitted: (_) => onSubmit(),
          ),

          if (error != null) ...<Widget>[
            const SizedBox(height: NoboSpace.md),
            Container(
              padding: const EdgeInsets.all(NoboSpace.md),
              decoration: BoxDecoration(
                color: c.dangerWash,
                borderRadius: NoboRadius.rSm,
              ),
              child: Row(
                children: <Widget>[
                  Icon(Icons.error_outline_rounded, size: 16, color: c.danger),
                  const SizedBox(width: NoboSpace.sm),
                  Expanded(
                    child: Text(
                      error!,
                      style: NoboType.caption.copyWith(color: c.danger),
                    ),
                  ),
                ],
              ),
            ),
          ],

          const SizedBox(height: NoboSpace.lg),
          NoboButton(
            label: creating ? 'Create workspace' : 'Sign in',
            onPressed: onSubmit,
            loading: busy,
            expand: true,
            size: NoboButtonSize.large,
            trailingIcon: NoboPlatform.isIOS ? Icons.arrow_forward_rounded : null,
          ),

          if (!creating) ...<Widget>[
            const SizedBox(height: NoboSpace.sm),
            Center(
              child: TextButton(
                onPressed: onForgot,
                child: Text(
                  'Forgot your password?',
                  style: NoboType.caption.copyWith(color: c.inkSecondary),
                ),
              ),
            ),
          ],

          const SizedBox(height: NoboSpace.sm),
          Row(
            children: <Widget>[
              Expanded(child: Divider(color: c.hairline)),
              Padding(
                padding: const EdgeInsets.symmetric(
                  horizontal: NoboSpace.md,
                ),
                child: Text(
                  'or',
                  style: NoboType.caption.copyWith(color: c.inkTertiary),
                ),
              ),
              Expanded(child: Divider(color: c.hairline)),
            ],
          ),
          const SizedBox(height: NoboSpace.sm),
          Center(
            child: TextButton(
              onPressed: onToggleMode,
              child: Text(
                creating
                    ? 'I already have an account'
                    : 'Create a new workspace',
                style: NoboType.label.copyWith(color: c.primary),
              ),
            ),
          ),

          if (demoMode) ...<Widget>[
            const SizedBox(height: NoboSpace.sm),
            Container(
              width: double.infinity,
              padding: const EdgeInsets.all(NoboSpace.md),
              decoration: BoxDecoration(
                color: c.primaryWash.withValues(alpha: 0.6),
                borderRadius: NoboRadius.rSm,
              ),
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: <Widget>[
                  Icon(Icons.science_outlined, size: 16, color: c.primary),
                  const SizedBox(width: NoboSpace.sm),
                  Expanded(
                    child: Text(
                      'No backend credentials are compiled into this build, so '
                      'the app is showing a seeded demo workspace.',
                      style: NoboType.caption.copyWith(
                        color: c.inkSecondary,
                      ),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ],
      ),
    );
  }
}