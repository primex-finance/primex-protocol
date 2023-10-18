// SPDX-License-Identifier: BUSL-1.1
const {
  BIG_TIMELOCK_ADMIN,
  MEDIUM_TIMELOCK_ADMIN,
  SMALL_TIMELOCK_ADMIN,
  GUARDIAN_ADMIN,
  NO_FEE_ROLE,
  VAULT_ACCESS_ROLE,
  PM_ROLE,
  LOM_ROLE,
  BATCH_MANAGER_ROLE,
} = require("../../Constants.js");

module.exports = async function ({ _ }, { ethers: { getContract } }) {
  const registry = await getContract("Registry");
  const roles = [
    BIG_TIMELOCK_ADMIN,
    MEDIUM_TIMELOCK_ADMIN,
    SMALL_TIMELOCK_ADMIN,
    GUARDIAN_ADMIN,
    NO_FEE_ROLE,
    VAULT_ACCESS_ROLE,
    PM_ROLE,
    LOM_ROLE,
    BATCH_MANAGER_ROLE,
  ];

  const txSetRolesForContractsOnly = await registry.setRolesForContractsOnly(roles);
  await txSetRolesForContractsOnly.wait();

  console.log("Roles are intended only for contracts have been set");
};
