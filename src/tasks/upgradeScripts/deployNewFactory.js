// SPDX-License-Identifier: BUSL-1.1
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
      utils: { parseEther, keccak256, toUtf8Bytes },
      constants: { HashZero },
    },
  },
) {
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { networks } = require("../../hardhat.config.js");
  const { deployer } = await getNamedAccounts();

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const smallTimeLock = await getContract("SmallTimelockAdmin");
  const TokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const Registry = await getContract("Registry");
  const WhiteBlackList = await getContract("WhiteBlackList");
  const PrimexProxyAdmin = await getContract("PrimexProxyAdmin");
  const TokenApproveLibrary = await getContract("TokenApproveLibrary");
  const PToken = await getContract("PToken");
  const DebtToken = await getContract("DebtToken");
  let tx;

  const smallDelay = await smallTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  const addToWhiteList = [];

  if (!executeUpgrade) {
    const PTokensFactory = await deploy("PTokensFactoryV2", {
      contract: "PTokensFactory",
      from: deployer,
      args: [PToken.address, Registry.address],
      log: true,
    });

    addToWhiteList.push(PTokensFactory.address);

    const pTokensFactory = await getContractAt("PTokensFactory", PTokensFactory.address);
    tx = await pTokensFactory.transferOwnership(PrimexProxyAdmin.address);
    await tx.wait();

    const DebtTokensFactory = await deploy("DebtTokensFactoryV2", {
      contract: "DebtTokensFactory",
      from: deployer,
      args: [DebtToken.address, Registry.address],
      log: true,
    });

    addToWhiteList.push(DebtTokensFactory.address);

    const debtTokensFactory = await getContractAt("DebtTokensFactory", DebtTokensFactory.address);
    tx = await debtTokensFactory.transferOwnership(PrimexProxyAdmin.address);
    await tx.wait();

    const BucketImplementation = await deploy("BucketFixedInterface", {
      contract: "Bucket",
      from: deployer,
      args: [],
      log: true,
      libraries: {
        TokenTransfersLibrary: TokenTransfersLibrary.address,
        TokenApproveLibrary: TokenApproveLibrary.address,
      },
    });

    const BucketsFactoryV3 = await deploy("BucketsFactoryV3", {
      contract: "BucketsFactoryV2",
      from: deployer,
      args: [Registry.address, PTokensFactory.address, DebtTokensFactory.address, BucketImplementation.address],
      log: true,
    });

    addToWhiteList.push(BucketsFactoryV3.address);

    argsForSmallTimeLock.targets.push(PTokensFactory.address);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("setBucketsFactory", [BucketsFactoryV3.address], "PTokensFactory", PTokensFactory.address)).payload,
    );

    argsForSmallTimeLock.targets.push(DebtTokensFactory.address);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("setBucketsFactory", [BucketsFactoryV3.address], "DebtTokensFactory", DebtTokensFactory.address)).payload,
    );

    const bucketsFactoryV3 = await getContractAt("BucketsFactoryV2", BucketsFactoryV3.address);
    tx = await bucketsFactoryV3.transferOwnership(PrimexProxyAdmin.address);
    await tx.wait();

    argsForSmallTimeLock.targets.push(WhiteBlackList.address);
    argsForSmallTimeLock.payloads.push(
      (await encodeFunctionData("addAddressesToWhitelist", [addToWhiteList], "WhiteBlackList", WhiteBlackList.address)).payload,
    );
  }

  let argsSmall = [
    argsForSmallTimeLock.targets,
    Array(argsForSmallTimeLock.targets.length).fill(0),
    argsForSmallTimeLock.payloads,
    predecessor,
    salt,
    smallDelay.toString(),
  ];

  let impersonateAccount;
  const rpcUrl = networks[network.name].url;
  const provider = new providers.JsonRpcProvider(rpcUrl);
  if (isFork) {
    const impersonateAddress = "0x9bC2D435bdCA131ec0F48C6589dD3F924AeBB9B8"; // gnosis
    await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
    await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);
    impersonateAccount = provider.getSigner(impersonateAddress);
  }

  if (executeUpgrade) {
    try {
      argsSmall = JSON.parse(fs.readFileSync("./argsForSmallTimeLock.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(smallDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await smallTimeLock.connect(impersonateAccount).executeBatch(...argsSmall.slice(0, argsSmall.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./argsForSmallTimeLock.json", JSON.stringify(argsSmall, null, 2));
    if (!isFork) return;
    try {
      console.log("Scheduling...");
      tx = await smallTimeLock.connect(impersonateAccount).scheduleBatch(...argsSmall);
      await tx.wait();

      console.log("Scheduling was successful");
    } catch (error) {
      console.log(error);
    }
  }
};
