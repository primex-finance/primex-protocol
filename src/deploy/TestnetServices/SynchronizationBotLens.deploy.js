// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:SynchronizationBotLens");
};

module.exports.tags = ["SynchronizationBotLens", "Test", "TestnetService"];
