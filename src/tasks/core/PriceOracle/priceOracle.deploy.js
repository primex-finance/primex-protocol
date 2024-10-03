// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, errorsLibrary, eth, uniswapPriceFeed, pyth },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const priceOracle = await deploy("PriceOracle", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, eth],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (priceOracle.newlyDeployed) {
    const PriceOracle = await getContractAt("PriceOracle", priceOracle.address);
    // await PriceOracle.setUniswapPriceFeed(uniswapPriceFeed);
    await PriceOracle.setPyth(pyth);
  }
  return priceOracle;
};
