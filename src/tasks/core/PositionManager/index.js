// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:PositionManager", "Deploy PositionManager contract", require("./positionManager.deploy"))
  // addresses
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("registry", "The address of registry contract")
  .addParam("traderBalanceVault", "The address of TraderBalanceVault contract")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("positionLibrary", "The address of PositionLibrary library")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addParam("keeperRewardDistributor", "The address of the KeeperRewardDistributor")
  .addParam("positionManagerExtension", "The address of the PositionManagerExtension")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  // setters
  .addParam(
    "defaultOracleTolerableLimit",
    "Default difference between dex price and oracle price. It's used if pair does not have its own value configured",
  )
  .addParam(
    "oracleTolerableLimitMultiplier",
    "Raising oracleTolerableLimit for trusted addresses to close positions with a large price impact",
  )
  .addParam(
    "maintenanceBuffer",
    "defines minimum difference between entry and liquidation prices, affects maximum leverage. liquidationPrice <= entryPrice * (1 - maintenanceBuffer)",
  )
  .addParam("securityBuffer", "Additional buffer to decrease risks of unexpected market changes, affects the liquidation condition");
