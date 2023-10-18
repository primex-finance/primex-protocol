// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { primexDNS, registry, whiteBlackList, errorsLibrary },
  { getNamedAccounts, deployments: { deploy }, ethers: { getContract, getContractAt } },
) {
  const { deployer } = await getNamedAccounts();

  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!whiteBlackList) {
    whiteBlackList = (await getContract("WhiteBlackList")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const PMXBonusNFT = await deploy("PMXBonusNFT", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [primexDNS, registry, whiteBlackList],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (PMXBonusNFT.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(PMXBonusNFT.address);
    await tx.wait();
  }
  return PMXBonusNFT;
};
