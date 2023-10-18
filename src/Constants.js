// SPDX-License-Identifier: BUSL-1.1
const {
  utils: { toUtf8Bytes, keccak256 },
  constants: { HashZero },
} = require("ethers");

const SECONDS_PER_DAY = 24 * 60 * 60;

// admin roles
const BIG_TIMELOCK_ADMIN = HashZero;
const MEDIUM_TIMELOCK_ADMIN = keccak256(toUtf8Bytes("MEDIUM_TIMELOCK_ADMIN"));
const SMALL_TIMELOCK_ADMIN = keccak256(toUtf8Bytes("SMALL_TIMELOCK_ADMIN"));
const EMERGENCY_ADMIN = keccak256(toUtf8Bytes("EMERGENCY_ADMIN"));
const GUARDIAN_ADMIN = keccak256(toUtf8Bytes("GUARDIAN_ADMIN"));
const NFT_MINTER = keccak256(toUtf8Bytes("NFT_MINTER"));
const WHITELIST_ADMIN = keccak256(toUtf8Bytes("WHITELIST_ADMIN"));
const TRUSTED_TOLERABLE_LIMIT_ROLE = keccak256(toUtf8Bytes("TRUSTED_TOLERABLE_LIMIT_ROLE"));

// inter-contract interactions roles
const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
const PM_ROLE = keccak256(toUtf8Bytes("PM_ROLE"));
const LOM_ROLE = keccak256(toUtf8Bytes("LOM_ROLE"));
const BATCH_MANAGER_ROLE = keccak256(toUtf8Bytes("BATCH_MANAGER_ROLE"));

module.exports = {
  BIG_TIMELOCK_ADMIN,
  MEDIUM_TIMELOCK_ADMIN,
  SMALL_TIMELOCK_ADMIN,
  EMERGENCY_ADMIN,
  GUARDIAN_ADMIN,
  NFT_MINTER,
  WHITELIST_ADMIN,
  NO_FEE_ROLE,
  VAULT_ACCESS_ROLE,
  PM_ROLE,
  LOM_ROLE,
  BATCH_MANAGER_ROLE,
  TRUSTED_TOLERABLE_LIMIT_ROLE,
  SECONDS_PER_DAY,
};
