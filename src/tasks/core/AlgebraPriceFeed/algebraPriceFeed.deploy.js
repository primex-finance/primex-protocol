// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ algebraV3Factory, twapInterval, registry }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  if (algebraV3Factory === undefined) throw new Error("algebraV3Factory is undefined");

  return await deploy("AlgebraPriceFeed", {
    from: deployer,
    log: true,
    args: [algebraV3Factory, twapInterval, registry],
  });
};
