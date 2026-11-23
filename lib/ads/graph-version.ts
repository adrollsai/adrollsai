/**
 * One Graph API version for the ads surface.
 *
 * WHY THIS EXISTS
 * The ads code pinned a version at each call site: `v19.0` in the campaign
 * processor and the ads routes, `v20.0` for interest search, `v21.0` in the agent's
 * Meta tools — three versions live at once, all of them several releases behind
 * (Meta is on v27.0 today). A version that still answers is not a version that is
 * supported: Meta retires roughly two years after release, and when v19 goes the
 * launcher stops creating campaigns with no code change on our side.
 *
 * Everything that builds or reads an ad campaign now imports this, so a bump is one
 * line, and the payloads were exercised against this exact version with
 * `execution_options: ["validate_only"]` before shipping.
 *
 * WhatsApp Cloud API calls stay on their own version on purpose: they are a
 * different product surface with a different deprecation track.
 */
export const META_GRAPH_VERSION = 'v23.0';

/** `https://graph.facebook.com/v23.0` — no trailing slash. */
export const META_GRAPH_URL = `https://graph.facebook.com/${META_GRAPH_VERSION}`;

/** `https://graph.facebook.com` — for callers that build the version into the path. */
export const META_GRAPH_HOST = 'https://graph.facebook.com';

/** The version this constant replaced, recorded so the audit trail is explicit. */
export const META_GRAPH_VERSION_HISTORY = ['v19.0', 'v20.0', 'v21.0', 'v23.0'] as const;
