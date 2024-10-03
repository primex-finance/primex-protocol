// SPDX-License-Identifier: BUSL-1.1
const { checkFolder, setConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  {
    isETHNotNative,
    deployUniswap,
    addLiquidityUniswap,
    deployUniswapv3,
    addLiquidityUniswapv3,
    deployQuickswapv3,
    addLiquidityQuickswapv3,
    deployCurve,
    addLiquidityCurve,
    deployBalancer,
    addLiquidityBalancer,
    deployMeshswap,
    addLiquidityMeshswap,
    deployUniswapMulticall,
    deployMockPyth,
  },
  { run },
) {
  checkFolder();

  await run("compile", { force: false });
  setConfig("isETHNative", !isETHNotNative);
  await run("setup:MintTokens");
  await run("deploy:Aave");
  await run("deploy:WETHMock");

  if (deployMockPyth) {
    await run("deploy:MockPyth");
  }

  if (deployUniswap) {
    const names = ["uniswap", "sushiswap"];
    for (let i = 0; i < names.length; i++) {
      await run("deploy:UniswapV2", { name: names[i] });
    }
  }
  if (deployUniswap || addLiquidityUniswap) {
    await run("setup:addLiquidity");
  }

  if (deployUniswapv3) {
    await run("deploy:UniswapV3");
  }
  if (deployUniswapv3 || addLiquidityUniswapv3) {
    await run("setup:addLiquidityUniswapV3");
  }

  if (deployQuickswapv3) {
    await run("deploy:QuickswapV3");
  }
  if (deployQuickswapv3 || addLiquidityQuickswapv3) {
    await run("setup:addLiquidityQuickswapV3");
  }

  if (deployCurve) {
    await run("deploy:Curve");
  }
  if (deployCurve || addLiquidityCurve) {
    await run("setup:addLiquidityCurve");
  }

  if (deployBalancer) {
    await run("deploy:Balancer");
  }

  if (deployBalancer || addLiquidityBalancer) {
    await run("setup:addLiquidityBalancer");
  }

  if (deployMeshswap) {
    await run("deploy:Meshswap");
  }
  if (deployMeshswap || addLiquidityMeshswap) {
    await run("setup:addLiquidityMeshswap");
  }

  if (deployUniswapMulticall) {
    await run("deploy:UniswapInterfaceMulticall");
  }

  await run("setup:LimitedMint");
  await run("deploy:Pricefeeds");

  console.log("=== Environment deployed ===");
};
