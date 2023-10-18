// SPDX-License-Identifier: BUSL-1.1
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants.js");

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    ethers: {
      getContract,
      utils: { toUtf8Bytes, keccak256 },
    },
  },
) {
  const { deployer } = await getNamedAccounts();

  let tx;

  // epmx access
  const epmx = await getContract("EPMXToken");

  if (await epmx.isWhitelisted(deployer)) {
    tx = await epmx.removeAddressFromWhitelist(deployer);
    await tx.wait();
    console.log("Deployer was removed from EPMX whitelist");
  } else {
    console.log("Deployer doesn't have access in EPMX");
  }

  // timelocks access
  const roles = ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE", "TIMELOCK_ADMIN_ROLE"];
  for (const timelockName of ["BigTimelockAdmin", "MediumTimelockAdmin", "SmallTimelockAdmin"]) {
    const timelock = await getContract(timelockName);
    for (const role of roles) {
      tx = await timelock.renounceRole(keccak256(toUtf8Bytes(role)), deployer);
      await tx.wait();
      console.log(`Deployer renounced ${role} role in ${timelockName}`);
    }
  }

  // registry access
  const registry = await getContract("Registry");

  tx = await registry.renounceRole(BIG_TIMELOCK_ADMIN, deployer);
  await tx.wait();
  console.log("Deployer renounced BIG_TIMELOCK_ADMIN role in registry");

  tx = await registry.renounceRole(MEDIUM_TIMELOCK_ADMIN, deployer);
  await tx.wait();
  console.log("Deployer renounced MEDIUM_TIMELOCK_ADMIN role in registry");

  tx = await registry.renounceRole(SMALL_TIMELOCK_ADMIN, deployer);
  await tx.wait();
  console.log("Deployer renounced SMALL_TIMELOCK_ADMIN role in registry");

  tx = await registry.renounceRole(EMERGENCY_ADMIN, deployer);
  await tx.wait();
  console.log("Deployer renounced EMERGENCY_ADMIN role in registry");
};
