const { createClient } = require("redis");
const { redisUrl } = require("../config");

async function createRedisClients() {
  const command = createClient({ url: redisUrl });
  const publisher = command.duplicate();
  const subscriber = command.duplicate();

  await Promise.all([command.connect(), publisher.connect(), subscriber.connect()]);

  return { command, publisher, subscriber };
}

module.exports = {
  createRedisClients,
};
