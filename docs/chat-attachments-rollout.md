# Chat attachments rollout

Feature-flagged composer attachments (photos, camera capture, files, drag/drop, paste, quick messages) for Store Chat and Group Chat. GIPHY stays a separate control. TimemarkCamera / `/api/upload-photo` / `mediaRecords` are not used.

## Enable checklist

1. Deploy Instant **schema** (attachment string fields + optional `attachmentFile` → `$files` on `storeChatMessages` / `groupChatMessages`).
2. Deploy Instant **perms** (`attachment` / `text_attachment` + `mediaCoherent` empty-attachment rules on GIPHY/text types).
3. Deploy `/api/upload-chat-attachment` (Admin SDK upload; membership / store access re-checked server-side).
4. Set `VITE_CHAT_ATTACHMENTS=1` (or `true` / `on`) and redeploy the web app.
5. Rollback UI only: unset the flag (or `0` / `false` / `off`) and redeploy — existing attachment rows still render; new uploads stop.

## Security sanity (automated + review)

| Check | Where |
| --- | --- |
| MIME + size allowlists | Client `chatAttachmentPolicy.ts` + server `api/_lib/chat-attachment/policy.js` (magic bytes) |
| Authz before `$files` write | Store: `userHasStoreAccess`; Group: `groupChatMembers` membership (no `authorizedStores` required) |
| Path prefixes | Store: `stores/{storeId}/chat/...`; Group: `stores/group-chat/{roomId}/...` |
| No Timemark / proof coupling | Attachments use `/api/upload-chat-attachment` only |
| Flag off | No `+` UI; client upload wrapper throws `feature_disabled` |

## Protected + attachment matrices

### Protected (flag on or off) — manual PWA QA

- [ ] Send text / `@mention` / reply / react (unicode + GIPHY) / bookmark / forward / copy / delete — unchanged
- [ ] GIF-only and text+GIF send; cancel staged GIF — unchanged
- [ ] Switch Store ↔ Group; history; membership; notifications — unchanged
- [ ] Mobile + desktop composer layout (GIF + Send still aligned) — unchanged
- [ ] Flag **off**: no `+` button, no attachment staging, text/GIF still work

### New (flag on) — manual PWA QA

- [ ] `+` opens sheet (mobile) / popover (desktop): Camera, Photos, File, Quick Message
- [ ] Escape closes menu; focus returns to `+` (not forced into textarea)
- [ ] Photos → stage preview → caption → Send → inline image bubble
- [ ] Camera permission deny → “Choose from Photos”; chat still usable
- [ ] Remove staged attachment without losing draft text
- [ ] Upload fail → Retry / Remove; no phantom sent bubble; Retry does not duplicate Instant row after Instant failure (cached upload + stable `clientMutationId`)
- [ ] Allowed PDF shows file meta card; `.exe` / oversized / zip rejected with error
- [ ] Quick Message inserts editable text only (no auto-send)
- [ ] Paste image / drag-drop image uses same staging pipeline (XOR with GIPHY)
- [ ] Group chat attach works when the member has **no** authorized stores (empty `authorizedStores`)
- [ ] iOS Safari PWA + Android Chrome PWA: camera / photos pickers, keyboard does not jump when opening `+` sheet
- [ ] Desktop: drag overlay ignored when dragging panel chrome; Cmd/Ctrl+V image on focused composer

### Automated (Vitest)

Run `npm test`. Coverage includes:

- Policy reject (MIME, size, blocked extensions) — client + server helpers
- Payload builders: text / GIPHY / attachment XOR / empty attachment defaults
- Feature flag default off
- Upload client: flag off, group without `storeId`, policy short-circuit
- Staging: stable send ids + cached upload across retry; GIPHY clear callback
- Attach menu Escape; camera-denied live region; preview retry UI; drop overlay

## Follow-ups (out of MVP scope)

- Orphan `$files` cleanup if Instant write fails after upload and user discards the draft
- Video / multi-attach
- Move GIPHY into `+` (explicitly deferred)
