// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:UniswapV3", "deploy uniswap v3 factory, router and NonfungiblePositionManager", require("./UniswapV3.deploy"));

task("UniswapV3:CreatePool", "Create and inizialize pool in uniswap v3", require("./CreatePool"))
  .addOptionalParam("nonfungiblePositionManager", "NonfungiblePositionManager address")
  .addParam("from", "The name of the tx sender")
  .addParam("tokenA", "A pool first token address.")
  .addParam("tokenB", "A pool second token address.")
  .addParam("fee", "new pool fee")
  .addOptionalParam(
    "reservTokenA",
    "price=reservTokenA/reservTokenB(or vice versa depending on the tokens) sqrtPriceX96 = sqrt(price) * 2 ** 96,(https://docs.uniswap.org/sdk/guides/fetching-prices#understanding-sqrtprice)",
  )
  .addOptionalParam(
    "reservTokenB",
    "price=reservTokenA/reservTokenB(or vice versa depending on the tokens) sqrtPriceX96 = sqrt(price) * 2 ** 96,(https://docs.uniswap.org/sdk/guides/fetching-prices#understanding-sqrtprice)",
  );

task("UniswapV3:addLiquidity", "Add liquidity in uniswap v3 pool", require("./addLiquidity"))
  .addOptionalParam("nonfungiblePositionManager", "NonfungiblePositionManager address")
  .addParam("from", "The name of the tx sender")
  .addParam("to", "Liquidity NFT recipient address")
  .addParam("tokenA", "A pool first token address.")
  .addParam("tokenB", "A pool second token address.")
  .addParam("fee", "new pool fee", "3000")
  .addOptionalParam(
    "tickLower",
    "tickLower-tickUpper range of ticks for adding liquidity(when tickLower and tickUpper are undefined then liquidity is added to all ticks)",
  )
  .addOptionalParam(
    "tickUpper",
    "tickLower-tickUpper range of ticks for adding liquidity(when tickLower and tickUpper are undefined then liquidity is added to all ticks)",
  )
  .addParam("amountADesired", "The amount of tokenA to add as liquidity")
  .addParam("amountBDesired", "The amount of tokenB to add as liquidity")
  .addParam(
    "amountAMin",
    "Bounds the extent to which the B/A price can go up before the transaction reverts. Must be <= amountADesired.",
    "0",
  )
  .addParam(
    "amountBMin",
    "Bounds the extent to which the A/B price can go up before the transaction reverts. Must be <= amountBDesired.",
    "0",
  )
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", (new Date().getTime() + 600).toString());

task("UniswapV3::Swap:ExactInputSingle", "Swap tokens on uniswap v3 pool", require("./SwapExactInputSingle"))
  .addOptionalParam("swapRouter", "SwapRouter uniswap v3 address")
  .addParam("from", "The name of the tx sender")
  .addParam("to", "Liquidity NFT recipient address")
  .addParam("tokenA", "A pool first token address.")
  .addParam("tokenB", "A pool second token address.")
  .addParam("fee", "new pool fee", "3000")
  .addParam("amountIn", "The amount of input tokens to send")
  .addParam("amountOutMinimum", "The minimum amount of output tokens that must be received for the transaction not to revert", "0")
  .addOptionalParam(
    "reservTokenA",
    "price=reservTokenA/reservTokenB(or vice versa depending on the tokens) sqrtPriceX96 = sqrt(price) * 2 ** 96,(https://docs.uniswap.org/sdk/guides/fetching-prices#understanding-sqrtprice)",
    "0",
  )
  .addOptionalParam(
    "reservTokenB",
    "price=reservTokenA/reservTokenB(or vice versa depending on the tokens) sqrtPriceX96 = sqrt(price) * 2 ** 96,(https://docs.uniswap.org/sdk/guides/fetching-prices#understanding-sqrtprice)",
    "0",
  )
  .addParam("deadline", "Unix timestamp after which the transaction will revert.", (new Date().getTime() + 600).toString());

task("deploy:UniswapInterfaceMulticall", "deploy UniswapInterfaceMulticall", require("./UniswapMulticall.deploy"));
