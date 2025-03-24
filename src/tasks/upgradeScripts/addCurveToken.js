// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, isFork },
  {
    network,
    getNamedAccounts,
    ethers: {
      getContract,
      providers,
      constants: { HashZero },
    },
  },
) {
  const { getConfigByName } = require("../../config/configUtils");
  const { encodeFunctionData } = require("../utils/encodeFunctionData.js");
  const { CurveOracleKind } = require("../../test/utils/constants.js");
  const { networks } = require("../../hardhat.config.js");
  const { deployer } = await getNamedAccounts();
  const addresses = getConfigByName("addresses.json");
  const assets = addresses.assets;

  if (isFork) {
    await network.provider.send("hardhat_setBalance", [deployer, "0x2b5e3af16b1880000"]);
  }

  // immutable addresses
  const smallTimeLock = await getContract("SmallTimelockAdmin");
  let tx;

  const smallDelay = await smallTimeLock.getMinDelay();

  const predecessor = HashZero;
  const salt = HashZero;
  const argsForSmallTimeLock = {
    targets: [],
    values: [],
    payloads: [],
  };

  if (!executeUpgrade) {
    for (const key in addresses.curveLP) {
      let CurveOracleAddress;
      let CurveOracleName;
      const lp = addresses.curveLP[key];
      const tokens = [];
      if (lp.oracleType === CurveOracleKind.STABLE) {
        CurveOracleAddress = (await getContract("CurveStableOracle")).address;
        CurveOracleName = "CurveStableOracle";
      }
      for (let i = 0; i < lp.assets.length; i++) {
        tokens.push(assets[lp.assets[i]]);
      }
      argsForSmallTimeLock.targets.push(CurveOracleAddress);
      argsForSmallTimeLock.payloads.push(
        (
          await encodeFunctionData(
            "registerCurveLp",
            [lp.lpTokenAddress, lp.registry, lp.registryIndex, tokens],
            CurveOracleName,
            CurveOracleAddress,
          )
        ).payload,
      );
    }
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
    const impersonateAddress = addresses.adminAddress; // gnosis
    await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
    await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);
    impersonateAccount = provider.getSigner(impersonateAddress);
  }

  if (executeUpgrade) {
    try {
      argsSmall = JSON.parse(fs.readFileSync("./" + network.name + ". Register curve pool eth-wsteth.json"));

      const nextTimestamp = (await provider.getBlock("latest")).timestamp + Number(smallDelay.toString());

      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp]);

      tx = await smallTimeLock.connect(impersonateAccount).executeBatch(...argsSmall.slice(0, argsSmall.length - 1));
      await tx.wait();

      console.log("Executing was successful");
    } catch (error) {
      console.log(error);
    }
  } else {
    fs.writeFileSync("./" + network.name + ". Register curve pool eth-wsteth.json", JSON.stringify(argsSmall, null, 2));
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
