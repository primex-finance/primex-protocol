// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ keepers, payees }, { run, getNamedAccounts, ethers: { getContract } }) {
  const { deployer, holder } = await getNamedAccounts();

  if (!keepers || !payees) {
    keepers = JSON.stringify([deployer, holder]);
    payees = JSON.stringify([deployer, holder]);
  }

  const LinkTokenContract = await getContract("LinkToken");

  const KeeperRegistryContract = await getContract("KeeperRegistry");

  const Counter = await run("deploy:CounterUpKeep");

  const amountToUpkeep = (await LinkTokenContract.balanceOf(deployer)).div(2).toString();

  await run("KeeperRegistry:registerUpkeepAndAddFunds", {
    keeperRegistryAddress: KeeperRegistryContract.address,
    linkTokenAddress: LinkTokenContract.address,
    target: Counter.address,
    admin: deployer,
    amount: amountToUpkeep,
  });

  await run("KeeperRegistry:setKeepers", {
    payees: payees,
    keepers: keepers,
    keeperRegistryAddress: KeeperRegistryContract.address,
  });
};
