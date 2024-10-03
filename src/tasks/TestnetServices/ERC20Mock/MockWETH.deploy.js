// SPDX-License-Identifier: BUSL-1.1
const { setConfig } = require("../../../config/configUtils.js");
module.exports = async function ({ _ }, { deployments: { deploy }, ethers: { getNamedSigners } }) {
  const { deployer } = await getNamedSigners();

  const MockWETH = await deploy("MockWETH", {
    from: deployer.address,
    contract: "WETH9",
    args: [],
    log: !process.env.TEST,
  });
  setConfig("wrappedNativeToken", MockWETH.address);
};
