// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    pmx,
    treasury,
    delistingDelay,
    adminWithdrawalDelay,
    feeRateParams,
    averageGasPerActionParams,
    maxProtocolFee,
    leverageTolerance,
    liquidationGasAmount,
    protocolFeeCoefficient,
    additionalGasSpent,
    pmxDiscountMultiplier,
    gasPriceBuffer,
    restrictions,
    errorsLibrary,
  },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  feeRateParams = JSON.parse(feeRateParams);
  averageGasPerActionParams = JSON.parse(averageGasPerActionParams);

  const primexDNS = await deploy("PrimexDNS", {
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
              registry,
              pmx,
              treasury,
              delistingDelay,
              adminWithdrawalDelay,
              feeRateParams,
              averageGasPerActionParams,
              maxProtocolFee,
              liquidationGasAmount,
              protocolFeeCoefficient,
              additionalGasSpent,
              pmxDiscountMultiplier,
              gasPriceBuffer,
              leverageTolerance,
            },
          ],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (primexDNS.newlyDeployed && restrictions !== undefined) {
    const primexDNScontract = await getContract("PrimexDNS");
    restrictions = JSON.parse(restrictions);
    for (const restriction of restrictions) {
      const tx = await primexDNScontract.setMinFeeRestrictions(restriction.callingMethod, restriction.minFeeRestrictions);
      await tx.wait();
    }
  }
  return primexDNS;
};
