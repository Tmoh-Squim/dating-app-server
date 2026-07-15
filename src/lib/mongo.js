const mongoose = require("mongoose");
const { mongoUri } = require("../config");

async function connectMongo() {
  mongoose.set("strictQuery", true);
  await mongoose.connect(mongoUri);
  return mongoose.connection;
}

module.exports = {
  connectMongo,
};
