const dotenv = require("dotenv");

dotenv.config();

module.exports = {
  port: Number(process.env.PORT || 4000),
  clientUrl: process.env.CLIENT_URL || "*",
  mongoUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/proximo",
  redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
};
