const CallSession = require("../models/CallSession");
const Conversation = require("../models/Conversation");
const Message = require("../models/Message");

function computeCallMessageStatus(call) {
  if (call.status === "accepted") return "accepted";
  if (call.status === "rejected") return "rejected";
  if (call.status === "missed") return "missed";
  if (call.status === "cancelled") return "cancelled";
  if (call.status === "ended") {
    return Number(call.durationSeconds || 0) > 0 || call.acceptedAt ? "completed" : "cancelled";
  }
  return "started";
}

function computeCallDurationSeconds(call) {
  const end = call.endedAt ? new Date(call.endedAt).getTime() : Date.now();
  const start = call.acceptedAt ? new Date(call.acceptedAt).getTime() : new Date(call.startedAt).getTime();
  return Math.max(0, Math.round((end - start) / 1000));
}

function formatCallDuration(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function buildCallEventBody({ callType, callStatus, durationSeconds = 0 }) {
  const icon = callType === "video" ? "🎥" : "📞";
  const label = callType === "video" ? "Video call" : "Voice call";
  if (callStatus === "rejected") return `${icon} Rejected ${label.toLowerCase()}`;
  if (callStatus === "missed") return `${icon} Missed ${label.toLowerCase()}`;
  if (callStatus === "cancelled") return `${icon} Cancelled ${label.toLowerCase()}`;
  if ((callStatus === "completed" || callStatus === "accepted") && durationSeconds > 0) {
    return `${icon} ${label} · ${formatCallDuration(durationSeconds)}`;
  }
  if (callStatus === "accepted") return `${icon} Connected ${label.toLowerCase()}`;
  return `${icon} Started ${label.toLowerCase()}`;
}

async function touchConversation(conversationId) {
  await Conversation.findOneAndUpdate(
    { _id: conversationId },
    { lastMessageAt: new Date() },
  );
}

async function createCallSessionWithMessage({
  conversationId,
  callerId,
  calleeId,
  callType,
}) {
  const call = await CallSession.create({
    conversationId,
    callerId,
    calleeId,
    type: callType,
  });

  const message = await Message.create({
    conversationId,
    senderId: callerId,
    recipientId: calleeId,
    type: "call_event",
    body: buildCallEventBody({ callType, callStatus: "started" }),
    callId: String(call._id),
    callMediaType: callType,
    callStatus: "started",
    callDurationSeconds: 0,
  });

  call.callMessageId = String(message._id);
  await call.save();
  await touchConversation(conversationId);

  return { call, message };
}

async function updateCallSessionWithMessage({
  callId,
  status,
  actorId = "",
}) {
  const call = await CallSession.findById(callId);
  if (!call) {
    throw new Error("Call session not found");
  }

  if (status === "accepted") {
    call.status = "accepted";
    call.acceptedAt = new Date();
    call.endedAt = null;
    call.durationSeconds = 0;
  } else if (status === "rejected") {
    call.status = "rejected";
    call.endedAt = new Date();
    call.durationSeconds = 0;
  } else if (status === "missed") {
    call.status = "missed";
    call.endedAt = new Date();
    call.durationSeconds = 0;
  } else if (status === "ended") {
    call.endedAt = new Date();
    call.durationSeconds = computeCallDurationSeconds(call);
    call.status = call.acceptedAt || call.durationSeconds > 0 ? "ended" : "cancelled";
  }

  await call.save();

  let message = null;
  if (call.callMessageId) {
    const callStatus = computeCallMessageStatus(call);
    message = await Message.findByIdAndUpdate(
      call.callMessageId,
      {
        senderId: actorId || call.callerId,
        recipientId: actorId === call.calleeId ? call.callerId : call.calleeId,
        body: buildCallEventBody({
          callType: call.type,
          callStatus,
          durationSeconds: Number(call.durationSeconds || 0),
        }),
        callStatus,
        callDurationSeconds: Number(call.durationSeconds || 0),
      },
      { new: true },
    );
  }

  await touchConversation(call.conversationId);
  return { call, message };
}

async function attachCallRecording({
  callId,
  file,
  kind,
  mimeType = "",
  durationSeconds = 0,
  buildPublicUploadUrl,
}) {
  const call = await CallSession.findById(callId);
  if (!call) {
    throw new Error("Call session not found");
  }
  if (!file?.path) {
    throw new Error("Select a call recording to upload");
  }

  const normalizedKind = kind === "video" ? "video" : "audio";
  call.recordings.push({
    kind: normalizedKind,
    url: buildPublicUploadUrl(file.path),
    mimeType: String(mimeType || file.mimetype || "").trim(),
    durationSeconds: Math.max(0, Number(durationSeconds) || 0),
  });
  const kinds = new Set(call.recordings.map(recording => recording.kind));
  call.recordingStatus = kinds.size > 1 ? "uploaded" : "partial";
  await call.save();

  return call;
}

module.exports = {
  attachCallRecording,
  createCallSessionWithMessage,
  updateCallSessionWithMessage,
};
