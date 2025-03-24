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

  const addressConfig = {
    polygon: {
      pTokenAddresses: [
        "0x6bda18919edd6515f1ed6d05a61893341381656d",
        "0xafa8e96c8c7c548548124e4a92381a8d97fd81aa",
        "0x460a55c7bc6df03ea4e52436bbf720b73ca2c2b4",
        "0xa40d8ab18963eafc1a4eadb0f916a828635268f7",
        "0x6859650015c09f9c3500fb26e1c7f44c0600ed34"
      ],
      debtTokenAddresses: [
        "0xa4326cdc2dbfc8ac7f408f1ec3267db7ae8ec9d0", 
        "0x39c88deb317a5803c562e02f11de12ae8ac8b992", 
        "0x6a223e057cad8b9d20e4f9cd02dc018305680014", 
        "0x4c9191f3b8b4d6e790e0b32e941bea496db33f06", 
        "0x30939c6bb70ccff2ca303badc4b8e4420a04aa13"
      ],
      bucketAddresses: [
        "0x0e28a9d0bed228981fec47b203611422717f9593", 
        "0x12c125181eb7c944eaefcb2ae881475870f0aff3", 
        "0x76e7759445bb8028f725e8e795dadee8b209f6ac", 
        // "0x6dd0028ba6945ee5b859d3c7fe89bcdec57b67af", 
        "0xefd28d2b9ba8c6860f71b0334efc1e9fb07552c0"
      ]
    },
    arbitrumOne: {
      debtTokenAddresses:[
        "0x729f4FC1A4b329566aeE4892f334C1AD2a72D5Ef", 
        "0x729Aee1F5774b6b7055ad4d1cfC88Ff151d37cFe", 
        "0x0b192Fa9D7992e3A7f06984b94dCAB2B81303f45", 
        "0xa990A3b7852af90FeBE163682D166b2b0a78562d", 
        "0x3595df0dc911e62BfCfC87870Cb7CE82AE14b31B"
      ],
      pTokenAddresses: [
        "0x57cC81A3C358b652de3b3bCA499F7DC7967B0cc4", 
        "0x4c887C0982208C04FCc15edf0f88F651454dDEEf", 
        "0x5e51766e5DFA6D51C07B6c3B215120A959ECE24A", 
        "0x5Fdc282FF8579795Fd138e194f801933572D3FAc", 
        "0x97eE27B9b2a8AeeD1804EE95D4C426BE92778b86"
      ],
      bucketAddresses: [
        "0x653a3Bc43BD7B44Ab875F56cC0db54865a48CB2B", 
        "0x2Fa0BA6d651B2306FBcB22797Db0409BcF795F69", 
        "0x018b221753ef25da38e672e0d3747bd626ae2e71", 
        "0xc1c334ae711db9b83d03ec7c3a413d38b01826c5", 
        "0xcecbd4544081e700f5c2e5b148c07e94fed2b5c5"
      ]
    },
    ethereum: {
      pTokenAddresses: [
        "0xCB22D6488f96592a9caBbD04a9F272e70741318e", 
        "0x8CAfdbD35E6c81C6cABBb3d966A57C574643aB76", 
        "0x4B80D7fd621B9e17fc742f39e17a6fa3954bBfcb", 
        "0xDFb3b3d2B7bc5a8ee874A79E6dcB19149037bfF1", 
        "0x89F6D01512BF8a40480BD50356ba6C88dE9Ff2d4"
      ],
      debtTokenAddresses: [
        "0xe2D282d12B2341E4D4b1170EcEf93aee3BcD056e", 
        "0x52ccD0223f861fbeC4Ff490f9275270c905eD99B", 
        "0xe4E4e070d3B1370F878d44b2205feA2f00652B1c", 
        "0x6C82D296CFD85d4e34aa672c21080D9AFcC9D75E", 
        "0x809D2c1e88e1Fd88aF3a2192F5C69688935e5C73", 
      ],
      bucketAddresses: [
        "0x98EA73Aa5cb4EC957A3De403EBC9426c6560c4fc", 
        "0x6A1E6996669CFAf41A95D1Ae023123699952D569", 
        "0x19204B95477d6A665E35C84Ce77024DBeFb53aB2", 
        "0xcEE7FBa37Df0c8D2b756c78e93E3997FdCa39A91", 
        "0x6deAFC6f532EFaF72f7D33972A3e7B3864676E92"
      ]
    }
  };

  const activityRewardDistributor = await getContract("ActivityRewardDistributor");

  let sumReward = ethers.BigNumber.from(0);
  let sumDistributed = ethers.BigNumber.from(0);

  for(let actionType = 0; actionType < 2; actionType++) {
    for(let i = 0; i < addressConfig[network.name].bucketAddresses.length; i++) {

      const allParams = await activityRewardDistributor.buckets(addressConfig[network.name].bucketAddresses[i], actionType);
      const totalReward = allParams[8].toString();
      // const fixedReward = allParams[5].toString();

      const fixedReward = await activityRewardDistributor.getBucketAccumulatedReward(addressConfig[network.name].bucketAddresses[i], actionType);
      
      console.log(addressConfig[network.name].bucketAddresses[i]);
      console.log(totalReward.toString());
      console.log(fixedReward.toString());

      const totalRewardBigNumber = ethers.BigNumber.from(totalReward);
      const fixedRewardBigNumber = ethers.BigNumber.from(fixedReward);
      
      const diff = totalRewardBigNumber.sub(fixedRewardBigNumber).sub(ethers.BigNumber.from(20e18.toString()));

      sumReward = sumReward.add(totalRewardBigNumber);
      sumDistributed = sumDistributed.add(fixedRewardBigNumber);

      const encodeResult = await encodeFunctionData(
        "withdrawPmx",
        [addressConfig[network.name].bucketAddresses[i], actionType, diff],
        "ActivityRewardDistributor"
      );
      argsForBigTimeLock.targets.push(encodeResult.contractAddress);
      argsForBigTimeLock.payloads.push(encodeResult.payload);
    }
  }

  console.log("-----------");
  console.log(sumReward.toString());
  console.log(sumDistributed.toString());


  const epmx = await getContract("EPMXToken");
  const treasury = await getContract("Treasury");


  console.log((await epmx.balanceOf(treasury.address)).toString());


  const output = [
    argsForBigTimeLock.targets,
    Array(argsForBigTimeLock.targets.length).fill(0),
    argsForBigTimeLock.payloads,
    predecessor,
    salt,
    bigDelay.toString(),
  ];

  const directoryPath = path.join(__dirname, "..", "..", "proposals", network.name, "SetActivityRewardDistributorToZero");
  // Create directory if it doesn't exist
  fs.mkdirSync(directoryPath, { recursive: true });
  fs.writeFileSync(path.join(directoryPath, "SetActivityRewardDistributorToZero_parameters.json"), JSON.stringify(output, null, 2));

  const scheduleBatchData = await prepareScheduleData(output);
  const executeBatchData = await prepareExecuteData(output);

  fs.writeFileSync(path.join(directoryPath, "SetActivityRewardDistributorToZero_create.json"), JSON.stringify(scheduleBatchData, null, 2));
  fs.writeFileSync(path.join(directoryPath, "SetActivityRewardDistributorToZero_execute.json"), JSON.stringify(executeBatchData, null, 2));

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

  console.log((await epmx.balanceOf(treasury.address)).toString());



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
