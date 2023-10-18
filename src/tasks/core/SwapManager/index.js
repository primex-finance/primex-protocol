// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:SwapManager", "Deploy PositionManager contract", require("./swapManager.deploy"))
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("registry", "The address of registry contract")
  .addParam("traderBalanceVault", "The address of TraderBalanceVault contract")
  .addParam("priceOracle", "The address of priceOracle contract")
  .addParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract")
  .addOptionalParam("contractName", "The name of the contract artifact e.g SwapManager");
