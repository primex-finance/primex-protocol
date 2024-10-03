// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ __ }, { getNamedAccounts, network, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  if (network.name !== "arbitrumOne" && network.name !== "arbitrumFork") {
    console.log("This deployment script is only for Arbitrum One. Skipping deployment.");
    return;
  }

  const GasPriceOracleArbitrumOne = await deploy("GasPriceOracleArbitrumOne", {
    from: deployer,
    log: true,
  });
  return GasPriceOracleArbitrumOne;
};
