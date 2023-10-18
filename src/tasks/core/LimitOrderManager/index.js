// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:LimitOrderManager", "Deploy LimitOrderManager contract", require("./limitOrderManager.deploy"))
  .addParam("primexDNS", "The address of the PrimexDNS contract")
  .addParam("registry", "The address of registry contract")
  .addParam("positionManager", "The address of PositionManager contract")
  .addParam("traderBalanceVault", "The address of TraderBalanceVault contract")
  .addParam("swapManager", "The address of SwapManager contract")
  .addParam("primexPricingLibrary", "The address of PrimexPricingLibrary library")
  .addParam("tokenTransfersLibrary", "The address of TokenTransfersLibrary library")
  .addParam("limitOrderLibrary", "The address of LimitOrderLibrary library")
  .addParam("whiteBlackList", "The address of WhiteBlackList contract")
  .addOptionalParam("errorsLibrary", "The address of errorsLibrary contract");
