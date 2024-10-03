// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  args,
  {
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContract,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  const { encodeFunctionData } = require("../../utils/encodeFunctionData.js");
  const { deployer } = await getNamedAccounts();
  if (!args.primexDNS) {
    args.primexDNS = (await getContract("PrimexDNS")).address;
  }
  if (!args.errorsLibrary) {
    args.errorsLibrary = (await getContract("Errors")).address;
  }

  const positionManager = await deploy("PositionManager", {
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
            args.registry,
            args.primexDNS,
            args.traderBalanceVault,
            args.priceOracle,
            args.keeperRewardDistributor,
            args.whiteBlackList,
            args.positionManagerExtension,
          ],
        },
      },
    },
    libraries: {
      PrimexPricingLibrary: args.primexPricingLibrary,
      PositionLibrary: args.positionLibrary,
      TokenTransfersLibrary: args.tokenTransfersLibrary,
      Errors: args.errorsLibrary,
    },
  });
  if (positionManager.newlyDeployed) {
    let tx;
    const pmContract = await getContractAt("PositionManager", positionManager.address);

    const { payload: payload1 } = await encodeFunctionData(
      "setDefaultOracleTolerableLimit",
      [args.defaultOracleTolerableLimit],
      "PositionManagerExtension",
      args.positionManagerExtension,
    );
    tx = await pmContract.setProtocolParamsByAdmin(payload1);
    await tx.wait();

    const { payload: payload2 } = await encodeFunctionData(
      "setOracleTolerableLimitMultiplier",
      [args.oracleTolerableLimitMultiplier],
      "PositionManagerExtension",
      args.positionManagerExtension,
    );
    tx = await pmContract.setProtocolParamsByAdmin(payload2);
    await tx.wait();

    const { payload: payload3 } = await encodeFunctionData(
      "setMaintenanceBuffer",
      [args.maintenanceBuffer],
      "PositionManagerExtension",
      args.positionManagerExtension,
    );
    tx = await pmContract.setProtocolParamsByAdmin(payload3);
    await tx.wait();

    const { payload: payload4 } = await encodeFunctionData(
      "setSecurityBuffer",
      [args.securityBuffer],
      "PositionManagerExtension",
      args.positionManagerExtension,
    );
    tx = await pmContract.setProtocolParamsByAdmin(payload4);
    await tx.wait();

    args.whiteBlackList = await getContractAt("WhiteBlackList", args.whiteBlackList);
    tx = await args.whiteBlackList.addAddressToWhitelist(positionManager.address);
    await tx.wait();

    const PM_ROLE = keccak256(toUtf8Bytes("PM_ROLE"));
    const registryContract = await getContractAt("PrimexRegistry", args.registry);
    tx = await registryContract.grantRole(PM_ROLE, positionManager.address);
    await tx.wait();

    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    tx = await registryContract.grantRole(VAULT_ACCESS_ROLE, positionManager.address);
    await tx.wait();
  }

  return positionManager;
};
