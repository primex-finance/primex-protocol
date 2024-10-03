// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ validTimePeriod, singleUpdateFeeInWei }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();
  const { setConfig } = require("../../../config/configUtils.js");

  const MockPyth = await deploy("MockPyth", {
    from: deployer,
    args: [validTimePeriod, singleUpdateFeeInWei],
    log: true,
  });
  setConfig("pyth", MockPyth.address);
  return MockPyth;
};
