// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("positionToCloseBySL", "Creates position closable by SL", require("./closablePositionBySL"))
  .addOptionalParam("depositAsset", "The deposit asset of the opening position", "usdc")
  .addOptionalParam("positionAsset", "The position asset of the opening position", "weth")
  .addOptionalParam("depositAmount", "A deposit amount of the deposit asset without decimals", "300")
  .addOptionalParam("borrowedAmount", "A borrowed amount in the borrowed asset (usdc) without decimals", "200");

task("positionToCloseByTP", "Creates position closable by TP", require("./closablePositionByTP"))
  .addOptionalParam("depositAsset", "The deposit asset of the opening position", "usdc")
  .addOptionalParam("positionAsset", "The position asset of the opening position", "uni")
  .addOptionalParam("depositAmount", "A deposit amount of the deposit asset without decimals", "300")
  .addOptionalParam("borrowedAmount", "A borrowed amount in the borrowed asset (usdc) without decimals", "0");

task("positionToCloseByLiq", "Creates position closable by liquidation price", require("./closablePositionByLiquidationPrice"))
  .addOptionalParam("depositAsset", "The deposit asset of the opening position", "usdc")
  .addOptionalParam("positionAsset", "The position asset of the opening position", "wbtc")
  .addOptionalParam("depositAmount", "A deposit amount of the deposit asset without decimals", "300")
  .addOptionalParam("borrowedAmount", "A borrowed amount in the borrowed asset (usdc) without decimals", "400");

task("closePos", "Closes position", require("./closePosition")).addParam("id", "position id");

task(
  "createLimitOrder",
  "Creates filled limit order then create canBeClosed position in testnet",
  require("./createLimitNetworkTestnets.js"),
)
  .addOptionalParam("depositAsset", "The deposit asset of the opening position", "usdc")
  .addOptionalParam("positionAsset", "The position asset of the opening position", "link")
  .addOptionalParam("depositAmount", "A deposit amount of the deposit asset without decimals", "500")
  .addOptionalParam("takeDepositFromWallet", "Bool, add a collateral deposit within the current transaction", "false")
  .addOptionalParam("leverage", "leverage for trading. eg 2 or 2.1", "1")
  .addOptionalParam("shouldOpenPosition", "The flag to indicate whether position should be opened", "true")
  .addOptionalParam("deadline", "The deadline for the order being created", (3600 * 24).toString())
  .addOptionalParam("openPriceRate", "how much will the opening price increase relative to the current price ", "2");
