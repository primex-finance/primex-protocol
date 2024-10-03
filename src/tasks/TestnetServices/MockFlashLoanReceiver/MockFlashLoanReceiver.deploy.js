// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ __ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  const MockFlashLoanReceiver = await deploy("MockFlashLoanReceiver", {
    from: deployer,
    args: [],
    log: true,
  });
  return MockFlashLoanReceiver;
};
