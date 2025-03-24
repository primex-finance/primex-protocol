// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  const MockOrally = await deploy("OrallyVerifierOracle", {
    from: deployer,
    log: true,
  });
  return MockOrally;
};
