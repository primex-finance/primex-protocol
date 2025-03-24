// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ __ }, { getNamedAccounts, network, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  if (network.name !== "baseMainnet") {
    console.log("This deployment script is only for Optimism chains. Skipping deployment.");
    return;
  }

  const GasPriceOracleOptimism = await deploy("GasPriceOracleOptimism", {
    from: deployer,
    log: true,
  });
  return GasPriceOracleOptimism;
};
