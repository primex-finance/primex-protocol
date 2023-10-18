// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run, getNamedAccounts, ethers: { getContract } }) => {
  if (process.env.TEST) {
    await run("EPMXToken:addPrimexAddressesToWhitelist");
    // only for test add deployer to epmx whitelist
    const { deployer } = await getNamedAccounts();
    const pmx = await getContract("EPMXToken");
    const tx = await pmx.addAddressToWhitelist(deployer);
    await tx.wait();
  }
};

module.exports.tags = ["Test"];
module.exports.dependencies = [
  "Timelocks",
  "LiquidityMiningRewardDistributor",
  "SpotTradingRewardDistributor",
  "ActivityRewardDistributor",
  "TraderBalanceVault",
  "Treasury",
  "EPMXToken",
];
