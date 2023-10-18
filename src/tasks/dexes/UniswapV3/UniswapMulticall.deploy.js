// SPDX-License-Identifier: BUSL-1.1
const { setConfig } = require("../../../config/configUtils.js");

module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy, getArtifact } }) {
  const { deployer } = await getNamedAccounts();
  const MulticallArtifact = await getArtifact("UniswapInterfaceMulticall");
  const multicall = await deploy("UniswapInterfaceMulticall", {
    contract: { abi: MulticallArtifact.abi, bytecode: MulticallArtifact.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  setConfig("uniswapMulticall", multicall.address);

  return multicall;
};
