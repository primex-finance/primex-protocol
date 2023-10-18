// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getNamedSigners,
    getContract,
    utils: { keccak256, toUtf8Bytes },
  },
  deployments: { fixture },
} = require("hardhat");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");
process.env.TEST = true;
describe("PrimexRegsitry_unit", function () {
  let caller, registry, ErrorsLibrary;
  before(async function () {
    await fixture(["Test"]);
    registry = await getContract("Registry");
    ({ caller } = await getNamedSigners());
    ErrorsLibrary = await getContract("Errors");
  });

  describe("deploy", function () {
    it("Admin of SMALL_TIMELOCK_ADMIN is MEDIUM_TIMELOCK_ADMIN", async function () {
      expect(await registry.getRoleAdmin(SMALL_TIMELOCK_ADMIN)).to.equal(MEDIUM_TIMELOCK_ADMIN);
    });
    it("Admin of EMERGENCY_ADMIN is SMALL_TIMELOCK_ADMIN", async function () {
      expect(await registry.getRoleAdmin(EMERGENCY_ADMIN)).to.equal(SMALL_TIMELOCK_ADMIN);
    });
  });

  describe("setRoleAdmin", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call setRoleAdmin", async function () {
      await expect(registry.connect(caller).setRoleAdmin(MEDIUM_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN)).to.be.revertedWith(
        `AccessControl: account ${caller.address.toLowerCase()} is missing role ${BIG_TIMELOCK_ADMIN}`,
      );
    });
    it("Should set new admin role", async function () {
      await registry.setRoleAdmin(MEDIUM_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN);
      expect(await registry.getRoleAdmin(MEDIUM_TIMELOCK_ADMIN)).to.equal(MEDIUM_TIMELOCK_ADMIN);
    });
  });

  describe("setRolesForContractsOnly and removeRolesForContractsOnly", function () {
    let setRoles, removeRoles, VAULT_ACCESS_ROLE, BATCH_MANAGER_ROLE, NO_FEE_ROLE;
    before(async function () {
      VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      BATCH_MANAGER_ROLE = keccak256(toUtf8Bytes("BATCH_MANAGER_ROLE"));
      NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
      setRoles = [VAULT_ACCESS_ROLE, BATCH_MANAGER_ROLE, NO_FEE_ROLE];
      removeRoles = [BATCH_MANAGER_ROLE, NO_FEE_ROLE];
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setRolesForContractsOnly", async function () {
      await expect(registry.connect(caller).setRolesForContractsOnly(setRoles)).to.be.revertedWith(
        `AccessControl: account ${caller.address.toLowerCase()} is missing role ${BIG_TIMELOCK_ADMIN}`,
      );
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call removeRolesForContractsOnly", async function () {
      await expect(registry.connect(caller).removeRolesForContractsOnly(removeRoles)).to.be.revertedWith(
        `AccessControl: account ${caller.address.toLowerCase()} is missing role ${BIG_TIMELOCK_ADMIN}`,
      );
    });

    it("Should setRolesForContractsOnly", async function () {
      await registry.setRolesForContractsOnly(setRoles);
      expect(await registry.isRoleForContractsOnly(VAULT_ACCESS_ROLE)).to.equal(true);
      expect(await registry.isRoleForContractsOnly(BATCH_MANAGER_ROLE)).to.equal(true);
      expect(await registry.isRoleForContractsOnly(NO_FEE_ROLE)).to.equal(true);
      expect(await registry.isRoleForContractsOnly(BIG_TIMELOCK_ADMIN)).to.equal(false);
    });

    it("Should removeRolesForContractsOnly", async function () {
      await registry.removeRolesForContractsOnly(removeRoles);
      expect(await registry.isRoleForContractsOnly(VAULT_ACCESS_ROLE)).to.equal(true);
      expect(await registry.isRoleForContractsOnly(BATCH_MANAGER_ROLE)).to.equal(false);
      expect(await registry.isRoleForContractsOnly(NO_FEE_ROLE)).to.equal(false);
    });
  });

  describe("grantRole", function () {
    let VAULT_ACCESS_ROLE, NO_FEE_ROLE;
    before(async function () {
      VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
      NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
      await registry.setRolesForContractsOnly([VAULT_ACCESS_ROLE]);
    });

    it("Should revert for a granting role EOA if the role is designed for contracts only", async function () {
      await expect(registry.grantRole(VAULT_ACCESS_ROLE, caller.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_IS_NOT_CONTRACT",
      );
    });

    it("Should grantRole for the contract if the role is designed for contracts only", async function () {
      expect(await registry.grantRole(VAULT_ACCESS_ROLE, ErrorsLibrary.address));
    });

    it("Should grantRole for any account if isRoleForContractsOnly equal false", async function () {
      expect(await registry.isRoleForContractsOnly(NO_FEE_ROLE)).to.equal(false);
      expect(await registry.grantRole(NO_FEE_ROLE, caller.address));
      expect(await registry.grantRole(NO_FEE_ROLE, ErrorsLibrary.address));
    });
  });
});
