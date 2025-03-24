// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  const MockStork = await deploy("MockStork", {
    from: deployer,
    log: true,
  });
  return MockStork;
};
