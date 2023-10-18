// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils.js");
const { GUARDIAN_ADMIN, EMERGENCY_ADMIN } = require("../../Constants.js");

module.exports = async function (
  { _ },
  {
    ethers: {
      getContract,
      utils: { toUtf8Bytes, keccak256 },
    },
  },
) {
  const { adminAddress, guardianAddress, emergencyAdmins } = getConfig();
  if (adminAddress === undefined) throw new Error("adminAddress is undefined in config");
  if (guardianAddress === undefined) throw new Error("guardianAddress is undefined in config");
  if (!Array.isArray(emergencyAdmins)) throw new Error("emergencyAdmins must be an array in the config");

  let tx;

  // timelocks access
  const roles = ["PROPOSER_ROLE", "EXECUTOR_ROLE", "CANCELLER_ROLE"];
  for (const timelockName of ["BigTimelockAdmin", "MediumTimelockAdmin", "SmallTimelockAdmin"]) {
    const timelock = await getContract(timelockName);
    for (const role of roles) {
      const roleHash = keccak256(toUtf8Bytes(role));
      if (await timelock.hasRole(roleHash, adminAddress)) {
        console.log(`adminAddress already has ${role} in ${timelockName}`);
      } else {
        tx = await timelock.grantRole(roleHash, adminAddress);
        await tx.wait();
        console.log(`${role} is granted to admin in ${timelockName}`);
      }
    }
  }

  // registry access
  const registry = await getContract("Registry");

  if (await registry.hasRole(GUARDIAN_ADMIN, guardianAddress)) {
    console.log("guardianAddress already has GUARDIAN_ADMIN role in registry");
  } else {
    tx = await registry.grantRole(GUARDIAN_ADMIN, guardianAddress);
    await tx.wait();
    console.log("GUARDIAN_ADMIN role is granted to guardianAddress in registry");
  }

  if (emergencyAdmins.length === 0) {
    console.log("emergencyAdmins array in config is empty");
    return;
  }

  for (const admin of emergencyAdmins) {
    if (await registry.hasRole(EMERGENCY_ADMIN, admin)) {
      console.log(`${admin} already has EMERGENCY_ADMIN role in registry`);
    } else {
      tx = await registry.grantRole(EMERGENCY_ADMIN, admin);
      await tx.wait();
      console.log(`EMERGENCY_ADMIN role is granted to ${admin} in registry`);
    }
  }
};
