// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.GOERLI = true;
  await run("setup:deployEnv", {
    addLiquidityUniswap: true,
    addLiquidityUniswapv3: true,
    deployCurve: true,
    addLiquidityBalancer: true,
  });
};
