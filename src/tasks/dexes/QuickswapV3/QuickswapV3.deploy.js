// SPDX-License-Identifier: BUSL-1.1
const {
  AlgebraPoolDeployerArtifact,
  AlgebraFactoryArtifact,
  QuoterArtifact,
  QuoterV2Artifact,
  SwapRouterArtifact,
  NonfungiblePositionManagerArtifact,
} = require("./utils.js");

const { setConfig, getConfig } = require("../../../config/configUtils.js");

module.exports = async function (
  { _ },
  {
    ethers: {
      getContract,
      constants: { AddressZero },
    },
    getNamedAccounts,
    deployments: { deploy },
  },
) {
  const { deployer } = await getNamedAccounts();

  const AlgebraPoolDeployer = await deploy("AlgebraPoolDeployer", {
    contract: { abi: AlgebraPoolDeployerArtifact.abi, bytecode: AlgebraPoolDeployerArtifact.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  const QuickswapV3Factory = await deploy("QuickswapV3Factory", {
    contract: { abi: AlgebraFactoryArtifact.abi, bytecode: AlgebraFactoryArtifact.bytecode },
    from: deployer,
    args: [AlgebraPoolDeployer.address, AddressZero],
    log: true,
  });
  const SwapRouter = await deploy("QuickswapRouterV3", {
    contract: { abi: SwapRouterArtifact.abi, bytecode: SwapRouterArtifact.bytecode },
    from: deployer,
    args: [QuickswapV3Factory.address, AddressZero, AlgebraPoolDeployer.address],
    log: true,
  });

  const Quoter = await deploy("QuoterQuickswapV3", {
    contract: { abi: QuoterArtifact.abi, bytecode: QuoterArtifact.bytecode },
    from: deployer,
    args: [QuickswapV3Factory.address, AddressZero, AlgebraPoolDeployer.address],
    log: true,
  });

  const QuoterV2 = await deploy("QuoterV2QuickswapV3", {
    contract: { abi: QuoterV2Artifact.abi, bytecode: QuoterV2Artifact.bytecode },
    from: deployer,
    args: [QuickswapV3Factory.address, AddressZero, AlgebraPoolDeployer.address],
    log: true,
  });

  const NonfungiblePositionManager = await deploy("QuickswapNonfungiblePositionManager", {
    contract: { abi: NonfungiblePositionManagerArtifact.abi, bytecode: NonfungiblePositionManagerArtifact.bytecode },
    from: deployer,
    args: [QuickswapV3Factory.address, AddressZero, AddressZero, AlgebraPoolDeployer.address],
    log: true,
  });
  if (QuickswapV3Factory.newlyDeployed) {
    const poolDeployerContract = await getContract("AlgebraPoolDeployer");
    const tx = await poolDeployerContract.setFactory(QuickswapV3Factory.address);
    await tx.wait();
  }

  const dexes = getConfig("dexes");

  const quickswapData = {
    router: SwapRouter.address,
    type: "5", // change on type from object after merge
    quoter: Quoter.address,
    quoterV2: QuoterV2.address,
    nonfungiblePositionManager: NonfungiblePositionManager.address,
    factory: QuickswapV3Factory.address,
    poolDeployer: AlgebraPoolDeployer.address,
  };
  dexes.quickswapv3 = quickswapData;

  setConfig("dexes", dexes);

  return [QuickswapV3Factory, SwapRouter, Quoter, NonfungiblePositionManager];
};
