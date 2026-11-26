/**
 * THE THREE BUTTONS ARE A CONTRACT, NOT A SETTING.
 *
 * WHY THIS FILE EXISTS
 * The owner's report: "we used to send 3 buttons with each response, view products/courses/properties etc
 * that took the user to the website, connect with expert that pushed a notification to the admin and book
 * appointment that gets the user to the admin's nobogent account booking page. what the hell is going on?"
 *
 * Measured on production for Procolor Film Academy: its `profiles.whatsapp_buttons` held exactly one entry,
 * `[{ "url": "", "text": "View Courses" }]`. The reply builder branched on
 * `ownerButtons.length > 0` and used THOSE as the whole menu, so a one-entry config sent a one-button
 * message: "Connect with Expert" and "Book Appointment" disappeared entirely. Worse, the single button was
 * emitted with a synthetic id (`btn_custom_0`) and an empty URL, so tapping it matched no action handler and
 * fell through to the free-form AI answer — which is why "View Courses" replied with a wall of course text
 * instead of opening www.procolorfilmacademy.com.
 *
 * The ids are the contract the inbound webhook keys on (`lib/automation/ceo.ts` says so): `view_properties`
 * opens the catalogue or the website, `talk_expert` notifies the admin, `book_appointment` opens the
 * booking page. A per-tenant row may change WORDS, never which actions a lead is offered.
 *
 * So: the menu is always those three, in that order. An owner-configured entry is a LABEL, and anything
 * beyond the first is ignored for this menu — visibly, in the return value, so the log can say so rather
 * than dropping a tenant's configuration in silence.
 */

/** The ids the inbound handlers match on. Changing one silently breaks a button. */
export const WHATSAPP_MENU_IDS = ['view_properties', 'talk_expert', 'book_appointment'] as const;

export interface WhatsAppMenuButton {
  id: string;
  /** WhatsApp caps a reply button title at 20 characters. */
  title: string;
}

export interface WhatsAppMenu {
  buttons: WhatsAppMenuButton[];
  /** The label actually used for the first button, and where it came from. */
  firstLabel: { label: string; source: 'owner-config' | 'catalogue-label' | 'industry-default' };
  /** Configured buttons this menu could not carry, so the caller can log the loss instead of hiding it. */
  ignored: string[];
}

/** WhatsApp reply-button titles are capped at 20 characters; trimming here keeps every caller honest. */
export function clampButtonTitle(value: unknown, fallback: string): string {
  const text = String(value ?? '').replace(/\s+/g, ' ').trim();
  const chosen = text || fallback;
  return chosen.length > 20 ? chosen.slice(0, 20).trim() : chosen;
}

export function buildWhatsAppMenu(input: {
  /** `profiles.whatsapp_buttons`, whatever shape a tenant has saved. */
  ownerButtons?: unknown;
  /** `profiles.whatsapp_catalogue_button_text`, e.g. "View Courses". */
  catalogueLabel?: string | null;
  /** Industry-derived default when nothing is configured, e.g. "View Properties". */
  industryLabel?: string | null;
}): WhatsAppMenu {
  const configured = Array.isArray(input.ownerButtons)
    ? input.ownerButtons.filter((b: any) => b && (b.text || b.title))
    : [];

  const firstConfigured = configured[0];
  const ownText = String(firstConfigured?.text || firstConfigured?.title || '').trim();
  const catalogueText = String(input.catalogueLabel || '').trim();
  const industryText = String(input.industryLabel || '').trim();

  const firstLabel: WhatsAppMenu['firstLabel'] = ownText
    ? { label: clampButtonTitle(ownText, 'View Offerings'), source: 'owner-config' }
    : catalogueText
      ? { label: clampButtonTitle(catalogueText, 'View Offerings'), source: 'catalogue-label' }
      : { label: clampButtonTitle(industryText, 'View Offerings'), source: 'industry-default' };

  const buttons: WhatsAppMenuButton[] = [
    { id: WHATSAPP_MENU_IDS[0], title: firstLabel.label },
    { id: WHATSAPP_MENU_IDS[1], title: clampButtonTitle(null, 'Talk to Expert') },
    { id: WHATSAPP_MENU_IDS[2], title: clampButtonTitle(null, 'Book Appointment') },
  ];

  return {
    buttons,
    firstLabel,
    ignored: configured
      .slice(1)
      .map((b: any) => String(b.text || b.title || '').trim())
      .filter(Boolean),
  };
}

/** The WhatsApp Cloud API payload for the menu, in the one shape this codebase sends. */
export function whatsAppMenuPayload(to: string, bodyText: string, menu: WhatsAppMenu) {
  return {
    messaging_product: 'whatsapp',
    recipient_type: 'individual',
    to,
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: bodyText },
      action: {
        buttons: menu.buttons.map((button) => ({
          type: 'reply',
          reply: { id: button.id, title: button.title },
        })),
      },
    },
  };
}
