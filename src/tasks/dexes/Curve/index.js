// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

const defaultValues = {
  from: "caller",
  to: "recipient",
  amountA: "100",
  amountB: "100",
  liquidityMin: "0",
  amountIn: "10",
  amountOutMin: "0",
};

task("deploy:Curve", "deploy curve pool registry", require("./Curve.deploy"));

task("curve:createPool", "create curve pool for 2 tokens", require("./createPool"))
  .addOptionalParam("curveRegistry", "The address of curve registry")
  .addParam("assets", "Array of assets containing addresses and amounts of tokens");

task("curve:createEtherPool", "create curve pool with native currency", require("./createEthPool"))
  .addOptionalParam("curveRegistry", "The address of curve registry")
  .addOptionalParam("secondToken", "The second asset for the ether pool");

task("curve:addLiquidity", "Adds liquidity to curve pool", require("./addLiquidity.js"))
  .addOptionalParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("pool", "Pool where to add liquidity")
  .addParam("assets", "Array of assets containing addresses and amounts of tokens")
  .addParam("liquidityMin", "Minimal amount of LP token to receive", defaultValues.liquidityMin)
  .addOptionalParam("lpTokenReceiver", "An account to receive LP tokens");

task("curve:addLiquidityEthPool", "Adds liquidity to curve pool", require("./addLiquidityEthPool"))
  .addOptionalParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("pool", "Pool where to add liquidity")
  .addParam("secondToken", "")
  .addParam("amounts", "Minimal amount of LP token to receive")
  .addParam("liquidityMin", "Minimal amount of LP token to receive", defaultValues.liquidityMin)
  .addOptionalParam("lpTokenReceiver", "An account to receive LP tokens");

task(
  "curve:swapExactTokensForTokens",
  "Swaps an exact amount of input tokens for as many output tokens as possible",
  require("./swapExactTokensForTokens.js"),
)
  .addParam("router", "The address of router contract")
  .addOptionalParam("pool", "Pool for swap")
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("amountIn", "The amount of input tokens to send.", defaultValues.amountIn)
  .addParam(
    "amountOutMin",
    "The minimum amount of output tokens that must be received for the transaction not to revert.",
    defaultValues.amountOutMin,
  )
  .addParam("tokenA", "Input token")
  .addParam("tokenB", "Output token token")
  .addParam("to", "Recipient of the output tokens.", defaultValues.to);
