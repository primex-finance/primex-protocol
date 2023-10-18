// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, ethers: { getContract } }) => {
  if (process.env.TEST) {
    const PriceFeedUpdaterTestService = await getContract("PriceFeedUpdaterTestService");
    await run("deploy:PrimexAggregatorV3TestService", { updater: PriceFeedUpdaterTestService.address });
  }
};
module.exports.tags = ["PrimexAggregatorV3TestService", "Test"];
module.exports.dependencies = ["PriceFeedUpdaterTestService"];
