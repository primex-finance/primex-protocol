// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.ARBITRUM = true;
  await run("setup:deployEnv", {
    addLiquidityUniswapv3: true,
    deployCurve: true,
  });
};
