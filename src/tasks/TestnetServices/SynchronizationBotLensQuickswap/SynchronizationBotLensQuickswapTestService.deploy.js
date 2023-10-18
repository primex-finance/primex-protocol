// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ tokenTransfersLibrary }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("SynchronizationBotLensQuickswapTestService", {
    from: deployer,
    args: [],
    log: true,
    libraries: {
      TokenTransfersLibrary: tokenTransfersLibrary,
    },
  });
};
