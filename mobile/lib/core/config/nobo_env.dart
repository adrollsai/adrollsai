/// Compile-time configuration.
///
/// Values are injected with `--dart-define` (see `dart_defines.example.json`),
/// never committed. Only the Supabase *anon* key is ever shipped to a client —
/// it is the same public key the PWA already exposes in its browser bundle.
/// The service-role key must never appear in this app.
abstract final class NoboEnv {
  const NoboEnv._();

  /// Supabase project URL, e.g. `https://<ref>.supabase.co`.
  static const String supabaseUrl = String.fromEnvironment(
    'NOBO_SUPABASE_URL',
    defaultValue: '',
  );

  /// Supabase publishable/anon key (safe for client use, RLS still applies).
  static const String supabaseAnonKey = String.fromEnvironment(
    'NOBO_SUPABASE_ANON_KEY',
    defaultValue: '',
  );

  /// Base URL of the existing Nobogent Next.js backend. Used only for the
  /// endpoints that hold server-side secrets (AI agent, media generation).
  static const String apiBaseUrl = String.fromEnvironment(
    'NOBO_API_BASE_URL',
    defaultValue: 'https://app.nobogent.com',
  );

  /// Forces the offline demo dataset. Useful for design review and CI
  /// screenshots without credentials.
  static const bool demoMode = bool.fromEnvironment('NOBO_DEMO');

  /// True when the app has enough configuration to talk to Supabase.
  static bool get isConfigured =>
      supabaseUrl.isNotEmpty && supabaseAnonKey.isNotEmpty;

  /// OAuth/deep-link scheme registered in AndroidManifest and Info.plist.
  static const String deepLinkScheme = 'nobogent';

  static const String oauthRedirect = '$deepLinkScheme://auth-callback';

  /// QA-only: forces the iOS (Cupertino) experience on any device.
  ///
  /// This exists so the iOS interface can be rendered and screenshotted on a
  /// host without macOS or an iPhone simulator. It is compiled in only for
  /// debug builds and is ignored in release, so it can never reach a user.
  ///
  ///   flutter run --dart-define=NOBO_FORCE_IOS=true
  static const bool forceIosExperience = bool.fromEnvironment('NOBO_FORCE_IOS');
}
