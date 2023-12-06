// SPDX-License-Identifier: BUSL-1.1
const { BAR_CALC_PARAMS_DECODE } = require("../../../test/utils/constants");

module.exports = async function (args, hre) {
  const { encodeFunctionData } = require("../../utils/encodeFunctionData.js");
  const {
    deployments,
    network,
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { keccak256, toUtf8Bytes, getAddress },
    },
  } = hre;
  const out = {};
  args = await validateArgs(args, hre);

  // Step 1
  // deploy bucket
  if (args.flowConfig.steps["1"]) {
    const params = {
      nameBucket: args.nameBucket,
      positionManager: args.positionManager,
      priceOracle: args.priceOracle,
      dns: args.primexDNS,
      reserve: args.reserve,
      whiteBlackList: args.whiteBlackList,
      assets: args.assets,
      underlyingAsset: args.underlyingAsset,
      feeBuffer: args.feeBuffer,
      withdrawalFeeRate: args.withdrawalFeeRate,
      reserveRate: args.reserveRate,
      // liquidityMining params
      liquidityMiningRewardDistributor: args.liquidityMiningRewardDistributor,
      liquidityMiningAmount: args.liquidityMiningAmount,
      liquidityMiningDeadline: args.liquidityMiningDeadline,
      stabilizationDuration: args.stabilizationDuration,
      interestRateStrategy: args.interestRateStrategy,
      maxAmountPerUser: args.maxAmountPerUser,
      isReinvestToAaveEnabled: args.isReinvestToAaveEnabled,
      estimatedBar: args.estimatedBar,
      estimatedLar: args.estimatedLar,
      barCalcParams: args.barCalcParams,
      maxTotalDeposit: args.maxTotalDeposit,
    };
    if (args.flowConfig.execute) {
      const bucketsFactory = await getContractAt("BucketsFactory", args.bucketsFactory);
      const txCreateBucket = await bucketsFactory.createBucket(params);

      if (!process.env.TEST) {
        console.log(`\nBucketsFactory(${bucketsFactory.address}) call function createBucket`);
        console.log(`tx - ${txCreateBucket.hash}`);
      }
      const txCreateBucketSuccess = await txCreateBucket.wait();

      for (let i = 0; i < txCreateBucketSuccess.events.length; i++) {
        if (txCreateBucketSuccess.events[i].event === "BucketCreated") {
          out.newBucket = getAddress("0x" + txCreateBucketSuccess.events[i].data.slice(26));
        }
      }
      const newBucket = await getContractAt("Bucket", out.newBucket);
      out.newPToken = await newBucket.pToken();
      out.newDebtToken = await newBucket.debtToken();

      if (!process.env.TEST) {
        console.log(`Bucket deployed on address ${out.newBucket}`);
        console.log(`PToken deployed on address ${out.newPToken}`);
        console.log(`DebtToken deployed on address ${out.newDebtToken}`);
      }
    } else {
      out.MediumTimelockAdmin = [];
      out.MediumTimelockAdmin.push(await encodeFunctionData("createBucket", [params], "BucketsFactory", args.bucketsFactory));
    }
  }
  //

  // Step 2
  // Add bucket in dns. Give bucket role. Add bucket and its tokens to whitelist
  if (args.flowConfig.steps["2"]) {
    const NO_FEE_ROLE = keccak256(toUtf8Bytes("NO_FEE_ROLE"));
    const VAULT_ACCESS_ROLE = keccak256(toUtf8Bytes("VAULT_ACCESS_ROLE"));
    if (args.flowConfig.execute) {
      const whiteBlackList = await getContractAt("WhiteBlackList", args.whiteBlackList);
      let tx = await whiteBlackList.addAddressesToWhitelist([out.newBucket, out.newPToken, out.newDebtToken]);
      await tx.wait();

      const primexDNS = await getContractAt("PrimexDNS", args.primexDNS);
      const contractPMX = await getContractAt("EPMXToken", args.pmx);
      const { deployer } = await getNamedSigners();
      const allowance = await contractPMX.allowance(deployer.address, primexDNS.address);
      if (allowance.lt(args.pmxRewardAmount)) {
        tx = await contractPMX.approve(primexDNS.address, args.pmxRewardAmount);
        await tx.wait();
      }

      const txAddBucket = await primexDNS.addBucket(out.newBucket, args.pmxRewardAmount);
      await txAddBucket.wait();
      if (!process.env.TEST) {
        console.log(`\nPrimexDNS(${primexDNS.address}) call function \naddBucket(${out.newBucket})\ntx - ${txAddBucket.hash}\n`);
      }

      const registry = await getContractAt("PrimexRegistry", args.registry);
      let txGrantRole = await registry.grantRole(NO_FEE_ROLE, out.newBucket);
      await txGrantRole.wait();

      txGrantRole = await registry.grantRole(VAULT_ACCESS_ROLE, out.newBucket);
      await txGrantRole.wait();
      const pToken = await getContractAt("PToken", out.newPToken);
      const debtToken = await getContractAt("DebtToken", out.newDebtToken);

      tx = await pToken.setLenderRewardDistributor(args.activityRewardDistributor);
      await tx.wait();
      tx = await debtToken.setTraderRewardDistributor(args.activityRewardDistributor);
      await tx.wait();
      if (network.name !== "hardhat") {
        const newBucket = await getContractAt("Bucket", out.newBucket);

        const bucketArtifact = {
          address: out.newBucket,
          abi: (await deployments.getArtifact("Bucket")).abi,
        };
        await deployments.save(await newBucket.name(), bucketArtifact);

        const pTokenArtifact = {
          address: out.newPToken,
          abi: (await deployments.getArtifact("PToken")).abi,
        };
        await deployments.save(await pToken.symbol(), pTokenArtifact);

        const DebtTokenArtifact = {
          address: out.newDebtToken,
          abi: (await deployments.getArtifact("DebtToken")).abi,
        };
        await deployments.save(await debtToken.symbol(), DebtTokenArtifact);
      }
    } else {
      if (out.MediumTimelockAdmin === undefined) out.MediumTimelockAdmin = [];
      const { bucket, PToken, DebtToken, needPMX, needApprove } = args.flowConfig.step2Params;
      out.MediumTimelockAdmin.push(
        await encodeFunctionData("addAddressesToWhitelist", [[bucket, PToken, DebtToken]], "WhiteBlackList", args.whiteBlackList),
      );
      out.BigTimelockAdmin = [];
      if (needPMX) {
        out.BigTimelockAdmin.push(
          await encodeFunctionData(
            "transferFromTreasury",
            [args.pmxRewardAmount, args.pmx, args.bigTimelockAdmin],
            "Treasury",
            args.treasury,
          ),
        );
      }
      if (needApprove) {
        out.BigTimelockAdmin.push(await encodeFunctionData("approve", [args.primexDNS, args.pmxRewardAmount], "EPMXToken", args.pmx));
      }
      out.BigTimelockAdmin.push(await encodeFunctionData("addBucket", [bucket, args.pmxRewardAmount], "PrimexDNS", args.primexDNS));
      out.BigTimelockAdmin.push(await encodeFunctionData("grantRole", [NO_FEE_ROLE, bucket], "PrimexRegistry", args.registry));
      out.BigTimelockAdmin.push(await encodeFunctionData("grantRole", [VAULT_ACCESS_ROLE, bucket], "PrimexRegistry", args.registry));
      out.BigTimelockAdmin.push(await encodeFunctionData("setLenderRewardDistributor", [args.activityRewardDistributor], "PToken", PToken));
      out.BigTimelockAdmin.push(
        await encodeFunctionData("setTraderRewardDistributor", [args.activityRewardDistributor], "DebtToken", DebtToken),
      );
    }
  }

  return out;
};

