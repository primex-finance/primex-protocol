// SPDX-License-Identifier: BUSL-1.1
const { userAccounts } = require("../utils/accountAddresses");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN } = require("../../Constants.js");

module.exports = async function (
  { noCompile },
  {
    run,
    getNamedAccounts,
    ethers: {
      getContract,
      utils: { parseEther },
    },
  },
) {
  // if deploy on ZK_SYNC2, disable docgen plugin
  await run("deployCore", { noCompile: noCompile });

  await run("setup:SpotTradingRewardDistributor");
  await run("setup:earlyRewardsInBuckets");

  await run("deploy", { tags: "TestnetService", noCompile: true });
  await run("setup:PriceFeeds"); // only for devnets and testnets

  const pmx = await getContract("EPMXToken");
  let tx;

  const { deployer } = await getNamedAccounts();
  // add access to transfer epmx to testnet/devnet admins
  tx = await pmx.addAddressesToWhitelist([deployer, userAccounts[17]]);
  await tx.wait();
  for (const acc of userAccounts) {
    tx = await pmx.transfer(acc, parseEther("1000"));
    await tx.wait();
  }
  tx = await pmx.transfer(userAccounts[17], parseEther("1000000"));
  await tx.wait();

  if (process.env.FUZZING) {
    tx = await pmx.transfer(process.env.FUZZING_CONTRACT_ADDRESS, await pmx.balanceOf(deployer));
    await tx.wait();
  }
  // add admin roles to userAccounts[17]
  const registry = await getContract("Registry");

  // remove RolesForContractsOnly for Testnet only
  const txRemoveRolesForContractsOnly = await registry.removeRolesForContractsOnly([
    BIG_TIMELOCK_ADMIN,
    MEDIUM_TIMELOCK_ADMIN,
    SMALL_TIMELOCK_ADMIN,
  ]);
  await txRemoveRolesForContractsOnly.wait();

  await run("AccessControl:AddRole", {
    role: "DEFAULT_ADMIN_ROLE",
    account: userAccounts[17],
    registryAddress: registry.address,
  });
  await run("AccessControl:AddRole", {
    role: "MEDIUM_TIMELOCK_ADMIN",
    account: userAccounts[17],
    registryAddress: registry.address,
  });
  await run("AccessControl:AddRole", {
    role: "SMALL_TIMELOCK_ADMIN",
    account: userAccounts[17],
    registryAddress: registry.address,
  });
  await run("AccessControl:AddRole", {
    role: "EMERGENCY_ADMIN",
    account: userAccounts[17],
    registryAddress: registry.address,
  });

  console.log("=== testnet services deployed ===");
};
