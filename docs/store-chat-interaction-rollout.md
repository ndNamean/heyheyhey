# Store Chat interaction rollout

Phased upgrade for reply, reactions, actions, GIPHY, translation, and ambient glow. Keep schema/perms additive; disable UI paths independently if needed.

## Rollout order

1. **Schema** — deploy additive Instant schema (`storeChatMessages` media/forward fields, `storeChatReactions`, `storeChatBookmarks`).
2. **Permissions** — deploy matching Instant perms (view via store access; create/delete only actor-owned reaction/bookmark rows).
3. **Read path** — ship UI that renders optional fields / empty defaults without requiring writes.
4. **Write path** — enable mutations behind env/feature flags (GIPHY key, translation flag + server envs).
5. **Monitor** — watch send failures, reaction write errors, translation 4xx/5xx, and GIPHY rate limits.

Historical rows stay readable without backfill. Empty `replyToMessageId` / GIPHY fields mean “none”.

## Feature flags / env

| Flag / env | Effect when unset / off |
| --- | --- |
| `VITE_GIPHY_API_KEY` | Composer GIF button and GIPHY reaction search stay hidden/disabled. |
| `VITE_STORE_CHAT_TRANSLATION` | Translate action stays unavailable even if a provider exists. |
| `TRANSLATION_PROVIDER` (+ optional `TRANSLATION_API_KEY`) | `/api/translate-store-chat` reports unsupported when unset; `mymemory` works keyless. |
| `VITE_REPORT_CHAT_NOTIFY` / `REPORT_CHAT_NOTIFY` | Report → Store Chat handoffs **default OFF** (opt-in). Unset/`0`/`false`/`off` → no `report_system` writes. Set `1`/`true`/`on` to enable. Does not change Logbook chat notify. |
| `VITE_CHAT_ATTACHMENTS` | Chat composer attachments (photos/files) **default OFF**. Unset/`0`/`false`/`off` → no `+` attach UI and client upload wrapper refuses. Set `1`/`true`/`on` after Phase 1 schema/perms + `/api/upload-chat-attachment` are deployed. Does not change GIPHY. See [chat-attachments-rollout.md](./chat-attachments-rollout.md) for full QA matrices. |

Hobby note: Vercel Hobby allows ≤12 serverless functions. Translation is its own route; `/api/media-url` was folded into `/api/image-proxy` (with a rewrite) to stay under the limit. Report chat reuses `/api/logbook-notify` (`type: deliver_report_event`) — no new function. Chat attachments use `/api/upload-chat-attachment` (counts toward the Hobby cap).
| Ambient glow | Controlled by `src/config/ambientMediaEffects.ts` (`enabled`); reduced-motion users get sustained color only. |

Reply UI, Unicode reactions, copy/forward/favorite/delete do not require the GIPHY or translation flags.

### Chat attachments rollout

1. Deploy Instant schema (attachment string fields + optional `attachmentFile` → `$files` on `storeChatMessages` / `groupChatMessages`) and matching perms (`attachment` / `text_attachment`, `mediaCoherent` empty-attachment rules).
2. Deploy `/api/upload-chat-attachment` + payload helpers (empty attachment defaults on all sends). Flag stays **off**.
3. Phase 2+ UI: set `VITE_CHAT_ATTACHMENTS=1` (or `true` / `on`) and redeploy.
4. Rollback UI: unset the flag (or set `0`/`false`/`off`) and redeploy — existing attachment messages still render once UI supports them; new uploads stop. Do not drop schema fields.

## Report → Store Chat (handoff)

Checklist Report events post at most three `report_system` Store Chat rows per waiting cycle (named mentions only, never `@all`):

| Event | When |
| --- | --- |
| `report_submitted` | Submit or correction resubmit |
| `report_action_required` | First reject/correction in the cycle |
| `report_finalized` | Finalize with issues **only if** no prior `report_action_required` for that cycle |

Clean all-approved finalize never writes chat. Per-item approve stays inbox-only.

### Rollout / rollback

1. Deploy schema (`storeChatMessages.reportId`) + perms (`report_system` Admin-only create).
2. Ship code with flag **off** (default).
3. Pilot: set `VITE_REPORT_CHAT_NOTIFY=1` and `REPORT_CHAT_NOTIFY=1` on one environment / cohort, redeploy.
4. Rollback: unset both env vars (or set `0`/`false`/`off`) and redeploy — zero new `report_system` writes; Logbook chat unchanged.

### QA checklist

- [ ] Flag off: zero `report_system` writes; Logbook chat unchanged.
- [ ] Submit → one chat @reviewers; Open Review deep-links to Review → Reports.
- [ ] Approve N items → no new chat.
- [ ] First correction → one @submitter; second correction same cycle → no new chat.
- [ ] Resubmit → one new ready-for-review.
- [ ] Finalize clean approve → no chat; finalize with issues after action_required → no duplicate.
- [ ] Perms: client cannot create `report_system`.
- [ ] Mention inbox/push opens Store Chat for named recipients.

## Independent disable / rollback

- **GIPHY:** remove or blank `VITE_GIPHY_API_KEY` (redeploy). Existing media messages still render; new picks stop.
- **Translation:** unset `VITE_STORE_CHAT_TRANSLATION` and/or server translation envs. No schema rollback.
- **Report chat:** unset `VITE_REPORT_CHAT_NOTIFY` / `REPORT_CHAT_NOTIFY` (redeploy). No schema rollback.
- **Chat attachments:** unset `VITE_CHAT_ATTACHMENTS` (redeploy). Schema/perms/API can remain; composer attach UI stays off.
- **Ambient glow:** set `ambientMediaEffects.enabled = false` (or gate behind a future env if added).
- **Reactions / bookmarks UI:** revert UI commits; leave schema/perms in place (safe additive).
- **Reply UI:** revert UI only; field already existed and empty string remains “no reply”.

Do **not** drop Instant entities for rollback unless you have a coordinated data migration plan.

## QA notes

- Prefer Vitest + Testing Library for interaction coverage (Playwright deferred).
- Spot-check Arabic (`dir=rtl`): swipe-to-reply mirrors, quote start border, action menu `inset-inline-start`.
- Confirm Escape closes More / sheet / GIPHY picker and focus returns to the message row.
- Confirm `@media (prefers-reduced-motion: reduce)` disables highlight animation and ambient breathe/flash.
