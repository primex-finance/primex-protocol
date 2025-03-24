// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");
const { getConfig, getConfigByName } = require("../../config/configUtils.js");
const { BAR_CALC_PARAMS_DECODE } = require("../../test/utils/constants.js");

module.exports = async function (
  { bucketsPerBatch },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits, defaultAbiCoder },
      constants: { HashZero, AddressZero },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const primexDNS = await getContract("PrimexDNS");
  const positionManager = await getContract("PositionManager");
  const priceOracle = await getContract("PriceOracle");
  const reserve = await getContract("Reserve");
  const whiteBlackList = await getContract("WhiteBlackList");
  const interestRateStrategy = await getContract("InterestRateStrategy");
  const smallTimelockAdmin = await getContract("SmallTimelockAdmin");

  const delay = (await smallTimelockAdmin.getMinDelay()).toString();
  const chainId = (await provider.getNetwork()).chainId;

  let bucketsConfig = "newBuckets.json";

  bucketsConfig = getConfigByName(bucketsConfig);

  const { assets } = getConfig();

  const SECONDS_PER_DAY = 24 * 60 * 60;
  const deployDelay = bucketsConfig.DELAY_IN_DAYS_AFTER_DEPLOY * SECONDS_PER_DAY;

  // calculate from one timestamp
  const timestamp = (await provider.getBlock("latest")).timestamp;
  function getLiquidityMiningDeadline(delay) {
    if (delay === 0) return 0;
    return timestamp + delay + deployDelay;
  }

  const buckets = bucketsConfig.buckets.map(bucket => {
    bucket.feeBuffer = parseUnits(bucket.feeBuffer, 18).toString();
    bucket.withdrawalFeeRate = parseUnits(bucket.withdrawalFeeRate, 18).toString();
    bucket.reserveRate = parseUnits(bucket.reserveRate, 18).toString();

    bucket.estimatedBar = parseUnits(bucket.estimatedBar, 27).toString();
    bucket.estimatedLar = parseUnits(bucket.estimatedLar, 27).toString();

    for (const [key, value] of Object.entries(bucket.barCalcParams)) {
      bucket.barCalcParams[key] = parseUnits(value, 27).toString();
    }
    return bucket;
  });

  const earlyPmx = await getContract("EPMXToken");
  const earlyPmxDecimals = await earlyPmx.decimals();

  const output = {};
  for (const bucket of buckets) {
    const LM = bucket.LiquidityMining;

    const underlyingAsset = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", assets[bucket.tokenName]);

    const assetAddresses = bucket.allowedAssets.map(asset => assets[asset]);

    const underlyingAssetDecimals = await underlyingAsset.decimals();

    let LMAmount = 0;
    let LMDeadline = 0;
    let stabilizationDuration = 0;
    let pmxRewardAmount = 0;
    let maxAmountPerUser = 0;
    let isReinvestToAaveEnabled = false;
    if (Object.keys(LM).length !== 0) {
      LMAmount = parseUnits(LM.accumulatingAmount.toString(), underlyingAssetDecimals).toString();
      LMDeadline = getLiquidityMiningDeadline(LM.maxDurationInDays * SECONDS_PER_DAY).toString();
      stabilizationDuration = (LM.stabilizationDurationInDays * SECONDS_PER_DAY).toString();
      maxAmountPerUser = parseUnits(LM.maxAmountPerUser.toString(), underlyingAssetDecimals).toString();
      pmxRewardAmount = parseUnits(LM.pmxRewardAmount.toString(), earlyPmxDecimals).toString();
      isReinvestToAaveEnabled = LM.isReinvestToAaveEnabled;
    }

    let liquidityMiningRewardDistributor;
    // if liquidityMiningAmount 0 liquidityMining is off
    if (Object.keys(LM).length === 0) {
      liquidityMiningRewardDistributor = AddressZero;
    } else {
      if (maxAmountPerUser === undefined) throw new Error("amount-per-user is undefined");
      if (pmxRewardAmount === undefined) throw new Error("pmx-reward-amount is undefined");
      if (liquidityMiningRewardDistributor === undefined)
        liquidityMiningRewardDistributor = (await getContract("LiquidityMiningRewardDistributor")).address;
      if (LMDeadline === undefined) throw new Error("liquidity-mining-deadline is undefined");
      if (stabilizationDuration === undefined) throw new Error("stabilization-period-duration is undefined");
    }
    const maxTotalDeposit = parseUnits(bucket.maxTotalDeposit.toString(), underlyingAssetDecimals).toString();
    const barCalcParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(bucket.barCalcParams)]);
    const params = {
      nameBucket: bucket.bucketName,
      positionManager: positionManager.address,
      priceOracle: priceOracle.address,
      dns: primexDNS.address,
      reserve: reserve.address,
      whiteBlackList: whiteBlackList.address,
      assets: assetAddresses,
      underlyingAsset: underlyingAsset.address,
      feeBuffer: bucket.feeBuffer,
      withdrawalFeeRate: bucket.withdrawalFeeRate,
      reserveRate: bucket.reserveRate,
      // liquidityMining params
      liquidityMiningRewardDistributor: liquidityMiningRewardDistributor,
      liquidityMiningAmount: LMAmount,
      liquidityMiningDeadline: LMDeadline,
      stabilizationDuration: stabilizationDuration,
      interestRateStrategy: interestRateStrategy.address,
      maxAmountPerUser: maxAmountPerUser,
      isReinvestToAaveEnabled: isReinvestToAaveEnabled,
      estimatedBar: bucket.estimatedBar,
      estimatedLar: bucket.estimatedLar,
      barCalcParams: barCalcParams,
      maxTotalDeposit: maxTotalDeposit,
    };

    const encodeResult = await encodeFunctionData("createBucket", [params], "BucketsFactoryV2");
    const target = encodeResult.contractAddress;
    const payload = encodeResult.payload;
    const value = 0;
    const predecessor = HashZero;
    const salt = HashZero;

    if (!output[bucket.bucketName]) {
      output[bucket.bucketName] = {};
    }
    output[bucket.bucketName] = [target, value, payload, predecessor, salt, delay];
  }

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "CreateNewBuckets");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "CreateBuckets_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleData = await prepareScheduleData(output, bucketsPerBatch);
  const executeData = await prepareExecuteData(output, bucketsPerBatch);

  fs.writeFileSync(path.join(directoryPath, "CreateBuckets_create.json"), JSON.stringify(scheduleData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "CreateBuckets_execute.json"), JSON.stringify(executeData, null, 2));

  async function prepareScheduleData(output, bucketsPerBatch) {
    bucketsPerBatch = parseInt(bucketsPerBatch, 10);
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Batch Schedule Transactions",
        description: "Multiple SmallTimelockAdmin.scheduleBatch with parameters to create new buckets",
      },
      transactions: [],
    };

    const buckets = Object.keys(output);
    for (let i = 0; i < buckets.length; i += bucketsPerBatch) {
      const targets = [];
      const values = [];
      const payloads = [];
      const predecessor = HashZero;
      const salt = HashZero;
      for (let j = i; j < i + bucketsPerBatch && j < buckets.length; j++) {
        const data = output[buckets[j]];
        const [target, value, payload] = data;
        targets.push(target);
        values.push(value);
        payloads.push(payload);
      }

      const encodeResult = await encodeFunctionData(
        "scheduleBatch",
        [targets, values, payloads, predecessor, salt, delay],
        "SmallTimelockAdmin",
      );

      scheduleData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }

    return scheduleData;
  }

  async function prepareExecuteData(output, bucketsPerBatch) {
    bucketsPerBatch = parseInt(bucketsPerBatch, 10);

    const executeData = {
      chainId: chainId,
      meta: {
        name: "Batch Execute Transactions",
        description: "Multiple SmallTimelockAdmin.executeBatch with parameters to create new buckets",
      },
      transactions: [],
    };

    const buckets = Object.keys(output);
    for (let i = 0; i < buckets.length; i += bucketsPerBatch) {
      const targets = [];
      const values = [];
      const payloads = [];
      const predecessor = HashZero;
      const salt = HashZero;

      for (let j = i; j < i + bucketsPerBatch && j < buckets.length; j++) {
        const data = output[buckets[j]];
        const [target, value, payload] = data;
        targets.push(target);
        values.push(value);
        payloads.push(payload);
      }

      const encodeResult = await encodeFunctionData("executeBatch", [targets, values, payloads, predecessor, salt], "SmallTimelockAdmin");

      executeData.transactions.push({
        to: encodeResult.contractAddress,
        value: "0",
        data: encodeResult.payload,
        contractMethod: null,
        contractInputsValues: null,
      });
    }

    return executeData;
  }
};
