// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { pmx, registry, treasury, delistingDelay, adminWithdrawalDelay, rates, restrictions, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract } },
) {
  const { deployer } = await getNamedAccounts();
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  rates = JSON.parse(rates);

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
          args: [registry, pmx, treasury, delistingDelay, adminWithdrawalDelay, rates],
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
      const tx = await primexDNScontract.setFeeRestrictions(restriction.orderType, restriction.orderRestrictions);
      await tx.wait();
    }
  }
  return primexDNS;
};
