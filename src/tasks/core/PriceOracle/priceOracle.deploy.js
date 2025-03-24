// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    errorsLibrary,
    eth,
    uniswapPriceFeed,
    treasury,
    pyth,
    orallyOracle,
    usdt,
    supraPullOracle,
    supraStorageOracle,
    storkPublicKey,
    storkVerify,
  },
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
    let tx;
    // await PriceOracle.setUniswapPriceFeed(uniswapPriceFeed);
    await PriceOracle.setPyth(pyth);
    if (orallyOracle) {
      tx = await PriceOracle.setOrallyOracle(orallyOracle);
      await tx.wait();
    }
    if (supraPullOracle) {
      tx = await PriceOracle.setSupraPullOracle(supraPullOracle);
      await tx.wait();
    }
    if (supraStorageOracle) {
      tx = await PriceOracle.setSupraStorageOracle(supraStorageOracle);
      await tx.wait();
    }
    if (storkPublicKey) {
      tx = await PriceOracle.setStorkPublicKey(storkPublicKey);
      await tx.wait();
    }
    if (storkVerify) {
      tx = await PriceOracle.setStorkVerify(storkVerify);
      await tx.wait();
    }
  }
  return priceOracle;
};
