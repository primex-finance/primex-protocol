// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const { getConfig, getConfigByName } = require("../../config/configUtils");

module.exports = async function (
  { bucketsConfig, isExecute },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits },
      constants: { HashZero },
      provider,
    },
  },
) {
  if (bucketsConfig === undefined) bucketsConfig = "buckets.json";
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

  const defaultFlowConfig = {
    execute: true,
    steps: {
      1: true,
      2: true,
    },
  };

  const allOutput = { MediumTimelockAdmin: { targets: [], payloads: [] }, BigTimelockAdmin: { targets: [], payloads: [] } };
  for (const bucket of buckets) {
    const LM = bucket.LiquidityMining;
    if (bucket.flowConfig === undefined) {
      bucket.flowConfig = defaultFlowConfig;
    }

    const underlyingAsset = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", assets[bucket.tokenName]);

    const assetAddresses = bucket.allowedAssets.map(asset => assets[asset]);

    const decimals = await underlyingAsset.decimals();

    let LMAmount = "0";
    let LMDeadline = "0";
    let stabilizationDuration = "0";
    let pmxRewardAmount = "0";
    let maxAmountPerUser = "0";
    let isReinvestToAaveEnabled = false;
    if (Object.keys(LM).length !== 0) {
      LMAmount = parseUnits(LM.accumulatingAmount.toString(), decimals).toString();
      // execute
      LMDeadline = isExecute ? LM.LMDeadline.toString() : getLiquidityMiningDeadline(LM.maxDurationInDays * SECONDS_PER_DAY).toString();
      if (!bucket.flowConfig.execute) {
        console.log(`!!! set LMDeadline=${LMDeadline} in config in bucket "${bucket.bucketName}" in LiquidityMining.LMDeadline!!!`);
      }
      stabilizationDuration = (LM.stabilizationDurationInDays * SECONDS_PER_DAY).toString();
      maxAmountPerUser = parseUnits(LM.maxAmountPerUser.toString(), decimals).toString();
      pmxRewardAmount = parseUnits(LM.pmxRewardAmount.toString(), earlyPmxDecimals).toString();
      isReinvestToAaveEnabled = LM.isReinvestToAaveEnabled;
    }

    const maxTotalDeposit = parseUnits(bucket.maxTotalDeposit.toString(), decimals).toString();

    const out = await run("deploy:Bucket", {
      nameBucket: bucket.bucketName,
      assets: JSON.stringify(assetAddresses),
      underlyingAsset: underlyingAsset.address,
      feeBuffer: bucket.feeBuffer,
      withdrawalFeeRate: bucket.withdrawalFeeRate,
      reserveRate: bucket.reserveRate,
      // liquidity mining params
      liquidityMiningAmount: LMAmount,
      liquidityMiningDeadline: LMDeadline,
      stabilizationDuration: stabilizationDuration,
      estimatedBar: bucket.estimatedBar,
      estimatedLar: bucket.estimatedLar,
      pmxRewardAmount: pmxRewardAmount,
      maxAmountPerUser: maxAmountPerUser,
      isReinvestToAaveEnabled: isReinvestToAaveEnabled,
      barCalcParams: JSON.stringify(bucket.barCalcParams),
      maxTotalDeposit: maxTotalDeposit,
      flowConfig: JSON.stringify(bucket.flowConfig),
    });
    if (bucket.flowConfig.execute) continue;

    for (const timelock in out) {
      for (const action of out[timelock]) {
        allOutput[timelock].targets.push(action.contractAddress);
        allOutput[timelock].payloads.push(action.payload);
      }
    }
  }

  const predecessor = HashZero;
  const salt = HashZero;
  const errors = {};
  for (const timelockName in allOutput) {
    const { targets, payloads } = allOutput[timelockName];
    const timelock = await getContract(timelockName);
    if (targets.length === 0) continue;
    const values = new Array(targets.length).fill(0);
    const delay = (await timelock.getMinDelay()).toString();

    if (isExecute) {
      console.log("Executing setup buckets...");
      const args = [targets, values, payloads, predecessor, salt];
      try {
        const tx = await timelock.executeBatch(...args);
        await tx.wait();
        console.log("BucketsFactory: setup buckets executed");
      } catch (error) {
        errors[timelockName] = { error: error, args: args };
        console.log("error. Logs in setupBuckets-errors.json");
      }
    } else {
      console.log("Scheduling setup buckets...");
      const args = [targets, values, payloads, predecessor, salt, delay];
      try {
        const tx = await timelock.scheduleBatch(...args);
        await tx.wait();
        console.log(`BucketsFactory: setup buckets scheduled in ${delay}s`);
      } catch (error) {
        errors[timelockName] = { error: error, args: args };
        console.log("error. Logs in setupBuckets-errors.json");
      }
    }
  }
  if (Object.keys(errors).length !== 0) {
    fs.writeFileSync("./setupBuckets-errors.json", JSON.stringify(errors, null, 2));
  }
};
