// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run, ethers: { getContract } }) => {
  const errorsLibrary = await getContract("Errors");

  await run("deploy:BalancerBotLens", {
    errorsLibrary: errorsLibrary.address,
  });
};

module.exports.tags = ["BalancerBotLens", "Test", "TestnetService"];
module.exports.dependencies = ["Errors"];
