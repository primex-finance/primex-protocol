// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.MUMBAI = true;
  await run("setup:deployEnv", {
    isETHNotNative: true,
    addLiquidityUniswap: true,
    addLiquidityUniswapv3: true,
    deployQuickswapv3: true,
    deployCurve: true,
    deployMeshswap: true,
  });
};
