const cors = require("cors");
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const { clientUrl, port } = require("./config");
const { connectMongo } = require("./lib/mongo");
const { createRedisClients } = require("./lib/redis");
const { buildBootstrapPayload, ensureSeedData, loginAccount, registerAccount } = require("./services/bootstrap-service");
const { registerRealtimeHandlers } = require("./socket/registerRealtimeHandlers");
const { registerSocketHandlers } = require("./socket/registerSocketHandlers");

async function bootstrap() {
  await connectMongo();
  const redis = await createRedisClients();

  const app = express();
  app.use(cors({ origin: clientUrl === "*" ? true : clientUrl, credentials: true }));
  app.use(express.json());

  app.get("/health", async (_request, response) => {
    const redisOk = await redis.command.ping();
    response.json({
      ok: true,
      service: "proximo-server",
      mongoState: 1,
      redis: redisOk,
      now: new Date().toISOString(),
    });
  });

  app.get("/api/discover", (_request, response) => {
    response.json({
      features: [
        "swipe matching",
        "realtime messaging",
        "typing indicators",
        "presence",
        "voice call signaling",
        "video call signaling",
      ],
      transport: {
        socketIoNamespace: "/",
        auth: "socket.handshake.auth.userId",
        websocketPath: "/ws",
      },
      storage: {
        mongoCollections: ["users", "swipes", "matches", "conversations", "messages", "callsessions"],
        redisKeys: ["presence:*", "user:sockets:*", "typing:*", "unread:*"],
      },
    });
  });

  app.get("/api/bootstrap", async (request, response) => {
    const userId = String(request.query.userId || "");
    await ensureSeedData();
    const payload = await buildBootstrapPayload(userId);
    response.json(payload);
  });

  app.post("/api/auth/register", async (request, response) => {
    try {
      const created = await registerAccount(request.body);
      response.status(201).json(created);
    } catch (error) {
      console.error("[auth/register] failed", error);
      const isUserError = error.message === "Email already registered";
      response.status(isUserError ? 400 : 500).json({
        message: isUserError ? error.message : "Unable to create account right now. Please try again later.",
      });
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    try {
      const account = await loginAccount(request.body.email, request.body.password);
      response.json(account);
    } catch (error) {
      console.error("[auth/login] failed", error);
      const isUserError = error.message === "Invalid email or password";
      response.status(isUserError ? 401 : 500).json({
        message: isUserError ? error.message : "Unable to sign in right now. Please try again later.",
      });
    }
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: clientUrl === "*" ? true : clientUrl,
      credentials: true,
    },
  });

  registerSocketHandlers(io, redis);
  registerRealtimeHandlers(server);

  server.listen(port, () => {
    console.log(`Proximo server running on http://localhost:${port}`);
  });
}

bootstrap().catch(error => {
  console.error("Failed to start Proximo server", error);
  process.exit(1);
});
