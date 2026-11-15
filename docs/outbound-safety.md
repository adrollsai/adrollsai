# Outbound safety: who the agent is allowed to reach

The agent has two tools that reach a real person: a WhatsApp template message and an AI voice
call. Both sit behind the review gate, so a human must approve each one before it runs. Two other
questions need an answer, and this note records the decision.

## The decision

**Production runs WITHOUT `OUTBOUND_TEST_MODE`.** Preview and local runs have it on.

## Why

`OUTBOUND_TEST_MODE=true` rewrites every recipient to `OUTBOUND_TEST_NUMBER`. On a live product
that means a paying customer's message to their own lead is silently delivered to one phone
number instead, and the customer has no way to know. That failure is worse than the risk it
removes: it breaks the core promise of the product, silently, for everybody.

So the guard stays a testing tool, not a production setting. Production without it means the
agent reaches the recipient that was approved — which is the behaviour the product is for.

## What makes that safe instead

1. **The review gate.** Neither tool can run without an approval row matching the action type,
   and the payload that runs is the one the owner was shown. Approvals are spent after one use.
2. **The tools now report the real recipient.** They used to answer `"queued for delivery"`
   having sent nothing, which made any test meaningless. They now return Meta's message id, or
   the provider's error, plus the number actually attempted.
3. **Tests run where the guard is on.** Anything that sends is exercised against a local server
   (`.env.local` pins `OUTBOUND_TEST_NUMBER=918288835235`) or with an explicit recipient.
4. **`verify:outbound-live` refuses any target but the owner's number.** See the rail in
   `scripts/verify-outbound-live.ts`: it exits before sending unless the recipient is
   `918288835235`, so it cannot be pointed at a customer by accident.

## How to test each channel

```bash
# WhatsApp (local server, guard pins the recipient)
npm run verify:outbound-live                       # hello_world / en_US by default
npm run verify:outbound-live -- --template <name>  # any approved template

# Voice call, through the owned Indian Vobiz line
npm run verify:outbound-live && node .tmp-outbound.mjs --call --bluesquare
```

Approved templates live on WABA `1777393797025557` (20 of them, all `en_US`). Note that
`profiles.whatsapp_business_account_id` currently holds a WABA id the Graph API does not
recognise, which is worth correcting before template management is used from the app.

## Two account facts that block real sends (not code)

- Twilio: the account on file is inactive (`status 4`, HTTP 401), so the super-admin default
  routing cannot place calls. Calls work through the Vobiz line instead.
- Vobiz: `VOBIZ_AUTH_ID` / `VOBIZ_AUTH_TOKEN` in `.env.local` are rejected by the Vobiz API
  (401), so DIDs cannot be listed locally. The dispatcher still places calls with the owned DID.
