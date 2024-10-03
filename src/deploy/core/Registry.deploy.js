// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils");
const { SMALL_TIMELOCK_ADMIN, VAULT_ACCESS_ROLE, NO_FEE_ROLE } = require("../../Constants.js");

module.exports = async ({ run, ethers: { getNamedSigners, getContract } }) => {
  const { deployer } = await getNamedSigners();
  // TODO: Rename contract or task: Registry <-> PrimexRegistry
  const Registry = await run("deploy:Registry");
  if (Registry.newlyDeployed) {
    await run("AccessControl:AddRole", {
      role: "MEDIUM_TIMELOCK_ADMIN",
      account: deployer.address,
      registryAddress: Registry.address,
    });
    await run("AccessControl:AddRole", {
      role: "SMALL_TIMELOCK_ADMIN",
      account: deployer.address,
      registryAddress: Registry.address,
    });
    await run("AccessControl:AddRole", {
      role: "EMERGENCY_ADMIN",
      account: deployer.address,
      registryAddress: Registry.address,
    });

    const { guardianAddress, emergencyAdmins } = getConfig();
    if (guardianAddress !== undefined) {
      await run("AccessControl:AddRole", {
        role: "GUARDIAN_ADMIN",
        account: guardianAddress,
        registryAddress: Registry.address,
      });
    }
    if (Array.isArray(emergencyAdmins)) {
      for (const admin of emergencyAdmins) {
        await run("AccessControl:AddRole", {
          role: "EMERGENCY_ADMIN",
          account: admin,
          registryAddress: Registry.address,
        });
      }
    }
    const registry = await getContract("Registry");
    let tx = await registry.setRoleAdmin(VAULT_ACCESS_ROLE, SMALL_TIMELOCK_ADMIN);
    await tx.wait();
    tx = await registry.setRoleAdmin(NO_FEE_ROLE, SMALL_TIMELOCK_ADMIN);
    await tx.wait();
  }
};
module.exports.tags = ["Registry", "Test", "PrimexCore"];
module.exports.dependencies = ["Errors"];
