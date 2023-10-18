// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function ({ name }, { getNamedAccounts, deployments: { deploy, getArtifact } }) {
  const { deployer } = await getNamedAccounts();
  const UniswapV2FactoryArtifact = await getArtifact("UniswapV2Factory");
  const UniswapV2Router02Artifact = await getArtifact("UniswapV2Router02");

  const UniswapV2Factory = await deploy(name + "V2Factory", {
    contract: { abi: UniswapV2FactoryArtifact.abi, bytecode: UniswapV2FactoryArtifact.bytecode },
    from: deployer,
    args: [deployer],
    log: true,
  });

  const UniswapV2Router02 = await deploy(name + "V2Router02", {
    contract: { abi: UniswapV2Router02Artifact.abi, bytecode: UniswapV2Router02Artifact.bytecode },
    from: deployer,
    args: [UniswapV2Factory.address, deployer],
    log: true,
  });

  const dexes = getConfig("dexes");

  const uniswapData = {
    router: UniswapV2Router02.address,
    type: "1",
    factory: UniswapV2Factory.address,
  };
  dexes[name] = uniswapData;

  setConfig("dexes", dexes);

  return [UniswapV2Factory, UniswapV2Router02];
};
