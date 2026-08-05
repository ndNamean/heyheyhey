const fs = require('fs');

let schema = fs.readFileSync('instant.schema.ts','utf8');

if (!schema.includes('deliveryKey: i.string().indexed()')) {
  const notifEnd = "      readAt: i.string(),                   // '' = unread\r\n      createdAt: i.string(),\r\n    }),";
  const notifEndN = "      readAt: i.string(),                   // '' = unread\n      createdAt: i.string(),\n    }),";
  const repl = "      readAt: i.string(),                   // '' = unread\n      createdAt: i.string(),\n      deliveryKey: i.string().indexed(),\n      deepLinkJson: i.string().clientRequired(),\n    }),";
  if (schema.includes(notifEnd)) schema = schema.replace(notifEnd, repl);
  else if (schema.includes(notifEndN)) schema = schema.replace(notifEndN, repl);
  else throw new Error('notifications end not found');
}

if (!schema.includes('chatDeliveryKey: i.string().indexed()')) {
  const markerN = "      forwardedFromMessageId: i.string().clientRequired(),\n      forwardedFromUserId: i.string().clientRequired(),\n      clientMutationId: i.string().clientRequired(),\n    }),";
  const markerR = markerN.replace(/\n/g, '\r\n');
  const insert = "      forwardedFromMessageId: i.string().clientRequired(),\n      forwardedFromUserId: i.string().clientRequired(),\n      clientMutationId: i.string().clientRequired(),\n      // Admin-created Logbook system cards ('' defaults for client messages).\n      sourceType: i.string().clientRequired(),\n      logbookEntryId: i.string().clientRequired(),\n      logbookEventType: i.string().clientRequired(),\n      actionType: i.string().clientRequired(),\n      targetUserIdsJson: i.string().clientRequired(),\n      deepLinkJson: i.string().clientRequired(),\n      statusSnapshot: i.string().clientRequired(),\n      chatDeliveryKey: i.string().indexed(),\n    }),";
  if (schema.includes(markerN)) schema = schema.replace(markerN, insert);
  else if (schema.includes(markerR)) schema = schema.replace(markerR, insert);
  else throw new Error('storeChat marker missing');
}

schema = schema.replace(
  "messageType: i.string(),                 // 'text' | 'giphy_media' | 'text_giphy'",
  "messageType: i.string(),                 // 'text' | 'giphy_media' | 'text_giphy' | 'logbook_system'"
);
fs.writeFileSync('instant.schema.ts', schema);
console.log('schema', schema.includes('deliveryKey'), schema.includes('chatDeliveryKey'));

let perms = fs.readFileSync('instant.perms.ts','utf8');
const oldCreate = "      create: 'isApproved',\n      update: \"isApproved && data.recipientUserId == auth.id && onlyReadAt\",";
if (!perms.includes(oldCreate)) {
  const i = perms.indexOf('notifications: {');
  console.log('notif idx', i);
  console.log(JSON.stringify(perms.slice(i, i+400)));
  throw new Error('notifications create pattern missing');
}
const nIdx = perms.indexOf('notifications: {');
const before = perms.slice(0, nIdx);
const after = perms.slice(nIdx);
const after2 = after.replace(
  "      create: 'isApproved',\n      update: \"isApproved && data.recipientUserId == auth.id && onlyReadAt\",",
  "      create: 'isApproved && !isLogbookNotificationType',\n      update: \"isApproved && data.recipientUserId == auth.id && onlyReadAt\","
);
if (after2 === after) throw new Error('failed to replace create');
perms = before + after2;

const bindNeedle = "      onlyReadAt: \"request.modifiedFields.all(f, f in ['readAt'])\",\n    },\n  },\n\n  //";
const bindIdx = perms.indexOf('notifications: {');
const bindSection = perms.slice(bindIdx);
const bindRepl = "      onlyReadAt: \"request.modifiedFields.all(f, f in ['readAt'])\",\n      isLogbookNotificationType:\n        \"data.type == 'logbook_issue_assigned' || data.type == 'logbook_issue_due_soon' || data.type == 'logbook_issue_overdue' || data.type == 'logbook_resolution_submitted' || data.type == 'logbook_resolution_approved' || data.type == 'logbook_resolution_rejected' || data.type == 'logbook_resolution_correction_requested' || data.type == 'logbook_issue_reopened' || data.type == 'logbook_issue_recalled' || data.type == 'logbook_creator_update' || data.type == 'logbook_note_created' || data.type == 'logbook_announcement_created' || data.type == 'logbook_ack_required'\",\n    },\n  },\n\n  //";
if (!bindSection.includes(bindNeedle)) {
  console.log(JSON.stringify(bindSection.slice(0, 600)));
  throw new Error('bind needle missing');
}
const fixedBind = bindSection.replace(bindNeedle, bindRepl);
perms = perms.slice(0, bindIdx) + fixedBind;

perms = perms.replace(
  "  // Client create remains for assignment/due (canReview / approved). Resolution\n  // submitted notifications use Admin SDK (api/logbook-notify) so Staff submit\n  // Stage A never depends on notifications.create.",
  "  // Client create remains for non-logbook report notifs. Logbook_* types are\n  // Admin-only via /api/logbook-notify deliver_event (Hobby function limit)."
);

perms = perms.replace(
  "canSendStoreChat && data.senderUserId == auth.id && isOwnSenderProfile && storeIdValid && data.status == 'active' && messageTypeValid && bodySizeValid && mediaCoherent\"",
  "canSendStoreChat && data.senderUserId == auth.id && isOwnSenderProfile && storeIdValid && data.status == 'active' && messageTypeValid && bodySizeValid && mediaCoherent && data.messageType != 'logbook_system'\""
);
perms = perms.replace(
  "data.messageType == 'text' || data.messageType == 'giphy_media' || data.messageType == 'text_giphy\"",
  "data.messageType == 'text' || data.messageType == 'giphy_media' || data.messageType == 'text_giphy' || data.messageType == 'logbook_system\""
);
perms = perms.replace(
  "(data.messageType == 'text' && size(data.body) > 0 && data.giphyId == '') || (data.messageType == 'giphy_media' && data.giphyId != '' && data.giphyUrl != '') || (data.messageType == 'text_giphy' && size(data.body) > 0 && data.giphyId != '' && data.giphyUrl != '')\"",
  "((data.messageType == 'text' || data.messageType == 'logbook_system') && size(data.body) > 0 && data.giphyId == '') || (data.messageType == 'giphy_media' && data.giphyId != '' && data.giphyUrl != '') || (data.messageType == 'text_giphy' && size(data.body) > 0 && data.giphyId != '' && data.giphyUrl != '')\""
);

fs.writeFileSync('instant.perms.ts', perms);
console.log('perms', perms.includes('!isLogbookNotificationType'), perms.includes("!= 'logbook_system'"), perms.includes("|| data.messageType == 'logbook_system'"));
