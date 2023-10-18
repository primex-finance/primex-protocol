// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils");
const fs = require("fs");
const path = require("path");
const { expect } = require("chai");

module.exports = async function (
  { deployContracts, executeUpgrade },
  {
    run,
    getNamedAccounts,
    deployments: { deploy },
    ethers: {
      getContract,
      utils: { keccak256, toUtf8Bytes },
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  const errorsLibrary = await getContract("Errors");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const limitOrderLibrary = await getContract("LimitOrderLibrary");

  // immutable contracts
  const positionManager = await getContract("PositionManager");
  const priceOracle = await getContract("PriceOracle");
  const whiteBlackList = await getContract("WhiteBlackList");
  const primexRegistry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const bigTimeLock = await getContract("BigTimelockAdmin");

  let tx, args;
  const argsPath = path.join(__dirname, "argsForExecuteBatchUpdate.json");
  const upgradedConctracts = [
    {
      proxyAddress: (await getContract("Reserve")).address,
      oldImplContractArtifactName: "Reserve",
      newImplContractArtifactName: "ReserveV2",
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("Treasury")).address,
      oldImplContractArtifactName: "Treasury",
      newImplContractArtifactName: "TreasuryV2",
      oldImplContractLibraries: { TokenTransfersLibrary: tokenTransfersLibrary.address },
      newImplContractLibraries: { TokenTransfersLibrary: tokenTransfersLibrary.address },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("PriceOracle")).address,
      oldImplContractArtifactName: "PriceOracle",
      newImplContractArtifactName: "PriceOracleV2",
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("PrimexDNS")).address,
      oldImplContractArtifactName: "PrimexDNS",
      newImplContractArtifactName: "PrimexDNSV2",
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("PositionManager")).address,
      oldImplContractArtifactName: "PositionManager",
      newImplContractArtifactName: "PositionManagerV2",
      oldImplContractLibraries: {
        PositionLibrary: positionLibrary.address,
        PrimexPricingLibrary: primexPricingLibrary.address,
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
      newImplContractLibraries: {
        PositionLibrary: positionLibrary.address,
        PrimexPricingLibrary: primexPricingLibrary.address,
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("TraderBalanceVault")).address,
      oldImplContractArtifactName: "TraderBalanceVault",
      newImplContractArtifactName: "TraderBalanceVaultV2",
      oldImplContractLibraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
      newImplContractLibraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("SpotTradingRewardDistributor")).address,
      oldImplContractArtifactName: "SpotTradingRewardDistributor",
      newImplContractArtifactName: "SpotTradingRewardDistributorV2",
      oldImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
      newImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("LimitOrderManager")).address,
      oldImplContractArtifactName: "LimitOrderManager",
      newImplContractArtifactName: "LimitOrderManagerV2",
      oldImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
        LimitOrderLibrary: limitOrderLibrary.address,
      },
      newImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
        LimitOrderLibrary: limitOrderLibrary.address,
      },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("KeeperRewardDistributor")).address,
      oldImplContractArtifactName: "KeeperRewardDistributor",
      newImplContractArtifactName: "KeeperRewardDistributorV2",
      oldImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
      newImplContractLibraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("LiquidityMiningRewardDistributor")).address,
      oldImplContractArtifactName: "LiquidityMiningRewardDistributor",
      newImplContractArtifactName: "LiquidityMiningRewardDistributorV2",
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("ReferralProgram")).address,
      oldImplContractArtifactName: "ReferralProgram",
      newImplContractArtifactName: "ReferralProgramV2",
      isBeacon: "false",
    },
    {
      proxyAddress: (await getContract("PTokensFactory")).address,
      oldImplContractArtifactName: "PToken",
      newImplContractArtifactName: "PTokenV2",
      isBeacon: "true",
    },
    {
      proxyAddress: (await getContract("DebtTokensFactory")).address,
      oldImplContractArtifactName: "DebtToken",
      newImplContractArtifactName: "DebtTokenV2",
      isBeacon: "true",
    },
    {
      proxyAddress: (await getContract("BucketsFactory")).address,
      oldImplContractArtifactName: "Bucket",
      newImplContractArtifactName: "BucketV2",
      isBeacon: "true",
      oldImplContractLibraries: { TokenTransfersLibrary: tokenTransfersLibrary.address },
      newImplContractLibraries: { TokenTransfersLibrary: tokenTransfersLibrary.address },
    },
    {
      proxyAddress: (await getContract("ActivityRewardDistributor")).address,
      oldImplContractArtifactName: "ActivityRewardDistributor",
      newImplContractArtifactName: "ActivityRewardDistributorV2",
      isBeacon: "false",
      oldImplContractLibraries: {},
      newImplContractLibraries: {},
    },
    {
      proxyAddress: (await getContract("WhiteBlackList")).address,
      oldImplContractArtifactName: "WhiteBlackList",
      newImplContractArtifactName: "WhiteBlackListV2",
      isBeacon: "false",
      oldImplContractLibraries: {},
      newImplContractLibraries: {},
    },
  ];

  if (deployContracts) {
    // deploy upgraded contracts
    for (let i = 0; i < upgradedConctracts.length; i++) {
      await deploy(upgradedConctracts[i].newImplContractArtifactName, {
        from: deployer,
        log: true,
        libraries: upgradedConctracts[i].newImplContractLibraries,
      });
      console.log(`${upgradedConctracts[i].newImplContractArtifactName} deployed!`);
    }

    if (await bigTimeLock.hasRole(keccak256(toUtf8Bytes("PROPOSER_ROLE")), deployer)) {
      args = await run("scheduleBatchContractUpgrade", { params: JSON.stringify(upgradedConctracts) });
      console.log("Upgrade is scheduled");
      fs.writeFileSync(argsPath, JSON.stringify(args, null, 2));
    } else {
      throw Error("The caller does not have the PROPOSER_ROLE. Upgrade is not executed");
    }
    /// BatchManager
    const batchManager = await getContract("BatchManager");
    await run("deploy:BatchManager", {
      contractName: "BatchManagerV2",
      positionManager: positionManager.address,
      priceOracle: priceOracle.address,
      primexPricingLibrary: primexPricingLibrary.address,
      positionLibrary: positionLibrary.address,
      whiteBlackList: whiteBlackList.address,
      registry: primexRegistry.address,
      errorsLibrary: errorsLibrary.address,
    });

    const BATCH_MANAGER_ROLE = keccak256(toUtf8Bytes("BATCH_MANAGER_ROLE"));
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));

    // revoke role
    tx = await whiteBlackList.removeAddressFromWhitelist(batchManager.address);
    await tx.wait();

    tx = await primexRegistry.revokeRole(BATCH_MANAGER_ROLE, batchManager.address);
    await tx.wait();

    tx = await primexRegistry.revokeRole(VAULT_ACCESS_ROLE, batchManager.address);
    await tx.wait();

    tx = await primexRegistry.revokeRole(NO_FEE_ROLE, batchManager.address);
    await tx.wait();

    const routers = [];
    const name = [];
    const dexTypes = [];
    const quoters = {};

    const { dexes } = getConfig();
    for (const dex in dexes) {
      name.push(dex);
      dexTypes.push(dexes[dex].type);
      routers.push(dexes[dex].router);
      if (dexes[dex].quoter !== undefined) {
        quoters[routers.length - 1] = dexes[dex].quoter;
      }
    }

    const newDexAdapter = await run("deploy:DexAdapter", {
      contractName: "DexAdapterV2",
      registry: primexRegistry.address,
      primexDNS: primexDNS.address,
      routers: JSON.stringify(routers),
      name: JSON.stringify(name),
      dexTypes: JSON.stringify(dexTypes),
      quoters: JSON.stringify(quoters),
      errorsLibrary: errorsLibrary.address,
      addDexesToDns: false,
    });

    tx = await primexDNS.setDexAdapter(newDexAdapter.address);
    await tx.wait();

    // swap manager
    const swapManager = await getContract("SwapManager");
    const newSwapManager = await run("deploy:SwapManager", {
      contractName: "SwapManagerV2",
      registry: primexRegistry.address,
      primexDNS: primexDNS.address,
      traderBalanceVault: traderBalanceVault.address,
      priceOracle: priceOracle.address,
      primexPricingLibrary: primexPricingLibrary.address,
      tokenTransfersLibrary: tokenTransfersLibrary.address,
      whiteBlackList: whiteBlackList.address,
      errorsLibrary: errorsLibrary.address,
    });
    tx = await whiteBlackList.removeAddressFromWhitelist(swapManager.address);
    await tx.wait();

    tx = await primexRegistry.revokeRole(VAULT_ACCESS_ROLE, swapManager.address);
    await tx.wait();

    const LimitOrderManager = await getContract("LimitOrderManager");

    tx = await LimitOrderManager.setSwapManager(newSwapManager.address);
    await tx.wait();
  }

  if (executeUpgrade) {
    // execute with args
    args = JSON.parse(fs.readFileSync(argsPath));
    const { deployer } = await getNamedAccounts();

    if (await bigTimeLock.hasRole(keccak256(toUtf8Bytes("EXECUTOR_ROLE")), deployer)) {
      const tx = await bigTimeLock.executeBatch(...args);
      await tx.wait();
      console.log("Upgrade is executed");
    } else {
      throw Error("The caller does not have the EXECUTOR_ROLE. Upgrade is not executed");
    }
    // test upgrade
    for (let i = 0; i < upgradedConctracts.length; i++) {
      const updatedContract = await getContract(upgradedConctracts[i].newImplContractArtifactName);
      expect(await updatedContract.testUpgrade()).to.equal(upgradedConctracts[i].newImplContractArtifactName);
      // test setter
      tx = await updatedContract.setValue(100);
      await tx.wait();
      expect(await updatedContract.value()).to.equal(100);
    }
  }
};
