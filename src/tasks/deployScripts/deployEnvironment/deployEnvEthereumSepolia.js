// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.SEPOLIA = true;
  await run("setup:deployEnv", {
    deployUniswapv3: true,
    addLiquidityUniswapv3: true,
    deployCurve: true,
    deployUniswapMulticall: true,
  });
};
