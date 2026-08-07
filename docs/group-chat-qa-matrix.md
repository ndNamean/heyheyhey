# Custom Group Chat — security / a11y / regression matrices

Feature flag: `VITE_GROUP_CHAT` (default **off**). Server Admin actions return 404 when disabled.

## Security matrix (manual / Instant + API)

| Case | Expected |
|------|----------|
| Non-member Instant query messages | Empty / deny |
| Pending invitee messages | No access until accept |
| Declined / cancelled / expired | No membership, no messages |
| Accept | Membership + full history (disclosed) |
| Remove / leave | Access revoked |
| Viewer send | Instant create denied |
| Sender spoof | `senderUserId == auth.id` + own profile |
| Invite without room admin | API 403 |
| Remove owner | API 403 |
| Cross-store without capability | API 403 |
| Owner/Admin/AM without membership | Cannot read private group (no elevated bind) |
| Archived room | Client blocks send; lifecycle via Admin |
| Soft-delete | Own messages only |
| Reactions / bookmarks | Membership-only; own create/delete |
| Forward | Destinations = authorized stores + other sendable group rooms; clears mentions/reply on copy |
| Mentions | Candidates = active members + `@all`; notifs `group_chat_mention*` + deep-link |
| Store ↔ group leakage | Separate entities; Logbook never uses `roomId` |
| Logbook ack fan-out | Still store rooms only (`ack-chat-rooms.js` unchanged) |

## Feature parity vs Store Chat (flag on)

| Capability | Store Chat | Group Chat |
|------------|------------|------------|
| Text / GIPHY / reply / @mentions | Yes | Yes (members + `@all`) |
| Reactions (unicode + GIPHY) | Yes | Yes |
| Bookmark / copy / soft-delete / translate | Yes | Yes |
| Forward | Other stores | Authorized stores + other groups |
| Unread badges / jump-to-message | Yes | Yes |
| Mention inbox deep-link | `heyPelo:openStoreChat` | `heyPelo:openGroupChat` |
| Logbook system cards | Yes | **Excluded by design** |
| Group manage (invite/cancel/remove/rename) | N/A | Owner/admin sheet |

## Accessibility smoke

| Surface | Check |
|---------|-------|
| Create modal / sheet | Escape closes; focusable controls; ≥44px targets |
| Member picker | Selected count announced; disabled reason visible |
| Group details | Add / cancel invite / remove / rename errors announced |
| Compact Back | `aria-label="Back to chats"` |
| Expanded panes | List / conversation labeled |
| Message actions | Strip / sheet / keyboard (r/c); announce region |
| Invite Accept/Decline | Buttons ≥44px |

## Store Chat regression (flag off **or** on)

| Check | Expected |
|-------|----------|
| Tab / selector | Unchanged when flag off; Chats dual list when on |
| Send / mention / GIF / react / forward-store / bookmark / delete / translate / unread | Unchanged |
| Instant `storeChat*` rules | Untouched |
| Knowledge store context | Unchanged |
| Logbook → chat delivery | Store rooms only |

## Spike checklist (post-P0)

See [group-chat-spike.md](./group-chat-spike.md) verification list — membership `.room.id` bind + room messages link allow must pass before enabling flag.

## Staged rollout

1. Push schema + perms; keep flag off. ✅ (Hey Pelo Ops Web)
2. Enable for Owner/Admin pilot (`VITE_GROUP_CHAT=1`).
3. Expand operational roles via Roles matrix.
4. Full security + a11y pass before wider enable.
