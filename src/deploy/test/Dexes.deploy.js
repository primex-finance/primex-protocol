// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ run }) {
  await run("deploy:Balancer");
  await run("deploy:Curve");
  await run("deploy:Meshswap");
  await run("deploy:QuickswapV3");
  const names = ["uniswap", "sushiswap"];

  for (let i = 0; i < names.length; i++) {
    await run("deploy:UniswapV2", { name: names[i] });
  }
  await run("deploy:UniswapV3");
};

module.exports.tags = ["Dexes"];
