// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.MOONBASE = true;
  await run("setup:deployEnv", {
    isETHNotNative: true,
    addLiquidityUniswap: true,
    deployCurve: true,
  });
};
