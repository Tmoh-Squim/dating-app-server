const cors = require("cors");
const express = require("express");
const http = require("http");
const { createAdapter } = require("@socket.io/redis-adapter");
const { Server } = require("socket.io");
const { clientUrl, port } = require("./config");
const {
  AppError,
  completeOnboarding,
  loginAccount,
  loginPhoneAccount,
  loginPhoneWithOtp,
  loginWithGoogle,
  registerAccount,
  registerPhoneAccount,
  requestOtp,
  verifyOtp,
} = require("./services/auth-service");
const { absoluteUploadDir, profileImageUpload } = require("./lib/uploads");
const { connectMongo } = require("./lib/mongo");
const { createRedisClients } = require("./lib/redis");
const { buildBootstrapPayload, ensureSeedData } = require("./services/bootstrap-service");
const { removeProfileImages, toBoolean, uploadProfileImages } = require("./services/upload-service");
const { registerRealtimeHandlers } = require("./socket/registerRealtimeHandlers");
const { registerSocketHandlers } = require("./socket/registerSocketHandlers");

function respondAuthError(response, context, error, fallbackMessage) {
  console.error(`[${context}] failed`, error);
  if (error instanceof AppError) {
    response.status(error.status).json({ message: error.publicMessage });
    return;
  }
  response.status(500).json({ message: fallbackMessage });
}

async function bootstrap() {
  await connectMongo();
  const redis = await createRedisClients();

  const app = express();
  app.use(cors({ origin: clientUrl === "*" ? true : clientUrl, credentials: true }));
  app.use(express.json());
  app.use("/uploads", express.static(absoluteUploadDir, {
    fallthrough: false,
    index: false,
    maxAge: "7d",
  }));

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
      respondAuthError(response, "auth/register", error, "Unable to create account right now. Please try again later.");
    }
  });

  app.post("/api/auth/login", async (request, response) => {
    try {
      const account = await loginAccount(request.body.email, request.body.password);
      response.json(account);
    } catch (error) {
      respondAuthError(response, "auth/login", error, "Unable to sign in right now. Please try again later.");
    }
  });

  app.post("/api/auth/google", async (request, response) => {
    try {
      const account = await loginWithGoogle(request.body.credential);
      response.json(account);
    } catch (error) {
      respondAuthError(response, "auth/google", error, "Unable to sign in with Google right now. Please try again later.");
    }
  });

  app.post("/api/auth/otp/request", async (request, response) => {
    try {
      const result = await requestOtp(request.body);
      response.status(201).json(result);
    } catch (error) {
      respondAuthError(response, "auth/otp/request", error, "Unable to send the verification code right now. Please try again later.");
    }
  });

  app.post("/api/auth/otp/verify", async (request, response) => {
    try {
      const result = await verifyOtp(request.body);
      response.json(result);
    } catch (error) {
      respondAuthError(response, "auth/otp/verify", error, "Unable to verify the code right now. Please try again later.");
    }
  });

  app.post("/api/auth/phone/register", async (request, response) => {
    try {
      const account = await registerPhoneAccount(request.body);
      response.status(201).json(account);
    } catch (error) {
      respondAuthError(response, "auth/phone/register", error, "Unable to create account right now. Please try again later.");
    }
  });

  app.post("/api/auth/phone/login", async (request, response) => {
    try {
      const account = await loginPhoneAccount(request.body.phone, request.body.password);
      response.json(account);
    } catch (error) {
      respondAuthError(response, "auth/phone/login", error, "Unable to sign in right now. Please try again later.");
    }
  });

  app.post("/api/auth/phone/login-otp", async (request, response) => {
    try {
      const account = await loginPhoneWithOtp(request.body);
      response.json(account);
    } catch (error) {
      respondAuthError(response, "auth/phone/login-otp", error, "Unable to sign in right now. Please try again later.");
    }
  });

  app.post("/api/auth/onboarding/complete", async (request, response) => {
    try {
      const account = await completeOnboarding(request.body);
      response.json(account);
    } catch (error) {
      respondAuthError(response, "auth/onboarding/complete", error, "Unable to save your profile right now. Please try again later.");
    }
  });

  app.post("/api/users/:userId/profile-images", profileImageUpload.array("images", 6), async (request, response) => {
    try {
      const result = await uploadProfileImages({
        userId: request.params.userId,
        files: request.files || [],
        replaceAll: toBoolean(request.body.replaceAll),
        replaceAvatar: request.body.replaceAvatar == null ? true : toBoolean(request.body.replaceAvatar),
      });
      response.status(201).json(result);
    } catch (error) {
      respondAuthError(response, "users/profile-images/upload", error, "Unable to upload images right now. Please try again later.");
    }
  });

  app.delete("/api/users/:userId/profile-images", async (request, response) => {
    try {
      const result = await removeProfileImages({
        userId: request.params.userId,
        imageUrls: request.body.imageUrls,
      });
      response.json(result);
    } catch (error) {
      respondAuthError(response, "users/profile-images/delete", error, "Unable to remove images right now. Please try again later.");
    }
  });

  const server = http.createServer(app);
  const io = new Server(server, {
    cors: {
      origin: clientUrl === "*" ? true : clientUrl,
      credentials: true,
    },
  });
  io.adapter(createAdapter(redis.adapterPublisher, redis.adapterSubscriber));

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
