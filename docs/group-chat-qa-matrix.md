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
| Store ↔ group leakage | Separate entities; Logbook never uses `roomId` |
| Logbook ack fan-out | Still store rooms only (`ack-chat-rooms.js` unchanged) |

## Accessibility smoke

| Surface | Check |
|---------|-------|
| Create modal / sheet | Escape closes; focusable controls; ≥44px targets |
| Member picker | Selected count announced; disabled reason visible |
| Compact Back | `aria-label="Back to chats"` |
| Expanded panes | List / conversation labeled |
| Invite Accept/Decline | Buttons ≥44px |

## Store Chat regression (flag off)

| Check | Expected |
|-------|----------|
| Tab label | Store Chat |
| Store selector | Visible |
| Send / react / bookmark / Logbook cards | Unchanged |
| Instant `storeChat*` rules | Untouched |
| Knowledge store context | Unchanged |

## Staged rollout

1. Push schema + perms; keep flag off.
2. Enable for Owner/Admin pilot (`VITE_GROUP_CHAT=1`).
3. Expand operational roles via Roles matrix.
4. Full security + a11y pass before wider enable.
