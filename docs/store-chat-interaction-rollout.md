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

Hobby note: Vercel Hobby allows ≤12 serverless functions. Translation is its own route; `/api/media-url` was folded into `/api/image-proxy` (with a rewrite) to stay under the limit.
| Ambient glow | Controlled by `src/config/ambientMediaEffects.ts` (`enabled`); reduced-motion users get sustained color only. |

Reply UI, Unicode reactions, copy/forward/favorite/delete do not require the GIPHY or translation flags.

## Independent disable / rollback

- **GIPHY:** remove or blank `VITE_GIPHY_API_KEY` (redeploy). Existing media messages still render; new picks stop.
- **Translation:** unset `VITE_STORE_CHAT_TRANSLATION` and/or server translation envs. No schema rollback.
- **Ambient glow:** set `ambientMediaEffects.enabled = false` (or gate behind a future env if added).
- **Reactions / bookmarks UI:** revert UI commits; leave schema/perms in place (safe additive).
- **Reply UI:** revert UI only; field already existed and empty string remains “no reply”.

Do **not** drop Instant entities for rollback unless you have a coordinated data migration plan.

## QA notes

- Prefer Vitest + Testing Library for interaction coverage (Playwright deferred).
- Spot-check Arabic (`dir=rtl`): swipe-to-reply mirrors, quote start border, action menu `inset-inline-start`.
- Confirm Escape closes More / sheet / GIPHY picker and focus returns to the message row.
- Confirm `@media (prefers-reduced-motion: reduce)` disables highlight animation and ambient breathe/flash.
