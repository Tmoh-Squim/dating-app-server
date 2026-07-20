const { createClient } = require("redis");
const { redisUrl } = require("../config");

async function createRedisClients() {
  const command = createClient({ url: redisUrl });
  const publisher = command.duplicate();
  const subscriber = command.duplicate();
  const adapterPublisher = command.duplicate();
  const adapterSubscriber = command.duplicate();

  await Promise.all([
    command.connect(),
    publisher.connect(),
    subscriber.connect(),
    adapterPublisher.connect(),
    adapterSubscriber.connect(),
  ]);

  return { command, publisher, subscriber, adapterPublisher, adapterSubscriber };
}

module.exports = {
  createRedisClients,
};
