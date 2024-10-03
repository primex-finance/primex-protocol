// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { uniswapV3Factory, twapInterval, poolUpdateInterval, registry },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (uniswapV3Factory === undefined) throw new Error("uniswapV3Factory is undefined");

  return await deploy("UniswapPriceFeed", {
    from: deployer,
    log: true,
    args: [uniswapV3Factory, twapInterval, poolUpdateInterval, registry],
  });
};
