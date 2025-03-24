// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ priceOracle }, { getNamedAccounts, deployments: { deploy }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("UniswapV2LPOracle", {
    from: deployer,
    log: true,
    args: [priceOracle],
  });
};
