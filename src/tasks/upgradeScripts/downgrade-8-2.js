// SPDX-License-Identifier: BUSL-1.1
const { BigNumber } = require("ethers");
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    run,
    network,
    getNamedAccounts,
    deployments: { deploy, get },
    ethers: {
      getContract,
      providers,
      getContractAt,
      utils: { keccak256, toUtf8Bytes },
      constants: { HashZero, AddressZero },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { CurveOracleKind } = require("../../test/utils/constants");

  const { FeeRateType } = require("../../test/utils/constants");
  const { deployer } = await getNamedAccounts();

  const generalConfig = getConfigByName("generalConfig.json");
  const addresses = getConfigByName("addresses.json");

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  const oldImplementationAddresses = {
    polygon: {
      KeeperRewardDistributor: "0x9c66975aE3A563c6646a3Df842743f8b903d567E",
      DepositManager: "0xF2cD62B11208CAbEb944b6C19c9fcf5529f34D4D",
      PriceOracle: "0x94e6d6447b3b540C5AcFC9A62aF2579afC432F1E",
      SwapManager: "0xF2EA22CAB2C7D5B4f4ac550139d0874B203555F0",
      TraderBalanceVault: "0xC174045ae00ccdbb6431DEd9d3FC244Eb2FCd983",
      PrimexDNS: "0x4f20495a1EF75662F64AFFdfc805d0e35849a6DA",
      PositionManager: "0x27cb9F0D80B01c1061dA05a526e1B25E417b16dD",
      LimitOrderManager: "0xECB37dF377DFE73C8DC332714Cf59B8842Ad62c2",
      BatchManager: "0xcdF3Ed05dF7Ed6eb4Cb010CCFc837764a3B91368",
    },
    ethereum: {
      KeeperRewardDistributor: "0x158Ed66Bc58050Ce3c241Dcc8284bfE825B08ffF",
      DepositManager: "0xDbF52908EFCDF3C64b6aE279A4Bf1ebCce9e24F9",
      PriceOracle: "0xa8F3a00eCace7e31625a435817D5475B6D340F1a",
      SwapManager: "0xb0BFd9bC392089DF7C84AA684b452226fecE18C1",
      TraderBalanceVault: "0x827349BA4738eFAfF783026864B4fAB6585a38E4",
      PrimexDNS: "0x8FEC6Cd32a551158930608c913b364DCF068Bb54",
      PositionManager: "0xA1E04e399F92bf0A10D6ACe3C98F511e52106a2b",
      LimitOrderManager: "0x4BAeF0A6D8F0bE216C611CBb8405A81604483Df8",
      BatchManager: "0x5c485ef4398dBefB9d30d645ef5a9Bd660B7b0e1",
    },
    arbitrumOne: {
      KeeperRewardDistributor: "0x7B159c8f1BE0Eac861f07C17B1b6BEE8be2145f7",
      DepositManager: "0x9E6B2406d54A392Fd29DD0754452e9Eb0E000608",
      PriceOracle: "0x7B67D94671ac10d622086be001772728DC33b0e8",
      SwapManager: "0xbB8EBCA9Aac408D679799A9017cfa252CABeD289",
      TraderBalanceVault: "0x2067EaB9Da0A96E291B1cAB1a4105A1AEe62651A",
      PrimexDNS: "0x09c7839F2f5146E9c82D7A2bD1d45780b396d8F9",
      PositionManager: "0x730E16b4F482258AB7158aC43A76Fbe62b8dA5F1",
      LimitOrderManager: "0xAcD80Ca47FBe48967a3c63Aa7bAcb8D47800d4F0",
      BatchManager: "0x494b1aC9d8ed0683690B8e30Ce65c46b13aBFe42",
    },
    baseMainnet: {
      KeeperRewardDistributor: "0xf95ad1a0A5199179bf5a985898d28A7afdf343C5",
      DepositManager: "0xa6d76535e265357187653d4AAd9b362404D42EA8",
      PriceOracle: "0x26Cd2eC49982e2cC53C15302480b638694EA231d",
      SwapManager: "0x7bE64C951880224184F0191Fe795C0416F4ADcbB",
      TraderBalanceVault: "0x09c707E75F5226B499F0D67143abcb9F87Fc9Feb",
      PrimexDNS: "0xE56d397236252188dd45aba573D57c1Fa4a8E75C",
      PositionManager: "0xc9C289bf4c0189e9D3c0C54ddc828C1EA8e06493",
      LimitOrderManager: "0x37B63C1BFbf1203057DB510516C3B32E724e9496",
      BatchManager: "0xdb72b9150F1785a9E362227B1fA86cEC11E8f1eB",
    },
  };

  const oldContractsAddresses = {
    polygon: {
      PositionManagerExtension: "0x01DF98f11ECaD31937f57CD543BF8B136De03a21",
      LimitPriceCOM: "0xcfC69932e5F67347E7830e78Ea4e28b1d783e239",
      TakeProfitStopLossCCM: "0x2e74303c77041eEed358CBC9B4084F1f63b4Db10",
      BucketExtension: "0x9f5Ae643a789186b7cFc1aBa05fe20d61Ff6f16c",
      DexAdapter: "0xA057d750A411CB8fEfFC6481Fc2e155cfc9a64B9",
    },
    ethereum: {
      PositionManagerExtension: "0x9FDC2AD2F2d800079d719FbB271Df54cC2b75C2b",
      LimitPriceCOM: "0x03659d6587e9Afb92bc10b6CaDA8C59CdB93f4eD",
      TakeProfitStopLossCCM: "0x0c2CAC9648eA7241AbB4e0EE5603C590cf629678",
      BucketExtension: "0xACdaC5fEfb7514A8A4cc1661Af7cB8F3fE7C531D",
      DexAdapter: "0x4bba96F8DCA2f341d71310470D73bcbf101bEF28",
    },
    arbitrumOne: {
      PositionManagerExtension: "0xD780528a6fDD910f019eB3733F44B22EA0D3c59c",
      LimitPriceCOM: "0x61bB4eDC71b2D15A012Ca687De4060F8e40E5696",
      TakeProfitStopLossCCM: "0x19eA3Ec59790C5D474f6491C62E6C1eEa496623E",
      BucketExtension: "0xA5725790E4D16a1227a73A0000a40CF62a4230dD",
      DexAdapter: "0x19fd558449aba4dE493E8a06085F394C9C535361",
    },
    baseMainnet: {
      PositionManagerExtension: "0x95aEfcf9eC798Bd8867028ea506fFF71EAE4e617",
      LimitPriceCOM: "0x2CE1864847493d98DC170FC8B61339EB513e3EB5",
      TakeProfitStopLossCCM: "0x9E1b262f26D8ffA6C0Cc4361854Ff766bf03f124",
      BucketExtension: "0x97f254E6eD709D41985C96280D20c36D3b9E0400",
      DexAdapter: "0x8E6b04C9E531A645d871D2Ec1f0B3D1AF18233dA",
    },
  };

  // immutable addresses
  const bigTimeLock = await getContract("BigTimelockAdmin");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexDNSProxy = await getContract("PrimexDNS_Proxy");
  const PrimexDNS = await getContractAt("PrimexDNS", PrimexDNSProxy.address);
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const BucketsFactory = await getContract("BucketsFactory");
  const PriceOracle = await getContract("PriceOracle");
  const PositionManager = await getContract("PositionManager");
  const KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const LimitOrderManager = await getContract("LimitOrderManager");
  const TraderBalanceVault = await getContract("TraderBalanceVault");
  const DepositManager = await getContract("DepositManager");
  const SwapManager = await getContract("SwapManager");
  const BucketsFactoryV2 = await getContract("BucketsFactoryV2");
  const BatchManager = await getContract("BatchManager");
  let tx;

  const bigDelay = await bigTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const addToWhiteList = [];
  const removeFromWhiteList = [];

  async function downgradeProxy({ proxyAddress, contractName, isBeacon }) {
    const implAddress = oldImplementationAddresses[network.name][contractName];
    argsForBigTimeLock.targets.push(PrimexProxyAdmin.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          isBeacon ? "upgradeBeacon" : "upgrade",
          [proxyAddress, implAddress],
          "PrimexProxyAdmin",
          PrimexProxyAdmin.address,
        )
      ).payload,
    );
  }

  if (!executeUpgrade) {
    /**
     * KeeperRewardDistributor downgrade
     */
    await downgradeProxy({
      proxyAddress: KeeperRewardDistributor.address,
      contractName: "KeeperRewardDistributor",
      isBeacon: false,
    });

    argsForBigTimeLock.targets.push(DepositManager.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setMagicTierCoefficient", [0], "DepositManager", DepositManager.address)).payload,
    );

    /**
     * DepositManager downgrade
     */

    await downgradeProxy({
      proxyAddress: DepositManager.address,
      contractName: "DepositManager",
      isBeacon: false,
    });

    // PriceOracle setting
    if (network.name !== "polygon" && network.name !== "baseMainnet") {
      argsForBigTimeLock.targets.push(PriceOracle.address);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setOrallyOracle", [AddressZero], "PriceOracle", PriceOracle.address)).payload,
      );
    }

    // PriceOracle setting
    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push((await encodeFunctionData("setOrallyTimeTolerance", [0], "PriceOracle", PriceOracle.address)).payload);

    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("updateCurveTypeOracle", [[CurveOracleKind.STABLE], [AddressZero]], "PriceOracle", PriceOracle.address))
        .payload,
    );

    argsForBigTimeLock.targets.push(PriceOracle.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setUniswapV2LPOracle", [AddressZero], "PriceOracle", PriceOracle.address)).payload,
    );

    /**
     * PriceOracle downgrade
     */

    await downgradeProxy({
      proxyAddress: PriceOracle.address,
      contractName: "PriceOracle",
      isBeacon: false,
    });

    /**
     * SwapManager downgrade
     */

    await downgradeProxy({
      proxyAddress: SwapManager.address,
      contractName: "SwapManager",
      isBeacon: false,
    });

    /**
     * TraderBalanceVault downgrade
     */
    await downgradeProxy({
      proxyAddress: TraderBalanceVault.address,
      contractName: "TraderBalanceVault",
      isBeacon: false,
    });

    // DNS setting
    const feeRateParams = [];

    const dnsConfig = generalConfig.PrimexDNSconfig;

    // push previous values for the zero tier
    for (const key in dnsConfig.feeRates["0"]) {
      const params = {
        feeRateType: FeeRateType[key],
        tier: 0,
        feeRate: 0,
      };
      feeRateParams.push(params);
    }
    // sets only non-zero tier values
    for (const key in dnsConfig.feeRates) {
      if (key === "0") continue;
      for (const orderType in dnsConfig.feeRates[key]) {
        // check whether the key is the magic number
        const tier = isNaN(key) ? BigNumber.from(keccak256(toUtf8Bytes(key))).toString() : key;
        feeRateParams.push({
          feeRateType: FeeRateType[orderType],
          tier: tier,
          feeRate: 0,
        });
      }
    }

    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setProtocolFeeRate", [feeRateParams], "PrimexDNS", PrimexDNS.address)).payload,
    );

    /**
     * DNS downgrade
     */
    await downgradeProxy({
      proxyAddress: PrimexDNS.address,
      contractName: "PrimexDNS",
      isBeacon: false,
    });

    // SET PM Old PM extention
    argsForBigTimeLock.targets.push(PositionManager.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setPositionManagerExtension",
          [oldContractsAddresses[network.name].PositionManagerExtension],
          "PositionManager",
          PositionManager.address,
        )
      ).payload,
    );

    /**
     * PositionManager upgrade
     */
    await downgradeProxy({
      proxyAddress: PositionManager.address,
      contractName: "PositionManager",
      isBeacon: false,
    });

    // set conditional managers
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setConditionalManager",
          ["1", oldContractsAddresses[network.name].LimitPriceCOM],
          "PrimexDNS",
          PrimexDNS.address,
        )
      ).payload,
    );
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (
        await encodeFunctionData(
          "setConditionalManager",
          ["2", oldContractsAddresses[network.name].TakeProfitStopLossCCM],
          "PrimexDNS",
          PrimexDNS.address,
        )
      ).payload,
    );

    // set bucket extention
    const bucketsv1 = await BucketsFactory.allBuckets();
    const bucketsv2 = await BucketsFactoryV2.allBuckets();
    const buckets = [...bucketsv1, ...bucketsv2];

    for (let i = 0; i < buckets.length; i++) {
      argsForBigTimeLock.targets.push(buckets[i]);
      argsForBigTimeLock.payloads.push(
        (await encodeFunctionData("setBucketExtension", [oldContractsAddresses[network.name].BucketExtension], "Bucket", buckets[i]))
          .payload,
      );
    }

    /**
     * LimitOrderManager downgrade
     */
    await downgradeProxy({
      proxyAddress: LimitOrderManager.address,
      contractName: "LimitOrderManager",
      isBeacon: false,
    });

    /**
     * BatchManager upgrade
     */

    await downgradeProxy({
      proxyAddress: BatchManager.address,
      contractName: "BatchManager",
      isBeacon: false,
    });

    /**
     * Redeploy upgrade
     */

    const DexAdapter = await getContract("DexAdapter");

    addToWhiteList.push(oldContractsAddresses[network.name].DexAdapter);
    removeFromWhiteList.push(DexAdapter.address);

    // set new dex adapter
    argsForBigTimeLock.targets.push(PrimexDNS.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("setDexAdapter", [oldContractsAddresses[network.name].DexAdapter], "PrimexDNS", PrimexDNS.address)).payload,
    );

    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [addToWhiteList], "WhiteBlackList", WhiteBlackList.address)).payload,
    );

    argsForBigTimeLock.targets.push(WhiteBlackList.address);
    argsForBigTimeLock.payloads.push(
      (await encodeFunctionData("removeAddressesFromWhitelist", [removeFromWhiteList], "WhiteBlackList", WhiteBlackList.address)).payload,
    );
  }

  let argsBig = [
    argsForBigTimeLock.targets,
    Array(argsForBigTimeLock.targets.length).fill(0),
    argsForBigTimeLock.payloads,
    predecessor,
    salt,
    bigDelay.toString(),
  ];

  let impersonateAccount;
  const rpcUrl = networks[network.name].url;
  const provider = new providers.JsonRpcProvider(rpcUrl);
  if (isFork) {
    const impersonateAddress = addresses.adminAddress; // gnosis
    await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
    await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);
    impersonateAccount = provider.getSigner(impersonateAddress);
  }

  if (executeUpgrade) {
    try {
      argsBig = JSON.parse(fs.readFileSync("./argsForBigTimeLock.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(bigDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await bigTimeLock.connect(impersonateAccount).executeBatch(...argsBig.slice(0, argsBig.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./argsForBigTimeLock.json", JSON.stringify(argsBig, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await bigTimeLock.connect(impersonateAccount).scheduleBatch(...argsBig);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
