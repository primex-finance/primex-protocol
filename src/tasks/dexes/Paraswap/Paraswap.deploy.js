// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy } }) {
  const { deployer } = await getNamedAccounts();

  const ParaswapMock = await deploy("ParaswapMock", {
    from: deployer,
    args: [],
    log: true,
  });

  const dexes = getConfig("dexes");
  const paraswapData = {
    router: ParaswapMock.address,
    type: "7",
  };
  dexes.paraswap = paraswapData;

  setConfig("dexes", dexes);

  return ParaswapMock;
};
