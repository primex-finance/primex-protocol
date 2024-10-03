// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, errorsLibrary, eth, uniswapPriceFeed, treasury, pyth, usdt, supraPullOracle, supraStorageOracle },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      constants: { AddressZero },
      getContract,
      getContractAt,
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }

  if (!usdt) {
    usdt = AddressZero;
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
          args: [registry, eth, usdt, treasury],
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
    if (supraPullOracle) {
      await PriceOracle.setSupraPullOracle(supraPullOracle);
    }
    if (supraStorageOracle) {
      await PriceOracle.setSupraStorageOracle(supraStorageOracle);
    }
  }
  return priceOracle;
};
