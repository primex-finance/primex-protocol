// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ primexPricingLibrary, positionLibrary }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("PositionManagerExtension", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      PrimexPricingLibrary: primexPricingLibrary,
      PositionLibrary: positionLibrary,
    },
  });
};
