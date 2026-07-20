const mongoose = require("mongoose");
const { mongoUri } = require("../config");

async function connectMongo() {
  mongoose.set("strictQuery", true);
  const maskedUri = maskMongoUri(mongoUri);
  console.log(`[mongo] connecting to ${maskedUri}`);
  await mongoose.connect(mongoUri);
  const { host, name, readyState } = mongoose.connection;
  console.log(`[mongo] connected host=${host || "unknown"} db=${name || "unknown"} state=${readyState}`);
  return mongoose.connection;
}

function maskMongoUri(uri) {
  return uri.replace(/\/\/([^:/?#]+):([^@/]+)@/, "//$1:***@");
}

module.exports = {
  connectMongo,
};
