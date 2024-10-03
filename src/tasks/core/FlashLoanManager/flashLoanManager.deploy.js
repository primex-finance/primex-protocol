// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    registry,
    primexDNS,
    whiteBlackList,
    flashLoanFeeRate,
    flashLoanProtocolRate,
    tokenTransfersLibrary,
    errorsLibrary,
    notExecuteNewDeployedTasks,
  },
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContractAt,
      getContract,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }
  const { deployer } = await getNamedAccounts();

  const flashLoanManager = await deploy("FlashLoanManager", {
    from: deployer,
    log: true,
    proxy: {
      owner: (await getContract("PrimexProxyAdmin")).address,
      viaAdminContract: "PrimexProxyAdmin",
      proxyContract: "OpenZeppelinTransparentProxy",
      execute: {
        init: {
          methodName: "initialize",
          args: [registry, primexDNS, whiteBlackList, flashLoanFeeRate, flashLoanProtocolRate],
        },
      },
    },
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
      Errors: errorsLibrary,
    },
  });

  if (flashLoanManager.newlyDeployed && !notExecuteNewDeployedTasks) {
    whiteBlackList = await getContractAt("WhiteBlackList", whiteBlackList);
    const tx = await whiteBlackList.addAddressToWhitelist(flashLoanManager.address);
    await tx.wait();
    const FLASH_LOAN_MANAGER_ROLE = keccak256(toUtf8Bytes("FLASH_LOAN_MANAGER_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", registry);
    const txGrantRole = await registryContract.grantRole(FLASH_LOAN_MANAGER_ROLE, flashLoanManager.address);
    await txGrantRole.wait();
  }

  return flashLoanManager;
};
