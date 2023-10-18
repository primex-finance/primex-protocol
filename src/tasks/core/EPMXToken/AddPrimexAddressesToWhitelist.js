// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { ethers: { getContract } }) {
  async function getAddressFromName(artifactName) {
    return (await getContract(artifactName)).address;
  }
  const array = [];
  array.push(await getAddressFromName("TraderBalanceVault"));
  array.push(await getAddressFromName("LiquidityMiningRewardDistributor"));
  array.push(await getAddressFromName("SpotTradingRewardDistributor"));
  array.push(await getAddressFromName("ActivityRewardDistributor"));
  array.push(await getAddressFromName("BigTimelockAdmin"));
  array.push(await getAddressFromName("MediumTimelockAdmin"));
  array.push(await getAddressFromName("SmallTimelockAdmin"));
  array.push(await getAddressFromName("Treasury"));

  const epmx = await getContract("EPMXToken");
  const tx = await epmx.addAddressesToWhitelist(array);
  await tx.wait();

  console.log("=== Access to transfer EPMX is added ===");
};
