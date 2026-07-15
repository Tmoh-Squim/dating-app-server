# Proximo Server

Node.js realtime backend for the Proximo dating app.

## Stack

- `Express` for health and discovery endpoints
- `Socket.IO` for realtime messaging, presence, swipe results, and call signaling
- `MongoDB` for users, swipes, matches, conversations, messages, and call sessions
- `Redis` for presence, typing state, unread counters, and pub/sub fanout

## Environment

Copy `.env.example` into `.env` and set:

- `PORT`
- `CLIENT_URL`
- `MONGODB_URI`
- `REDIS_URL`

## Run

```bash
npm install
npm run dev
```

## Socket events

- `swipe:action`
- `swipe:result`
- `match:created`
- `conversation:join`
- `conversation:history`
- `message:send`
- `message:new`
- `typing:start`
- `typing:stop`
- `typing:update`
- `call:start`
- `call:incoming`
- `call:answer`
- `call:reject`
- `call:end`
- `webrtc:offer`
- `webrtc:answer`
- `webrtc:ice-candidate`
