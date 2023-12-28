// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils");

module.exports = async ({ run, ethers: { getContract } }) => {
  const routers = [];
  const name = [];
  const dexTypes = [];
  const quoters = {};

  if (process.env.TEST) {
    const UniswapV2Router = await getContract("uniswapV2Router02");
    const SushiswapV2Router = await getContract("sushiswapV2Router02");
    const UniswapV3Router = await getContract("SwapRouterV3");
    const QuickswapRouterV3 = await getContract("QuickswapRouterV3");
    const CurveRouter = await getContract("CurveSwapRouter");
    const BalancerVault = await getContract("Vault");
    const MeshswapRouter = await getContract("MeshswapRouter");

    routers.push(
      UniswapV2Router.address,
      SushiswapV2Router.address,
      UniswapV3Router.address,
      CurveRouter.address,
      BalancerVault.address,
      QuickswapRouterV3.address,
      MeshswapRouter.address,
    );
    quoters["2"] = (await getContract("QuoterUniswapV3")).address;
    quoters["5"] = (await getContract("QuoterQuickswapV3")).address;
    name.push("uniswap", "sushiswap", "uniswapv3", "curve", "balancer", "quickswapv3", "meshswap");
    dexTypes.push("1", "1", "2", "3", "4", "5", "6");
  } else {
    const { dexes } = getConfig();
    for (const dex in dexes) {
      name.push(dex);
      dexTypes.push(dexes[dex].type);
      routers.push(dexes[dex].router);
      if (dexes[dex].quoter !== undefined) {
        quoters[routers.length - 1] = dexes[dex].quoter;
      }
    }
  }

  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const errorsLibrary = await getContract("Errors");
  const tokenApproveLibrary = await getContract("TokenApproveLibrary");
  await run("deploy:DexAdapter", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    routers: JSON.stringify(routers),
    name: JSON.stringify(name),
    dexTypes: JSON.stringify(dexTypes),
    quoters: JSON.stringify(quoters),
    errorsLibrary: errorsLibrary.address,
    tokenApproveLibrary: tokenApproveLibrary.address,
    addDexesToDns: true,
  });
};

const dependencies = ["PrimexDNS", "PositionManager", "WhiteBlackList", "Errors", "TokenApproveLibrary"];
if (process.env.TEST) dependencies.push("Dexes");

module.exports.tags = ["DexAdapter", "Test", "PrimexCore"];
module.exports.dependencies = dependencies;
