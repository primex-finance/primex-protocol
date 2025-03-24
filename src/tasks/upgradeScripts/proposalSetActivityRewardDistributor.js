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
        "0x6dd0028ba6945ee5b859d3c7fe89bcdec57b67af", 
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

  // const bucketFactory = await getContract("BucketsFactory");
  // const bucketLM = await bucketFactory.allBuckets();


  // const bucketLM = ["0x936E017D9D5a248B1E0409D9db6aaab47aA19666",
  // "0xfAF51FE0CE15DD05dbbD1B051cbA2C5dCDba470e",
  // "0x1ADfeA383BB0aCe078a3281E6607EB2c6A69e481",
  // "0x12c125181Eb7c944EaEfcB2AE881475870f0Aff3",
  // "0x0e28A9D0BEd228981feC47b203611422717f9593",
  // "0x4E0a6Ea3BeB2f89a4F51e09d0170DEfcC0f32734",
  // "0xf23A6792D5BF7e0989649BAce10a2E8E70D7e61b",
  // "0x4C3e997509eD6DA075380bD578b9F5FA5e1D2051",
  // "0xE6190B97382CF412DC67233dea03dcA1BF201f68",
  // "0x67dF77b9850F240B1b08DfF90F2B3d52cB22e2cF",
  // "0x8B793abeaE4ff60A9a137c185F110748e5DC02F7",
  // "0x99211C7Bea321b9988499286EBD53fE74966b4E7",
  // "0x76e7759445BB8028f725e8E795DadeE8b209f6Ac",
  // "0x6dd0028bA6945Ee5B859D3C7fe89bCdec57B67Af",
  // "0xEFD28D2B9ba8c6860f71B0334eFc1e9fB07552C0",
  // "0x1023C9274de13C76060179ba3a7F4Fd0E1C135fa",
  // "0x269010DBFFea6C388676de7ec340Af3c20a2951a",
  // "0xF5E160491a55F6847aC27A019d5e5587ac35D135",
  // "0x028b02Edc2E4e38E47C80b2Ac5C59629191E08d5",
  // "0x9F1523765Aa89731e5F38756F89237eD68A7c72C",
  // "0x0bF4003de65eCeA86026c6Cdcc80eb6Bfa15A3A7",
  // "0xAa5f11e1C14F9a73467Bf79972585c5df1842104",
  // "0x6956BdfF17C68D3B37faF1415769De316682EDBb",
  // "0xFD69831f0bbc4EF20A5cf493Ba8AAcB924A7CDFC",
  // "0x18f01CEaDe224205560fE54Af1e1373d19f5A96E",
  // "0x7e9144D94bB57F18C20381d0b234e9B3bb4437e3",
  // "0xF73AD42342232a0516ce80b27f0a2e829636d520",
  // "0x8104F1457f6B6cD34A1E58505F3d0B8E01430cFf",
  // "0xad58fBCD9dA37A8765A61C2E9177437f8a663883",
  // "0xc5F1A9d54652fD04Bf9a688273966a81814acB8b",
  // "0xdE25839A447B75Dece3842F18A535bA4cC4d2E69",
  // "0x89A13D39909bCEa5A85EC8e4fb49551e8ACFf56B",
  // "0xdD183B7b2B0B1276f3983829894bbcF2d5FA47A4",
  // "0xd11E60d61d0F0e9e2c0B00B8344082212a5436Cf",
  // "0x3edb777e8Af4d2C83f45cFDb338E9C2ee29b6c1F",
  // "0x8A0c95f3E245887D313C76e0C22242E39D88373e",
  // "0xBB9Fa95A393056cE2d5Df22E61295f2110D526F4",
  // "0x9333a0152F63e68f532dC27001706E4501444Ffb",
  // "0x632cdcaD3feC3AeCAc41ad03cc11bE50958b0572",
  // "0x6c859191409f9aaB4943a466F458fe721BaF9C73",
  // "0x7f92bBC5D6eBA6E6EF715dDC2Ef74d0FC4582F76",
  // "0xf0721898f05D5996EE49Bcf45d5d82661258e4BE",
  // "0x628C0b15eB945b03B198983177eb1D94d7Dbfa0A",
  // "0xEb3316CcDA016E0979346349E7379089b3f52EA8",
  // "0x7248f3Ce52C941F010751F496fbb79b8940ff6ea",
  // "0xBf998955A4907c55765230186D261334D9aBcd47",
  // "0x6416A56634579403178B99c13fb729b19306d477",
  // "0x61790eec36DF6b9ad38047d771001B765d83b5b1",
  // "0x68cF105Ad6660e5fb540E5aB5eDD85EAD70829DD",
  // "0x4Def744D8bfa687a98D3568bADe26a20ADa55Ee4",
  // "0xf860306566CEaF32D669BE0593abd69F5fE50Ca8",
  // "0x732d72585b5047c67c1929044282cBacD9Fc8451",
  // "0x101Da436Dd6f3Ea0E002f92CD2cAb99f6D21fEad",
  // "0x177Dbc14fB0Dd0fC077aFED681c86d0c34E1afe3"]

  // const bucketLM = [
  //   '0xA4E15B84fc22EE720862bEcBa1fAc3D1008BAeda',
  //   '0x80629d14f390b1BdAfA45b5eE4f3c1FD026DdD10',
  //   '0x6CbB80b8462346e15A833F2D13B37d85Cc618A78',
  //   '0xDBC8443c7f942c1FBaA99De1409Eb3205b32BE15',
  //   '0xDF70B500Eba916Eda2451e132f7007f35E611c83',
  //   '0x69D0eDab8Bcac0CB0B13BF4bD26D385Fcda929eA',
  //   '0xC9173E988b5D4A774fAC4e20881c2264543CC06a',
  //   '0x2E02E5C2086507Ac1deeaF9eA19e180A6d305197',
  //   '0xDeA87d236BfbD78EC21E6c6727045DdbbF108878',
  //   '0x9557D08BBA1b84A69F6543059E43dF5A8678a833',
  //   '0x11e0226152306f52251A06Cb5dDD2D83E2788DD0',
  //   '0x653a3Bc43BD7B44Ab875F56cC0db54865a48CB2B',
  //   '0x2Fa0BA6d651B2306FBcB22797Db0409BcF795F69',
  //   '0x018b221753Ef25Da38e672e0D3747bD626ae2e71',
  //   '0xC1C334AE711db9b83D03eC7C3a413D38b01826c5',
  //   '0x9ab05967a764838f9C804C1e58b94524F2789808',
  //   '0xcecBd4544081e700F5c2e5b148C07E94feD2B5C5',
  //   '0xe58b8b7435477a42c13c327166370de16d0Df313',
  //   '0xDcaB7Df83B97ACdD8991fa9A1b84af3388b26118',
  //   '0x9DD94b08aC1f8754E2dc69aE8e3F0627D130B70f',
  //   '0xD03Ec8DfB2803754c83E050F8E80912aFe419163',
  //   '0xc665a8dB2c5c6c37b9347B4336CB459461EC0718',
  //   '0xB290D9f20F30c23D55FfF29Cd3643A57d991bbA5',
  //   '0x5a04B0D18c042ecB5c32DF5bF83747DD3583E334',
  //   '0x7457980350F5146627647920C2d086b484006F81',
  //   '0x83751c56f77980302Ad72Ab44d97Fe83E49451E1',
  //   '0xA7C8B35039A1E4226183656423765636F25f39D7',
  //   '0x0FC2BAC7958aD645641cFC991Ba89389B3ED8f3A',
  //   '0x11Fb352EB6DB47eAE9E33AA02C6F9D06512811d1',
  //   '0x99D13d6B6E40847aFd06ec925A4F1379fFcc44b3',
  //   '0x830a348CCb8829ffBB2B73F8b4b7F5ebFB2D1327',
  //   '0x14d78e929Fa028e9774AE1d1748E6DbfA1a43c08',
  //   '0x2F92D3D451b37935cd4D350E24fD036bd1De0a9A',
  //   '0x96EF6664D37593141707451b7fDaEd7B213a1f85',
  //   '0xb988EC1bF0C029dd2B7E3e89b26cCaCCE3C31692',
  //   '0xf9D57569C6Fb407E371dECD0251E020A76fF76c7',
  //   '0x7b884B627A0df08d7e8B6730769eE8d1Eb18Dec0',
  //   '0xaA16d517f4eC7961c5e3fc994c2B5C308062f992',
  //   '0x03BaDfbf249c15707ECcccAC687F9ea6769E7A6c',
  //   '0xF9231cD80c14d067355C0390dcaE858F3E3E6EC2',
  //   '0x02B0d3DDd22F38bE807ef951D206ba379213138a',
  //   '0x8759bA876F34dcDD50269936eB4B9F987d3fd4DD',
  //   '0x48F727FD2F8e1B5A7ec53D0287d868CCf781C799',
  //   '0xB7d177db1fd26f4ad41844687806B53366C5C970',
  //   '0xd679b0D60BFcF65820C6BC62Eb831c7cf82C42b8',
  //   '0xc37Ba4A4DA645dC5b7D90108Ce7FdB57717a8cD0',
  //   '0x99CB06D8d7107B43c89F7ca0FE8Df70252AbC755',
  //   '0x1E9046e2089Bc4833C6A53AfAFf6D95e0d219cC3',
  //   '0x4A08D48E65780D222C77e49D217F333C47090609',
  //   '0xcb79ba9770a1EB5207b8aeef3718DD016b90C55a'
  // ];

  // for(let i = 0; i < debtTokenAddresses.length; i++) {
  //   const pToken = await getContractAt("DebtToken", debtTokenAddresses[i]);
  //   const activityRewardDistr = await pToken.traderRewardDistributor();
  //   console.log(debtTokenAddresses[i] + " " + activityRewardDistr);
  // };

  // for(let i = 0; i < pTokenAddresses.length; i++) {
  //   const pToken = await getContractAt("PToken", pTokenAddresses[i]);
  //   const activityRewardDistr = await pToken.lenderRewardDistributor();
  //   console.log(pTokenAddresses[i] + " " + activityRewardDistr);
  // };

  // for(let i = 0; i < bucketLM.length; i++) {
  //   const bucket = await getContractAt("Bucket", bucketLM[i]);
  //   const params = await bucket.getLiquidityMiningParams();
  //   if(!params[1])
  //     console.log(await bucket.name());
  // };

  for(let i = 0; i < addressConfig[network.name].pTokenAddresses.length; i++) {
    const encodeResult = await encodeFunctionData(
      "setLenderRewardDistributor",
      ["0x0000000000000000000000000000000000000000"],
      "PToken",
      addressConfig[network.name].pTokenAddresses[i]
    );
    argsForBigTimeLock.targets.push(encodeResult.contractAddress);
    argsForBigTimeLock.payloads.push(encodeResult.payload);
  }

  for(let i = 0; i < addressConfig[network.name].debtTokenAddresses.length; i++) {
    const encodeResult = await encodeFunctionData(
      "setTraderRewardDistributor",
      ["0x0000000000000000000000000000000000000000"],
      "DebtToken",
      addressConfig[network.name].debtTokenAddresses[i]
    );
    argsForBigTimeLock.targets.push(encodeResult.contractAddress);
    argsForBigTimeLock.payloads.push(encodeResult.payload);
  }

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
