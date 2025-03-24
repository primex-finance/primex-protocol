// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");

module.exports = async function (
  { __ },
  {
    network,
    ethers: {
      getContract,
      getContractAt,
      providers,
      constants: { HashZero },
      utils: { parseEther },
      provider,
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { getConfigByName } = require("../../config/configUtils.js");
  const { networks } = require("../../hardhat.config.js");
  const addresses = getConfigByName("addresses.json");


  const chainId = (await provider.getNetwork()).chainId;

  // immutable
  const mediumTimeLock = await getContract("MediumTimelockAdmin");

  const mediumDelay = await mediumTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForMediumTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const buckets = {
    polygon: ["Test Bucket WBTC"]
    ,
    arbitrumOne: 
      ["Test Bucket USDC",
        "Test Bucket WETH",
        "Test Bucket WETH 2",
        "Test Bucket ARB_fail",
        "Test Bucket USDC_depr",
        "Test Bucket ARB_acc",
        "Test Bucket ARB_acc2",
        "Test Bucket USDC_depr2",
        "Primex Bucket WBTC"
      ]
    ,
    ethereum: ["Primex Bucket MATIC"]

  };


  for(let i = 0; i < buckets[network.name].length; i++) {
    const encodeResult = await encodeFunctionData(
      "withdrawPmxByAdmin",
      [buckets[network.name][i]],
      "LiquidityMiningRewardDistributor",
    );
    argsForMediumTimeLock.targets.push(encodeResult.contractAddress);
    argsForMediumTimeLock.payloads.push(encodeResult.payload);
  }

  const output = [
    argsForMediumTimeLock.targets,
    Array(argsForMediumTimeLock.targets.length).fill(0),
    argsForMediumTimeLock.payloads,
    predecessor,
    salt,
    mediumDelay.toString(),
  ];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "WithdrawEpmxFromLmDistributor");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "WithdrawEpmxFromLmDistributor_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "WithdrawEpmxFromLmDistributor_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "WithdrawEpmxFromLmDistributor_execute.json"), JSON.stringify(executeBatchData, null, 2));

  const rpcUrl = networks[network.name].url;
  const provider1 = new providers.JsonRpcProvider(rpcUrl);

  const impersonateAddress = addresses.adminAddress; // gnosis
  await provider1.send("hardhat_impersonateAccount", [impersonateAddress]);
  await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);
  const impersonateAccount = provider1.getSigner(impersonateAddress);


  try {
    let tx = await mediumTimeLock.connect(impersonateAccount).scheduleBatch(...output);
    await tx.wait();

    const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(mediumDelay.toString());

    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

    tx = await mediumTimeLock.connect(impersonateAccount).executeBatch(...output.slice(0, output.length - 1));
    await tx.wait();

    console.log("Executing was successful");
  } catch (error) {
    console.log(error);
  }


  async function prepareScheduleData(output) {
    const scheduleData = {
      chainId: chainId,
      meta: {
        name: "Single Batch Schedule Transaction",
        description: "Single MediumTimelockAdmin.scheduleBatch to withdraw epmx from LMRewardDistributor",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt, delay] = output;
    const encodeResult = await encodeFunctionData(
      "scheduleBatch",
      [target, value, payload, predecessor, salt, delay],
      "MediumTimelockAdmin",
    );

    scheduleData.transactions.push({
      to: encodeResult.contractAddress,
      value: "0",
      data: encodeResult.payload,
      contractMethod: null,
      contractInputsValues: null,
    });

    return scheduleData;
  }

  async function prepareExecuteData(output) {
    const executeData = {
      chainId: chainId,
      meta: {
        name: "Single Batch Execute Transaction",
        description: "Single MediumTimelockAdmin.executeBatch to withdraw epmx from LMRewardDistributor",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt] = output;
    const encodeResult = await encodeFunctionData("executeBatch", [target, value, payload, predecessor, salt], "MediumTimelockAdmin");

    executeData.transactions.push({
      to: encodeResult.contractAddress,
      value: "0",
      data: encodeResult.payload,
      contractMethod: null,
      contractInputsValues: null,
    });

    return executeData;
  }
};
