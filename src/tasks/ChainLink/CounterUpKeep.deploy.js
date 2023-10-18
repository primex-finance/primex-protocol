// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ interval }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  return await deploy("Counter", {
    from: deployer,
    args: [interval],
    log: true,
  });
};
