// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.DEV_NODE2 = true;
  await run("setup:deployEnv", {
    deployUniswap: true,
    deployQuickswapv3: true,
    deployCurve: true,
    deployBalancer: true,
    deployMeshswap: true,
    deployUniswapMulticall: true,
  });
};
