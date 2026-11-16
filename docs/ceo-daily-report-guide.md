# The CEO daily report — what it is and how to read it

`lib/automation/eod-report.ts` builds one report per business per day from the account's own data.
This guide is checked against that code by `npm run verify:ceo-guide`: every section and metric named
here must be one the builder actually emits, so the guide cannot drift into folklore.

## What arrives, and where

One report per day per business, sent on **two channels from the same facts**:

| Channel | Field | What it is |
|---|---|---|
| WhatsApp | `whatsappText` | the short read — headline, the numbers, one line per section |
| Email / in-app | `html` | the same facts laid out with the metric tiles and the pipeline table |

`facts` holds every plain-English sentence both channels render. It exists so the report can be
audited: if a sentence is not in `facts`, it is not in the report.

## Identity

- **`periodKey`** — `YYYY-MM-DD` in the tenant's own timezone, e.g. `2026-11-16`. It is the
  idempotency key for the day: one report per business per period, so a retry or a re-run cannot
  produce a second report.
- **`dateLabel`** — the human date, e.g. `16 November 2026`.
- **`timezone`** — `profiles.timezone`, defaulting to `Asia/Kolkata`. Every "today" in the report is
  that tenant's today, not the server's.

## The three numbers at the top

| Key | Label | Meaning |
|---|---|---|
| `new_leads` | New applicants | leads created today, with yesterday in the hint for comparison |
| `calls` | Calls connected | connected / attempted, not a single ambiguous count |
| `credits` | Credits left | the spendable balance after open reservations |

Industry vocabulary comes from `industryVocabulary(profiles.industry)`: an academy reads
"applicants", a real-estate business reads "leads", an untagged tenant gets a neutral word. A null or
unknown industry must never inherit another vertical's nouns.

## The sections

| Key | Title | What it says |
|---|---|---|
| `activity` | Today | new leads, WhatsApp messages sent, calls attempted/connected, assets produced |
| `pipeline` | CRM pipeline | total in the CRM, then a label/value row per pipeline stage |
| `routine` | Daily routine | whether the routine is on, its cadence, and today's run status |
| `cost` | Cost | credits used today and the balance |
| `next` | Next step | what to do about today — present on quiet days, so an empty day still tells you something |

Sections appear as the data warrants: `pipeline` needs a pipeline to show, and `next` appears when
the day was quiet. The four always-present ones are `activity`, `routine` and `cost`.

**Zeros are spelled out in prose, not dropped.** On a day with nothing in it the metric tiles shrink to
the balance, but `activity` reads "No new applicants, no WhatsApp messages, no calls and nothing
produced." and the headline is "Nothing came in today." — so a quiet day cannot be mistaken for a day
that was never measured.

## `sentiment`

One of `quiet` · `normal` · `good` · `attention`, and it decides how the report opens. It is derived
from the day's facts — it is not a mood the generator picks.

## The rules the report obeys

1. **Every figure is a real count from the account's own data.** Nothing is estimated, extrapolated or
   carried over from a previous day, and a zero is reported as zero rather than dressed up.
2. **Scope and period travel with the number.** "9 new applicants today" — today, this business, this
   timezone.
3. **Meta's own "results" is never called a lead.** `campaign.results` is what Meta counted; the CRM
   lead count is a different number, and conflating them invents conversions.
4. **A quiet day is a valid report.** `quiet` exists so a day with nothing in it is described honestly
   instead of padded.

## When it does not arrive

- `profiles.enable_eod_report` must be on for the tenant.
- The cron entry point is `/api/cron/eod-report` (with `/api/cron/eod-report/worker` doing the work),
  and `/api/cron/ceo-digest` for the CEO summary.
- Because `periodKey` is the idempotency key, a missing report is a delivery problem, not a
  duplicate-suppression problem: re-running the same period will not silently make a second one.

## Asking the agent about it

The agent reads the same data with `org_call_report`, `org_lead_report` and `lead_conversations`. If
the report and the agent disagree, both numbers should be shown and the reason stated — a visible
contradiction is a bug report, a silent one is a lie.
