// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    pmx,
    pmxPartInReward,
    whiteBlackList,
    nativePartInReward,
    positionSizeCoefficient,
    additionalGas,
    minPositionSizeAddend,
    maxGasPerPositionParams,
    decreasingGasByReasonParams,
    defaultMaxGasPrice,
    oracleGasPriceTolerance,
    paymentModel,
    registry,
    priceOracle,
    treasury,
    primexPricingLibrary,
    tokenTransfersLibrary,
    errorsLibrary,
  },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!priceOracle) {
    priceOracle = (await getContract("PriceOracle")).address;
  }
  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }
  if (!whiteBlackList) {
    whiteBlackList = (await getContract("WhiteBlackList")).address;
  }
  if (!primexPricingLibrary) {
    primexPricingLibrary = (await getContract("PrimexPricingLibrary")).address;
  }
  if (!tokenTransfersLibrary) {
    tokenTransfersLibrary = (await getContract("TokenTransfersLibrary")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const keeperRewardDistributor = await deploy(process.env.NEWPMX ? "KeeperRewardDistributorNewPmx" : "KeeperRewardDistributor", {
    contract: "KeeperRewardDistributor",
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [
            {
              priceOracle: priceOracle,
              registry: registry,
              pmx: pmx,
              treasury: treasury,
              whiteBlackList: whiteBlackList,
              pmxPartInReward: pmxPartInReward,
              nativePartInReward: nativePartInReward,
              positionSizeCoefficient: positionSizeCoefficient,
              additionalGas: additionalGas,
              defaultMaxGasPrice: defaultMaxGasPrice,
              oracleGasPriceTolerance: oracleGasPriceTolerance,
              paymentModel: paymentModel,
              maxGasPerPositionParams: JSON.parse(maxGasPerPositionParams),
              decreasingGasByReasonParams: JSON.parse(decreasingGasByReasonParams),
            },
          ],
        },
      },
    },
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });
  if (keeperRewardDistributor.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    let tx = await whiteBlackList.addAddressToWhitelist(keeperRewardDistributor.address);
    await tx.wait();
    if (minPositionSizeAddend !== undefined) {
      const keeperRewardDistributorContract = await getContractAt("KeeperRewardDistributor", keeperRewardDistributor.address);
      tx = await keeperRewardDistributorContract.setMinPositionSizeAddend(minPositionSizeAddend);
      await tx.wait();
    }
  }
  return keeperRewardDistributor;
};
