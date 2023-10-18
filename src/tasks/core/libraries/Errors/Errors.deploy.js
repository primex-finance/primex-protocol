// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  return await deploy("Errors", {
    from: deployer,
    args: [],
    log: true,
  });
};
