# Custom Group Chat — Instant membership spike notes

## Goal

Prove `auth.ref` membership traversal for group message view without granting elevated Store Chat roles (`owner` / `admin` / `areaManager`) automatic access.

## Pattern (mirrors Store Chat store assignment)

| Concern | Store Chat | Custom Group Chat |
|--------|------------|-------------------|
| Room key | `storeId` | `roomId` (entity id of `groupChatRooms`) |
| Membership | `profileStores` → `auth.ref('$user.profile.stores.id')` | `groupChatMemberProfile` → `auth.ref('$user.profile.groupChatMemberships.roomId')` |
| Elevated bypass | `hasAllStoreChatAccess` | **None** (explicit in `instant.perms.ts`) |
| Lifecycle writes | Client Instant (messages) | Admin SDK for room/member/invite; client for messages |

## Links required

- `groupChatMembers.roomId` denormalized + linked `room`
- `groupChatMembers` → `profiles` with reverse label **`groupChatMemberships`**
- `$users` ← `profileUser` → `profiles` (existing)

## Verification checklist (real Instant identities)

1. Member A can `view` / `create` `groupChatMessages` for room R after Admin creates membership.
2. Non-member B cannot query messages for room R (empty / rule deny).
3. Pending invitee C can view own `groupChatInvites` row but **not** messages until accept.
4. Owner/Admin/AM without membership cannot view private group messages.
5. Viewer member can view but not create messages (`!isViewer`).
6. Store Chat rules unchanged — regression on store room send/view.

## History policy (v1)

Full history after accept. Instant cannot securely enforce per-member `historyVisibleFrom` with current bind patterns. Disclose on invite + accept UI. Do not ship client-only cutoffs as security.

## Push schema/perms

After deploy: `npx instant-cli push` (schema) and push perms when ready. Flag `VITE_GROUP_CHAT` stays off until go/no-go.
