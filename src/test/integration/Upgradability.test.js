const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    provider,
    getContract,
    getContractAt,
    constants: { HashZero },
    utils: { keccak256, toUtf8Bytes },
  },
  deployments: { fixture, deploy },
  upgrades,
  getNamedAccounts,
} = require("hardhat");

const { addressFromEvent } = require("../utils/addressFromEvent");
const { getImpersonateSigner } = require("../utils/hardhatUtils");

process.env.TEST = true;

describe("Upgradability_integration", function () {
  let primexPricingLibrary, bigTimeLock, positionLibrary, tokenTransfersLibrary, tokenApproveLibrary, limitOrderLibrary, PrimexProxyAdmin;
  let params, delay, value, predecessor, salt;
  let deployer;
  before(async function () {
    await fixture(["Test"]);
    // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
    await upgrades.silenceWarnings();
    value = 0;
    predecessor = HashZero;
    salt = HashZero;
    bigTimeLock = await getContract("BigTimelockAdmin");
    delay = await bigTimeLock.getMinDelay();

    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    positionLibrary = await getContract("PositionLibrary");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    tokenApproveLibrary = await getContract("TokenApproveLibrary");
    limitOrderLibrary = await getContract("LimitOrderLibrary");
    PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
    deployer = (await getNamedAccounts()).deployer;
    const txGrantRoleProposer = await bigTimeLock.grantRole(keccak256(toUtf8Bytes("PROPOSER_ROLE")), deployer);
    await txGrantRoleProposer.wait();

    params = [
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
        proxyAddress: (await getContract("PMXBonusNFT")).address,
        oldImplContractArtifactName: "PMXBonusNFT",
        newImplContractArtifactName: "PMXBonusNFTV2",
        isBeacon: "false",
      },
      {
        proxyAddress: (await getContract("InterestIncreaser")).address,
        oldImplContractArtifactName: "InterestIncreaser",
        newImplContractArtifactName: "InterestIncreaserV2",
        isBeacon: "false",
      },
      {
        proxyAddress: (await getContract("FeeDecreaser")).address,
        oldImplContractArtifactName: "FeeDecreaser",
        newImplContractArtifactName: "FeeDecreaserV2",
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
    ];
    // deploy upgraded contracts
    for (let i = 0; i < params.length; i++) {
      await deploy(params[i].newImplContractArtifactName, {
        from: deployer,
        log: true,
        libraries: params[i].newImplContractLibraries,
      });
      console.log(`${params[i].newImplContractArtifactName} deployed!`);
    }
  });

  // eslint-disable-next-line mocha/no-setup-in-describe
  it("Should upgrade contract", async function () {
    const args = await run("scheduleBatchContractUpgrade", { params: JSON.stringify(params) });

    const expectedArgs = [[], [], []];
    const oldImpls = [];
    for (let i = 0; i < params.length; i++) {
      expectedArgs[0].push(PrimexProxyAdmin.address);
      expectedArgs[1].push(value);
      const newImplContract = await getContract(params[i].newImplContractArtifactName);
      const proxyContract = await getContract(params[i].oldImplContractArtifactName);
      const payload = PrimexProxyAdmin.interface.encodeFunctionData("upgrade", [proxyContract.address, newImplContract.address]);
      expectedArgs[2].push(payload);

      const oldImpl = await upgrades.erc1967.getImplementationAddress(proxyContract.address);
      oldImpls.push(oldImpl);
    }

    expectedArgs.push(predecessor, salt);
    expect(args).to.deep.equal(expectedArgs);

    const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
    await network.provider.send("evm_mine");

    const txGrantRoleExecutor = await bigTimeLock.grantRole(keccak256(toUtf8Bytes("EXECUTOR_ROLE")), deployer);
    await txGrantRoleExecutor.wait();
    await bigTimeLock.executeBatch(...args);

    const newImpls = [];
    for (let i = 0; i < params.length; i++) {
      const proxyContract = await getContract(params[i].oldImplContractArtifactName);
      const newImpl = await upgrades.erc1967.getImplementationAddress(proxyContract.address);
      newImpls.push(newImpl);

      const newContract = await getContractAt(params[i].newImplContractArtifactName, proxyContract.address);

      // test new pure function
      expect(await newContract.testUpgrade()).to.equal(params[i].newImplContractArtifactName);

      // test new setter
      await newContract.setValue(23);
      expect(await newContract.value()).to.equal(23);
    }

    expect(newImpls).not.to.deep.equal(oldImpls); // Implementation should be different
  });

  describe("Beacon proxies", function () {
    let bucketsFactory, bucketsFactorySigner;
    before(async function () {
      bucketsFactory = await getContract("BucketsFactory");
      bucketsFactorySigner = await getImpersonateSigner(bucketsFactory);
    });
    it("should upgrade contract Bucket", async function () {
      const primexDNS = await getContract("PrimexDNS");
      const bucketAddress = (await primexDNS.buckets("bucket1")).bucketAddress;

      const name = "Bucket";
      const newName = "BucketV2";
      const oldBucket = await getContractAt(name, bucketAddress);
      const oldBucketName = await oldBucket.name();

      const params = [
        {
          proxyAddress: bucketsFactory.address,
          oldImplContractArtifactName: name,
          newImplContractArtifactName: newName,
          isBeacon: "true",
          oldImplContractLibraries: {
            TokenTransfersLibrary: tokenTransfersLibrary.address,
            TokenApproveLibrary: tokenApproveLibrary.address,
          },
          newImplContractLibraries: {
            TokenTransfersLibrary: tokenTransfersLibrary.address,
            TokenApproveLibrary: tokenApproveLibrary.address,
          },
        },
      ];

      await deploy(params[0].newImplContractArtifactName, {
        from: deployer,
        log: true,
        libraries: params[0].newImplContractLibraries,
      });

      const oldImpl = await bucketsFactory.implementation();
      const args = await run("scheduleBatchContractUpgrade", { params: JSON.stringify(params) });

      const newImplContract = await getContract(newName);
      const payload = PrimexProxyAdmin.interface.encodeFunctionData("upgradeBeacon", [bucketsFactory.address, newImplContract.address]);
      const expectedArgs = [[], [], []];
      expectedArgs[0].push(PrimexProxyAdmin.address);
      expectedArgs[1].push(value);
      expectedArgs[2].push(payload);
      expectedArgs.push(predecessor, salt);
      expect(args).to.deep.equal(expectedArgs);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await network.provider.send("evm_mine");

      const txGrantRoleExecutor = await bigTimeLock.grantRole(keccak256(toUtf8Bytes("EXECUTOR_ROLE")), deployer);
      await txGrantRoleExecutor.wait();
      await bigTimeLock.executeBatch(...args);

      const newImpl = await bucketsFactory.implementation();
      expect(newImpl).not.to.equal(oldImpl);
      const newBucket = await getContractAt(newName, bucketAddress);

      // test new pure function
      expect(await newBucket.testUpgrade()).to.equal(newName);

      // test setter
      await newBucket.setValue(23);
      expect(await newBucket.value()).to.equal(23);

      // test old function
      const newBucketName = await newBucket.name();
      expect(oldBucketName).to.equal(newBucketName);
    });

    it("should upgrade contract PToken", async function () {
      const pTokenFactory = await getContract("PTokensFactory");

      const name = "PToken";
      const newName = "PTokenV2";
      const tx = await pTokenFactory.connect(bucketsFactorySigner).createPToken("PToken", "PT", "18");
      const txSuccess = await tx.wait();
      const tokenAddress = addressFromEvent("PTokenCreated", txSuccess);
      const oldToken = await getContractAt(name, tokenAddress);
      const bucketInOldImpl = await oldToken.bucket();

      const oldImpl = await pTokenFactory.implementation();

      const params = [
        {
          proxyAddress: pTokenFactory.address,
          oldImplContractArtifactName: name,
          newImplContractArtifactName: newName,
          isBeacon: "true",
        },
      ];
      await deploy(params[0].newImplContractArtifactName, {
        from: deployer,
        log: true,
        libraries: params[0].newImplContractLibraries,
      });

      const args = await run("scheduleBatchContractUpgrade", {
        params: JSON.stringify(params),
      });

      const newImplContract = await getContract(newName);
      const payload = PrimexProxyAdmin.interface.encodeFunctionData("upgradeBeacon", [pTokenFactory.address, newImplContract.address]);
      const expectedArgs = [[], [], []];
      expectedArgs[0].push(PrimexProxyAdmin.address);
      expectedArgs[1].push(value);
      expectedArgs[2].push(payload);
      expectedArgs.push(predecessor, salt);
      expect(args).to.deep.equal(expectedArgs);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await network.provider.send("evm_mine");

      const txGrantRoleExecutor = await bigTimeLock.grantRole(keccak256(toUtf8Bytes("EXECUTOR_ROLE")), deployer);
      await txGrantRoleExecutor.wait();
      await bigTimeLock.executeBatch(...args);

      const newImpl = await pTokenFactory.implementation();
      expect(newImpl).not.to.equal(oldImpl);
      const newToken = await getContractAt(newName, tokenAddress);

      // test new pure function
      expect(await newToken.testUpgrade()).to.equal(newName);

      // test setter
      await newToken.setValue(23);
      expect(await newToken.value()).to.equal(23);

      // test old function
      const bucketInNewImpl = await newToken.bucket();
      expect(bucketInNewImpl).to.equal(bucketInOldImpl);
    });

    it("should upgrade contract DebtToken", async function () {
      const debtTokenFactory = await getContract("DebtTokensFactory");

      const name = "DebtToken";
      const newName = "DebtTokenV2";
      const tx = await debtTokenFactory.connect(bucketsFactorySigner).createDebtToken("DToken", "DT", "18");
      const txSuccess = await tx.wait();
      const tokenAddress = addressFromEvent("DebtTokenCreated", txSuccess);
      const oldToken = await getContractAt(name, tokenAddress);
      const bucketInOldImpl = await oldToken.bucket();

      const oldImpl = await debtTokenFactory.implementation();

      const params = [
        {
          proxyAddress: debtTokenFactory.address,
          oldImplContractArtifactName: name,
          newImplContractArtifactName: newName,
          isBeacon: "true",
        },
      ];

      await deploy(params[0].newImplContractArtifactName, {
        from: deployer,
        log: true,
        libraries: params[0].newImplContractLibraries,
      });

      const args = await run("scheduleBatchContractUpgrade", {
        params: JSON.stringify(params),
      });

      const newImplContract = await getContract(newName);
      const payload = PrimexProxyAdmin.interface.encodeFunctionData("upgradeBeacon", [debtTokenFactory.address, newImplContract.address]);
      const expectedArgs = [[], [], []];
      expectedArgs[0].push(PrimexProxyAdmin.address);
      expectedArgs[1].push(value);
      expectedArgs[2].push(payload);
      expectedArgs.push(predecessor, salt);
      expect(args).to.deep.equal(expectedArgs);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);
      await network.provider.send("evm_mine");

      const txGrantRoleExecutor = await bigTimeLock.grantRole(keccak256(toUtf8Bytes("EXECUTOR_ROLE")), deployer);
      await txGrantRoleExecutor.wait();
      await bigTimeLock.executeBatch(...args);

      const newImpl = await debtTokenFactory.implementation();
      expect(newImpl).not.to.equal(oldImpl);
      const newToken = await getContractAt(newName, tokenAddress);

      // test new pure function
      expect(await newToken.testUpgrade()).to.equal(newName);

      // test setter
      await newToken.setValue(23);
      expect(await newToken.value()).to.equal(23);

      // test old function
      const bucketInNewImpl = await newToken.bucket();
      expect(bucketInNewImpl).to.equal(bucketInOldImpl);
    });
  });
});
