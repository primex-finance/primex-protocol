// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../../config/configUtils.js");

const QuoterArtifact = require("../../../node_modules/@uniswap/v3-periphery/artifacts/contracts/lens/Quoter.sol/Quoter.json");

module.exports = async function ({ _ }, { getNamedAccounts, deployments: { deploy, getArtifact }, ethers: { getContract } }) {
  const { deployer } = await getNamedAccounts();

  const NonfungiblePositionManagerArtifact = await getArtifact("NonfungiblePositionManager");
  const UniswapV3FactoryArtifact = await getArtifact("UniswapV3Factory");
  const SwapRouterArtifact = await getArtifact("SwapRouter");
  const QuoterV2Artifact = await getArtifact("QuoterV2");
  // we do not use swaps with weth, so real contract is not needed
  const weth = deployer;

  const UniswapV3Factory = await deploy("UniswapV3Factory", {
    contract: { abi: UniswapV3FactoryArtifact.abi, bytecode: UniswapV3FactoryArtifact.bytecode },
    from: deployer,
    args: [],
    log: true,
  });

  const SwapRouter = await deploy("SwapRouterV3", {
    contract: { abi: SwapRouterArtifact.abi, bytecode: SwapRouterArtifact.bytecode },
    from: deployer,
    args: [UniswapV3Factory.address, weth],
    log: true,
  });

  const NonfungiblePositionManager = await deploy("UniswapNonfungiblePositionManager", {
    contract: { abi: NonfungiblePositionManagerArtifact.abi, bytecode: NonfungiblePositionManagerArtifact.bytecode },
    from: deployer,
    args: [UniswapV3Factory.address, weth, deployer], // [address factory, address _WETH9,address NonfungibleTokenPositionDescriptor]
    log: true,
  });

  // lenses
  const Quoter = await deploy("QuoterUniswapV3", {
    contract: { abi: QuoterArtifact.abi, bytecode: QuoterArtifact.bytecode },
    from: deployer,
    args: [UniswapV3Factory.address, weth],
    log: true,
  });

  const QuoterV2 = await deploy("QuoterV2UniswapV3", {
    contract: { abi: QuoterV2Artifact.abi, bytecode: QuoterV2Artifact.bytecode },
    from: deployer,
    args: [UniswapV3Factory.address, weth],
    log: true,
  });

  const UniswapV2Factory = await getContract("uniswapV2Factory");
  const SushiswapV2Factory = await getContract("sushiswapV2Factory");

  const MixedRouteQuoterV1 = await deploy("MixedRouteQuoterV1", {
    from: deployer,
    args: [UniswapV3Factory.address, UniswapV2Factory.address, SushiswapV2Factory.address, weth],
    log: true,
  });

  const dexes = getConfig("dexes");

  const uniswapv3Data = {
    router: SwapRouter.address,
    type: "2", // change on type from object after merge
    quoter: Quoter.address,
    quoter2: QuoterV2.address,
    mixedRouteQuoterV1: MixedRouteQuoterV1.address,
    nonfungiblePositionManager: NonfungiblePositionManager.address,
    factory: UniswapV3Factory.address,
  };
  dexes.uniswapv3 = uniswapv3Data;

  setConfig("dexes", dexes);

  return [UniswapV3Factory, SwapRouter, NonfungiblePositionManager, Quoter, QuoterV2, MixedRouteQuoterV1];
};
