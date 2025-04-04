// (c) 2024 Primex.finance
// SPDX-License-Identifier: BUSL-1.1
pragma solidity 0.8.26;
import {IArbGasInfo} from "./interfaces/IArbGasInfo.sol";
import {IOVM_GasPriceOracle} from "./interfaces/IOVM_GasPriceOracle.sol";

// admin roles
bytes32 constant BIG_TIMELOCK_ADMIN = 0x00; // It's primary admin.
bytes32 constant MEDIUM_TIMELOCK_ADMIN = keccak256("MEDIUM_TIMELOCK_ADMIN");
bytes32 constant SMALL_TIMELOCK_ADMIN = keccak256("SMALL_TIMELOCK_ADMIN");
bytes32 constant EMERGENCY_ADMIN = keccak256("EMERGENCY_ADMIN");
bytes32 constant GUARDIAN_ADMIN = keccak256("GUARDIAN_ADMIN");
bytes32 constant NFT_MINTER = keccak256("NFT_MINTER");
bytes32 constant TRUSTED_TOLERABLE_LIMIT_ROLE = keccak256("TRUSTED_TOLERABLE_LIMIT_ROLE");

// inter-contract interactions roles
bytes32 constant NO_FEE_ROLE = keccak256("NO_FEE_ROLE");
bytes32 constant VAULT_ACCESS_ROLE = keccak256("VAULT_ACCESS_ROLE");
bytes32 constant PM_ROLE = keccak256("PM_ROLE");
bytes32 constant LOM_ROLE = keccak256("LOM_ROLE");
bytes32 constant BATCH_MANAGER_ROLE = keccak256("BATCH_MANAGER_ROLE");
bytes32 constant FLASH_LOAN_MANAGER_ROLE = keccak256("FLASH_LOAN_MANAGER_ROLE");
bytes32 constant FLASH_LOAN_FREE_BORROWER_ROLE = keccak256("FLASH_LOAN_FREE_BORROWER_ROLE");

// token constants
address constant NATIVE_CURRENCY = address(uint160(bytes20(keccak256("NATIVE_CURRENCY"))));
address constant USD = 0x0000000000000000000000000000000000000348;
address constant NATIVE_CURRENCY_CURVE = 0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE;
uint256 constant USD_MULTIPLIER = 10 ** (18 - 8); // usd decimals in chainlink is 8
uint8 constant MAX_ASSET_DECIMALS = 18;

// time constants
uint256 constant SECONDS_PER_YEAR = 365 days;
uint256 constant SECONDS_PER_DAY = 1 days;
uint256 constant HOUR = 1 hours;
uint256 constant TEN_WAD = 10 ether;

// constants for Arbitrum payment model
IArbGasInfo constant ARB_NITRO_ORACLE = IArbGasInfo(0x000000000000000000000000000000000000006C);
uint256 constant TRANSACTION_METADATA_BYTES = 140;

IOVM_GasPriceOracle constant OVM_GASPRICEORACLE = IOVM_GasPriceOracle(0x420000000000000000000000000000000000000F);

uint256 constant GAS_FOR_BYTE = 16;

// Magic values
uint256 constant TRADER_MAGIC_TIER = uint256(keccak256("TRADER_MAGIC_TIER"));
uint256 constant LENDER_MAGIC_TIER = uint256(keccak256("LENDER_MAGIC_TIER"));
uint256 constant FARMING_MAGIC_TIER = uint256(keccak256("FARMING_MAGIC_TIER"));
