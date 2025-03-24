// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
module.exports = async function (
  { executeUpgrade, executeFromDeployer, isFork },
  {
    run,
    network,
    getNamedAccounts,
    deployments: { deploy, get, getArtifact },
    ethers: {
      getContract,
      providers,
      getContractAt,
      getContractFactory,
      constants: { HashZero },
      utils: { defaultAbiCoder, parseUnits },
    },
    upgrades,
  },
) {
  const { networks } = require("../../hardhat.config.js");

  const bigTimeLock = await getContract("BigTimelockAdmin");

  let impersonateAccount;
  const rpcUrl = networks[network.name].url;
  const provider = new providers.JsonRpcProvider(rpcUrl);
  if (isFork) {
    const impersonateAddress = bigTimeLock.address; // gnosis
    await provider.send("hardhat_impersonateAccount", [impersonateAddress]);
    await network.provider.send("hardhat_setBalance", [impersonateAddress, "0x8ac7230489e80000"]);

    impersonateAccount = provider.getSigner(impersonateAddress);
  }

  const args = JSON.parse(fs.readFileSync("./argsForBigTimeLock.json"));
  const [targets, values, payloads] = args;
  let tx;
  for (let i = 0; i < targets.length; i++) {
    tx = await impersonateAccount.sendTransaction({
      to: targets[i],
      value: values[i],
      data: payloads[i],
    });
    await tx.wait();
  }
};
