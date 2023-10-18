// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ name, updater }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  if (!updater) {
    updater = deployer;
  }

  return await deploy("PrimexAggregatorV3TestService " + name + " price feed", {
    contract: "PrimexAggregatorV3TestService",
    from: deployer,
    args: [name, updater],
    log: true,
  });
};
