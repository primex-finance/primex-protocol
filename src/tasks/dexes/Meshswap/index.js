const { task } = require("hardhat/config");

const defaultValues = {
  router: "0x10f4A785F458Bc144e3706575924889954946639",
  from: "caller",
  amountOutMin: "0",
  amountIn: "10",
  amountETHDesired: "10",
  amountTokenDesired: "10",
  amountTokenMin: "0",
  amountETHMin: "0",
  amountADesired: "10",
  amountBDesired: "10",
  amountAMin: "0",
  amountBMin: "0",
  liquidity: "10",
  to: "recipient",
  deadline: "10",
};

task("deploy:Meshswap", "Deploy Meshswap contracts", require("./Meshswap.deploy"));

task("Meshswap:createPoolAndAddLiquidity", "Create Meshswap pool and add liquidity to it", require("./createPoolAndAddLiquidity"))
  .addParam("to", "Address receiver of LP tokens", "deployer")
  .addParam("factoryAddress", "Meshswap Factory address")
  .addParam("tokenA", "A pool first token address")
  .addParam("tokenB", "A pool second token address")
  .addParam("fee", "New pool fee")
  .addParam("amountADesired", "The amount of tokenA to add as liquidity")
  .addParam("amountBDesired", "The amount of tokenB to add as liquidity");

task("Meshswap:addLiquidity", "Add liquidity to existing pool", require("../Router/addLiquidity"))
  .addParam("router", "The address of router contract")
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("tokenA", "A pool first token address.")
  .addParam("tokenB", "A pool second token address.")
  .addParam(
    "amountADesired",
    "The amount of tokenA to add as liquidity if the B/A price is <= amountBDesired/amountADesired (A depreciates).",
    defaultValues.amountADesired,
  )
  .addParam(
    "amountBDesired",
    "The amount of tokenB to add as liquidity if the A/B price is <= amountADesired/amountBDesired (B depreciates).",
    defaultValues.amountBDesired,
  )
  .addParam(
    "amountAMin",
    "Bounds the extent to which the B/A price can go up before the transaction reverts. Must be <= amountADesired.",
    defaultValues.amountAMin,
  )
  .addParam(
    "amountBMin",
    "Bounds the extent to which the A/B price can go up before the transaction reverts. Must be <= amountBDesired.",
    defaultValues.amountBMin,
  )
  .addParam("to", "Recipient of the output tokens.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);

task(
  "Meshswap:swapExactTokensForTokens",
  "Swaps an exact amount of input tokens for as many output tokens as possible, along the route determined by the path.",
  require("../Router/swapExactTokensForTokens"),
)
  .addParam("router", "The address of router contract", defaultValues.router)
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("amountIn", "The amount of input tokens to send.", defaultValues.amountIn)
  .addParam(
    "amountOutMin",
    "The minimum amount of output tokens that must be received for the transaction not to revert.",
    defaultValues.amountOutMin,
  )
  .addParam(
    "path",
    "An array of token addresses. path.length must be >= 2. Pools for each consecutive pair of addresses must exist and have liquidity.",
  )
  .addParam("to", "Recipient of the output tokens.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);
