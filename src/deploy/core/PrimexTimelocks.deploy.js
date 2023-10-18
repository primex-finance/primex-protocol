// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName, getConfig } = require("../../config/configUtils");

module.exports = async ({
  run,
  getNamedAccounts,
  ethers: {
    getContract,
    constants: { AddressZero },
  },
}) => {
  const registry = await getContract("Registry");

  const { deployer } = await getNamedAccounts();

  const adminAddress = getConfig().adminAddress ?? deployer;
  let timelockAdmin = AddressZero;

  // if there is no admin multisig at the time of the deployment,
  // you need to give admin rights to the deployer
  // so that he can transfer all rights to the multisig created after without delay
  if (adminAddress === deployer) {
    timelockAdmin = deployer;
  }
  const proposers = JSON.stringify([adminAddress]);
  const executors = JSON.stringify([adminAddress]);
  const errorsLibrary = await getContract("Errors");

  const SECONDS_PER_DAY = 24 * 60 * 60;

  const { BigTimelockDelayInDays, MediumTimelockDelayInDays, SmallTimelockDelayInDays } = getConfigByName("generalConfig.json");

  const BigDelay = (BigTimelockDelayInDays * SECONDS_PER_DAY).toFixed();
  const BigTimelockAdmin = await run("deploy:PrimexTimelock", {
    deploymentName: "BigTimelockAdmin",
    registry: registry.address,
    minDelay: BigDelay.toString(),
    proposers: proposers,
    executors: executors,
    admin: timelockAdmin,
    errorsLibrary: errorsLibrary.address,
  });

  // BigTimelockAdmin is admin of whole protocol
  if (BigTimelockAdmin.newlyDeployed) {
    await run("AccessControl:AddRole", {
      role: "DEFAULT_ADMIN_ROLE",
      account: BigTimelockAdmin.address,
      registryAddress: registry.address,
    });
  }

  const MediumDelay = (MediumTimelockDelayInDays * SECONDS_PER_DAY).toFixed();
  const MediumTimelockAdmin = await run("deploy:PrimexTimelock", {
    deploymentName: "MediumTimelockAdmin",
    registry: registry.address,
    minDelay: MediumDelay.toString(),
    proposers: proposers,
    executors: executors,
    admin: timelockAdmin,
    errorsLibrary: errorsLibrary.address,
  });

  if (MediumTimelockAdmin.newlyDeployed) {
    await run("AccessControl:AddRole", {
      role: "MEDIUM_TIMELOCK_ADMIN",
      account: MediumTimelockAdmin.address,
      registryAddress: registry.address,
    });
  }

  const SmallDelay = (SmallTimelockDelayInDays * SECONDS_PER_DAY).toFixed();
  const SmallTimelockAdmin = await run("deploy:PrimexTimelock", {
    deploymentName: "SmallTimelockAdmin",
    registry: registry.address,
    minDelay: SmallDelay.toString(),
    proposers: proposers,
    executors: executors,
    admin: timelockAdmin,
    errorsLibrary: errorsLibrary.address,
  });

  if (SmallTimelockAdmin.newlyDeployed) {
    await run("AccessControl:AddRole", {
      role: "SMALL_TIMELOCK_ADMIN",
      account: SmallTimelockAdmin.address,
      registryAddress: registry.address,
    });
  }
};
module.exports.tags = ["Timelocks", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "WhiteBlackList", "Errors"];
