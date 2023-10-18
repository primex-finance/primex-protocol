// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.DEV_NODE1 = true;
  await run("setup:deployEnv", {
    deployUniswap: true,
    deployUniswapv3: true,
    deployQuickswapv3: true,
    deployCurve: true,
    deployBalancer: true,
    deployMeshswap: true,
    deployUniswapMulticall: true,
  });
};
