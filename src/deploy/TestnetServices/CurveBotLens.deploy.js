// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:CurveBotLens");
};

module.exports.tags = ["CurveBotLens", "Test", "TestnetService"];
