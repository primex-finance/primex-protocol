// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { bonusNft, registry, primexDNS, whiteBlackList, errorsLibrary },
  { getNamedAccounts, ethers: { getContract, getContractAt }, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();
  if (!bonusNft) {
    bonusNft = (await getContract("PMXBonusNFT")).address;
  }
  if (!registry) {
    registry = (await getContract("Registry")).address;
  }
  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const interestIncreaser = await deploy("InterestIncreaser", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [bonusNft, registry, primexDNS, whiteBlackList],
        },
      },
    },
    libraries: {
      Errors: errorsLibrary,
    },
  });
  if (interestIncreaser.newlyDeployed) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(interestIncreaser.address);
    await tx.wait();
  }
  return interestIncreaser;
};
