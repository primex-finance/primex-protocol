// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const path = require("path");
const ethers = require("ethers");

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
  const bigTimeLock = await getContract("BigTimelockAdmin");

  const bigDelay = await bigTimeLock.getMinDelay();
  const predecessor = HashZero;
  const salt = HashZero;
  const argsForBigTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const MSG_TYPE = 1;

  const eids = {
    "baseMainnet": 30184,
    "arbitrumOne": 30110,
    "ethereum": 30101,
    "polygon": 30109,
    "bsc":30102
  };

  const options = ethers.utils.arrayify("0x00030100110100000000000000000000000000030d40");

  const contractParams =[];

  for(const eid in eids) {
    if(eid === network.name)
      continue;

    const param = {
      eid: eids[eid],  // uint32
      msgType: MSG_TYPE,  // uint16
      options: options  // bytes
    };

    contractParams.push(param);
  }


  const encodeResult = await encodeFunctionData(
    "setEnforcedOptions",
    [contractParams],
    "PrimexOFT"
  );
 
  argsForBigTimeLock.targets.push(encodeResult.contractAddress);
  argsForBigTimeLock.payloads.push(encodeResult.payload);
  
  const output = [
    argsForBigTimeLock.targets,
    Array(argsForBigTimeLock.targets.length).fill(0),
    argsForBigTimeLock.payloads,
    predecessor,
    salt,
    bigDelay.toString(),
  ];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetEnforcedOptionsLZ");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetEnforcedOptionsLZ_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetEnforcedOptionsLZ_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetEnforcedOptionsLZ_execute.json"), JSON.stringify(executeBatchData, null, 2));

  const rpcUrl = networks[network.name].url;
  const provider1 = new providers.JsonRpcProvider(rpcUrl);

  const impersonateAddress = addresses.adminAddress; // gnosis
  await provider1.send("hardhat_impersonateAccount", [impersonateAddress]);
  await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);
  const impersonateAccount = provider1.getSigner(impersonateAddress);


  try {
    let tx = await bigTimeLock.connect(impersonateAccount).scheduleBatch(...output);
    await tx.wait();

    const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(bigDelay.toString());

    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

    tx = await bigTimeLock.connect(impersonateAccount).executeBatch(...output.slice(0, output.length - 1));
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
        description: "Single BigTimelockAdmin.scheduleBatch to withdraw epmx from LMRewardDistributor",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt, delay] = output;
    const encodeResult = await encodeFunctionData(
      "scheduleBatch",
      [target, value, payload, predecessor, salt, delay],
      "BigTimelockAdmin",
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
        description: "Single BigTimelockAdmin.executeBatch to withdraw epmx from LMRewardDistributor",
      },
      transactions: [],
    };
    const [target, value, payload, predecessor, salt] = output;
    const encodeResult = await encodeFunctionData("executeBatch", [target, value, payload, predecessor, salt], "BigTimelockAdmin");

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
