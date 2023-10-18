// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

const defaultValues = {
  router: "0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D",
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

task(
  "router:swapExactETHForTokens",
  "Swaps an exact amount of ETH for as many output tokens as possible, along the route determined by the path.",
  require("./swapExactETHForTokens.js"),
)
  .addParam("router", "The address of router contract", defaultValues.router)
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("amountIn", "The amount of ETH to send.", defaultValues.amountIn)
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

task(
  "router:swapExactTokensForETH",
  "Swaps an exact amount of tokens for as much ETH as possible, along the route determined by the path",
  require("./swapExactTokensForETH.js"),
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
  .addParam("to", "Recipient of the ETH.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);

task(
  "router:swapExactTokensForTokens",
  "Swaps an exact amount of input tokens for as many output tokens as possible, along the route determined by the path.",
  require("./swapExactTokensForTokens.js"),
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

task("router:addLiquidityETH", "Adds liquidity to an ERC-20⇄WETH pool with ETH.", require("./addLiquidityETH.js"))
  .addParam("router", "The address of router contract", defaultValues.router)
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam(
    "amountETHDesired",
    "The amount of ETH to add as liquidity if the token/WETH price is <= amountTokenDesired/msg.value (WETH depreciates).",
    defaultValues.amountETHDesired,
  )
  .addParam("token", "A pool token address.")
  .addParam(
    "amountTokenDesired",
    "The amount of token to add as liquidity if the WETH/token price is <= msg.value/amountTokenDesired (token depreciates).",
    defaultValues.amountTokenDesired,
  )
  .addParam(
    "amountTokenMin",
    "Bounds the extent to which the WETH/token price can go up before the transaction reverts. Must be <= amountTokenDesired.",
    defaultValues.amountTokenMin,
  )
  .addParam(
    "amountETHMin",
    "Bounds the extent to which the token/WETH price can go up before the transaction reverts. Must be <= msg.value.",
    defaultValues.amountETHMin,
  )
  .addParam("to", "Recipient of the liquidity tokens.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);

task("router:addLiquidity", "Adds liquidity to an ERC-20⇄ERC-20 pool.", require("./addLiquidity.js"))
  .addParam("router", "The address of router contract", defaultValues.router)
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

task("router:removeLiquidity", "Removes liquidity from an ERC-20⇄ERC-20 pool.", require("./removeLiquidity.js"))
  .addParam("router", "The address of router contract", defaultValues.router)
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("tokenA", "A pool first token address.")
  .addParam("tokenB", "A pool second token address.")
  .addParam("liquidity", "The amount of liquidity tokens to remove.", defaultValues.liquidity)
  .addParam("amountAMin", "The minimum amount of tokenA that must be received for the transaction not to revert.", defaultValues.amountAMin)
  .addParam("amountBMin", "The minimum amount of tokenB that must be received for the transaction not to revert.", defaultValues.amountBMin)
  .addParam("to", "Recipient of the underlying assets.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);

task("router:removeLiquidityETH", "Removes liquidity from an ERC-20⇄ERC-20 pool.", require("./removeLiquidityETH.js"))
  .addParam("router", "The address of router contract", defaultValues.router)
  .addParam("from", "The name of the tx sender", defaultValues.from)
  .addParam("token", "A pool token address.")
  .addParam("liquidity", "The amount of liquidity tokens to remove.", defaultValues.liquidity)
  .addParam(
    "amountTokenMin",
    "The minimum amount of token that must be received for the transaction not to revert.",
    defaultValues.amountTokenMin,
  )
  .addParam(
    "amountETHMin",
    "The minimum amount of ETH that must be received for the transaction not to revert.",
    defaultValues.amountETHMin,
  )
  .addParam("to", "Recipient of the underlying assets.", defaultValues.to)
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", defaultValues.deadline);