async function validateArgs(
  args,
  {
    ethers: {
      BigNumber,
      getContract,
      getContractAt,
      constants: { AddressZero },
      utils: { defaultAbiCoder, isAddress },
    },
  },
) {
  if (!args.primexDNS) {
    args.primexDNS = (await getContract("PrimexDNS")).address;
  }

  if (!args.bucketsFactory) {
    args.bucketsFactory = (await getContract("BucketsFactory")).address;
  }

  if (!args.positionManager) {
    args.positionManager = (await getContract("PositionManager")).address;
  }

  if (!args.priceOracle) {
    args.priceOracle = (await getContract("PriceOracle")).address;
  }

  if (!args.reserve) {
    args.reserve = (await getContract("Reserve")).address;
  }
  if (!args.whiteBlackList) {
    args.whiteBlackList = (await getContract("WhiteBlackList")).address;
  }
  if (!args.pmx) {
    args.pmx = (await getContract("EPMXToken")).address;
  }

  if (!args.interestRateStrategy) {
    args.interestRateStrategy = (await getContract("InterestRateStrategy")).address;
  }

  if (!args.bigTimelockAdmin) {
    args.bigTimelockAdmin = (await getContract("BigTimelockAdmin")).address;
  }

  if (!args.treasury) {
    args.treasury = (await getContract("Treasury")).address;
  }

  if (!args.registry) {
    args.registry = (await getContract("Registry")).address;
  }

  if (!args.activityRewardDistributor) {
    args.activityRewardDistributor = (await getContract("ActivityRewardDistributor")).address;
  }

  // if liquidityMiningAmount 0 liquidityMining is off
  if (BigNumber.from(args.liquidityMiningAmount).eq(0)) {
    args.pmxRewardAmount = 0;
    args.liquidityMiningRewardDistributor = AddressZero;
    args.liquidityMiningDeadline = 0;
    args.stabilizationDuration = 0;
    args.maxAmountPerUser = 0;
  } else {
    if (args.maxAmountPerUser === undefined) throw new Error("amount-per-user is undefined");
    if (args.pmxRewardAmount === undefined) throw new Error("pmx-reward-amount is undefined");
    if (args.liquidityMiningRewardDistributor === undefined)
      args.liquidityMiningRewardDistributor = (await getContract("LiquidityMiningRewardDistributor")).address;
    if (args.liquidityMiningDeadline === undefined) throw new Error("liquidity-mining-deadline is undefined");
    if (args.stabilizationDuration === undefined) throw new Error("stabilization-period-duration is undefined");
  }

  if (!args.liquidityMiningRewardDistributor) {
    args.liquidityMiningRewardDistributor = (await getContract("LiquidityMiningRewardDistributor")).address;
  }
  args.assets = JSON.parse(args.assets);
  args.barCalcParams = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(JSON.parse(args.barCalcParams))]);
  args.flowConfig = JSON.parse(args.flowConfig);

  if (!args.flowConfig.execute && args.flowConfig.steps["2"]) {
    if (
      !(
        isAddress(args.flowConfig.step2Params.bucket) &&
        isAddress(args.flowConfig.step2Params.PToken) &&
        isAddress(args.flowConfig.step2Params.DebtToken)
      )
    ) {
      throw new Error("expected addresses of Bucket,PToken,DebtToken should only be defined together");
    }
  }

  const primexDNS = await getContractAt("PrimexDNS", args.primexDNS);
  if ((await primexDNS.buckets(args.nameBucket)).bucketAddress !== AddressZero) throw new Error("BUCKET_IS_ALREADY_ADDED");

  return args;
}
