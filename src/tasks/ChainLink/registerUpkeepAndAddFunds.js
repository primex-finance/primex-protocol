// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { keeperRegistryAddress, linkTokenAddress, target, gasLimit, admin, checkData, amount },
  { getNamedAccounts, ethers: { getContractAt } },
) {
  const { deployer } = await getNamedAccounts();

  const KeeperRegistryContract = await getContractAt("KeeperRegistry", keeperRegistryAddress);

  if ((await KeeperRegistryContract.owner()) !== deployer) throw new Error("only KeeperRegistry owner can execute registerUpkeep");

  let tx = await KeeperRegistryContract.registerUpkeep(target, gasLimit, admin, checkData);
  const txReceipt = await tx.wait();
  const eventUpkeepRegistered = txReceipt.events?.filter(x => {
    return x.event === "UpkeepRegistered";
  })[0].args;

  const LinkTokenContract = await getContractAt("LinkToken", linkTokenAddress);
  tx = await LinkTokenContract.approve(KeeperRegistryContract.address, amount);
  await tx.wait();
  tx = await KeeperRegistryContract.addFunds(eventUpkeepRegistered.id, amount);
  await tx.wait();
};
