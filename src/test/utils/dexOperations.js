// SPDX-License-Identifier: BUSL-1.1
const {
  run,
  ethers: {
    BigNumber,
    getContract,
    getContractAt,
    getNamedSigners,
    constants: { HashZero, NegativeOne, MaxUint256, AddressZero },
    utils: { parseUnits, hexZeroPad, defaultAbiCoder, hexConcat },
  },
} = require("hardhat");

const { wadMul } = require("./math");
const { getConfig } = require("../../config/configUtils.js");
let nonfungiblePositionManagerUniswapV3, nonfungiblePositionManagerQuickswapV3;
let vault, WeightedPoolFactory;

const CurvePoolsByTokenAmount = Object.freeze({
  2: { name: "StableSwapHBTC", token: "CurveTokenV2", underlying: false, cryptoRegistry: false },
  3: { name: "TriCrypto", token: "CurveTokenV4", underlying: false, cryptoRegistry: true },
  4: { name: "StableSwapY", token: "CurveTokenV1", underlying: true, deposit: "DepositY", cryptoRegistry: false },
});

// test use mainnet fork
async function initialize() {
  if (process.env.TEST) {
    nonfungiblePositionManagerUniswapV3 = (await getContract("UniswapNonfungiblePositionManager")).address;
    nonfungiblePositionManagerQuickswapV3 = (await getContract("QuickswapNonfungiblePositionManager")).address;
    vault = (await getContract("Vault")).address;
    WeightedPoolFactory = (await getContract("WeightedPoolFactory")).address;
  } else {
    const dexes = getConfig("dexes");
    nonfungiblePositionManagerUniswapV3 = dexes.uniswapv3.nonfungiblePositionManager;
    nonfungiblePositionManagerQuickswapV3 = dexes.quickswapv3.nonfungiblePositionManager;
    vault = dexes.balancer.vault;
    WeightedPoolFactory = dexes.balancer.weightedPoolFactory;
  }
}
const { getContractAbi } = require("../../tasks/dexes/Balancer/utils.js");

// now supported DEX is "uniswap","sushiswap","uniswapv3"
async function checkIsDexSupported(dex) {
  const PrimexDNS = await getContract("PrimexDNS");
  try {
    await PrimexDNS.getDexAddress(dex);
  } catch {
    throw new Error(`${dex} is not supported`);
  }
  return true;
}

async function addLiquidity({
  dex,
  amountADesired = "10",
  amountBDesired = "10",
  tokenA,
  tokenB,
  createPool = true,
  tokenAWeight = "5",
  tokenBWeight = "5",
  pool,
  assets,
  needMint = true,
}) {
  await initialize();
  const { deployer } = await getNamedSigners();

  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;
  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);

  let curveSwapRouter, registry, meshswapFactory, meshswapPoolAddress, factoryImplContract;
  if (needMint) {
    if (dexType !== 0) {
      if (assets) {
        for (const asset of assets) {
          const token = await getContractAt("ERC20Mock", asset.token);
          await token.mint(deployer.address, parseUnits(asset.amount, await token.decimals()));
        }
      } else {
        await tokenA.mint(deployer.address, parseUnits(amountADesired, await tokenA.decimals()));
        await tokenB.mint(deployer.address, parseUnits(amountBDesired, await tokenB.decimals()));
      }
    }
  }

  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1:
    // uniswap v2
    await run("router:addLiquidity", {
      from: "deployer",
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
      router: router,
    });
    break;
  case 2:
    // uniswap v3

    if (createPool) {
      await run("UniswapV3:CreatePool", {
        nonfungiblePositionManager: nonfungiblePositionManagerUniswapV3,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        fee: "3000",
        from: "deployer",
        reservTokenA: amountADesired,
        reservTokenB: amountBDesired,
      });
    }
    await run("UniswapV3:addLiquidity", {
      nonfungiblePositionManager: nonfungiblePositionManagerUniswapV3,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      fee: "3000",
      from: "deployer",
      to: deployer.address,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
    });
    break;
  case 3: {
    let depositPool;
    assets = assets ?? [
      { token: tokenA.address, amount: amountADesired },
      { token: tokenB.address, amount: amountBDesired },
    ];
    if (createPool) {
      ({ depositPool } = await run("curve:createPool", {
        from: "deployer",
        assets: JSON.stringify(assets),
      }));
    }
    curveSwapRouter = await getContractAt("Swaps", router);
    registry = CurvePoolsByTokenAmount[assets.length].cryptoRegistry
      ? await getContractAt("CryptoRegistry", await curveSwapRouter.crypto_registry())
      : await getContractAt("Registry", await curveSwapRouter.registry());
    pool = await registry.callStatic["pool_list(uint256)"](0);
    // Only the underlying pools have a separate contract for deposit
    pool = depositPool ?? pool;
    await run("curve:addLiquidity", {
      pool: pool,
      from: "deployer",
      assets: JSON.stringify(assets),
    });
    return pool;
  }
  case 4:
    assets = assets ?? [
      { token: tokenA.address, weight: tokenAWeight, amount: amountADesired },
      { token: tokenB.address, weight: tokenBWeight, amount: amountBDesired },
    ];
    if (createPool) {
      pool = await run("balancer:createPool", {
        from: "deployer",
        assets: JSON.stringify(assets),
        factory: WeightedPoolFactory,
      });
    }
    await run("balancer:addLiquidity", {
      pool,
      vault: vault,
      assets: JSON.stringify(assets),
      from: "deployer",
      to: "deployer",
    });
    return pool;
  case 5:
    if (createPool) {
      await run("QuickswapV3:CreatePool", {
        nonfungiblePositionManager: nonfungiblePositionManagerQuickswapV3,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        from: "deployer",
        reservTokenA: amountADesired,
        reservTokenB: amountBDesired,
      });
    }
    await run("QuickswapV3:addLiquidity", {
      nonfungiblePositionManager: nonfungiblePositionManagerQuickswapV3,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      from: "deployer",
      to: deployer.address,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
    });
    break;
  case 6:
    // meshswap
    meshswapFactory = await getContract("MeshswapFactory");
    factoryImplContract = await getContractAt("FactoryImpl", meshswapFactory.address);
    meshswapPoolAddress = await factoryImplContract.getPair(tokenA.address, tokenB.address);
    if (meshswapPoolAddress === AddressZero) {
      meshswapPoolAddress = await run("Meshswap:createPoolAndAddLiquidity", {
        factoryAddress: meshswapFactory.address,
        tokenA: tokenA.address,
        amountADesired: amountADesired,
        tokenB: tokenB.address,
        amountBDesired: amountBDesired,
        fee: "5",
      });
    } else {
      await tokenA.mint(deployer.address, parseUnits(amountADesired, await tokenA.decimals()));
      await tokenB.mint(deployer.address, parseUnits(amountBDesired, await tokenB.decimals()));
      await run("Meshswap:addLiquidity", {
        router: router,
        tokenA: tokenA.address,
        tokenB: tokenB.address,
        amountADesired: amountADesired,
        amountBDesired: amountBDesired,
        amountAMin: "1",
        amountBMin: "1",
        to: deployer.address,
        deadline: new Date().getTime() + "800",
      });
    }
    return meshswapPoolAddress;
  case 7:
    await tokenA.mint(router, parseUnits(amountADesired, await tokenA.decimals()));
    await tokenB.mint(router, parseUnits(amountBDesired, await tokenB.decimals()));
  }
}

async function swapExactTokensForTokens({ dex, amountIn, path, from = "deployer", fee = "3000" }) {
  await initialize();
  const signers = await getNamedSigners();
  const tokenIn = path[0];
  const tokenOut = path[1];
  const tokenInContract = await getContractAt("ERC20Mock", tokenIn);
  await tokenInContract.mint(signers[from].address, amountIn);

  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;

  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);
  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1:
    // uniswap v2
    await run("router:swapExactTokensForTokens", {
      router: router,
      from: from,
      to: from,
      amountIn: amountIn.toString(),
      path: [tokenIn, tokenOut].toString(),
    });
    break;
  case 2:
    // uniswap v3
    await run("UniswapV3::Swap:ExactInputSingle", {
      swapRouter: router,
      from: from,
      to: signers[from].address,
      tokenA: tokenIn,
      tokenB: tokenOut,
      fee: fee,
      amountIn: amountIn.toString(),
    });
    break;
  case 3:
    // curve
    await run("curve:swapExactTokensForTokens", {
      router: router,
      from: from,
      to: from,
      amountIn: amountIn.toString(),
      tokenA: tokenIn,
      tokenB: tokenOut,
    });
    break;
  case 5:
    // quickswap v3
    await run("QuickswapV3::Swap:ExactInputSingle", {
      swapRouter: router,
      from: from,
      to: signers[from].address,
      tokenA: tokenIn,
      tokenB: tokenOut,
      amountIn: amountIn.toString(),
    });
    break;
  case 6:
    // meshswap
    await run("Meshswap:swapExactTokensForTokens", {
      router: router,
      from: from,
      to: from,
      amountIn: amountIn.toString(),
      path: [tokenIn, tokenOut].toString(),
    });
    break;
  }
}

async function getAmountsOut(dex, amountIn, path, pools) {
  await initialize();
  let amountOut;
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;
  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);
  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1: {
    // uniswap v2
    const uniswapV2Router = await getContractAt("IUniswapV2Router02", router);
    const result = await uniswapV2Router.getAmountsOut(amountIn, path);
    amountOut = result[path.length - 1];
    break;
  }
  case 2: {
    // uniswap v3
    const Quoter = await getContract("QuoterUniswapV3");
    const encodedPath = getEncodedPath(path, dex, pools);
    amountOut = await Quoter.callStatic.quoteExactInput(encodedPath, amountIn);
    break;
  }
  case 3: {
    // curve
    const curveSwapRouter = await getContractAt("Swaps", router);
    amountOut = amountIn;
    for (let i = 0; i < path.length - 1; i++) {
      if (pools && pools.length) {
        amountOut = await curveSwapRouter["get_exchange_amount(address,address,address,uint256)"](
          pools[i],
          path[i],
          path[i + 1],
          amountOut,
        );
      } else {
        amountOut = (await curveSwapRouter["get_best_rate(address,address,uint256)"](path[i], path[i + 1], amountOut))[1];
      }
    }
    break;
  }
  case 4: {
    const signers = await getNamedSigners();
    const vault = await getContractAt(await getContractAbi("Vault"), router);
    const steps = [];
    for (let i = 0; i < path.length - 1; i++) {
      const poolContract = await getContractAt(await getContractAbi("WeightedPool"), pools[i]);
      const poolId = await poolContract.getPoolId();
      steps.push({
        poolId: poolId,
        assetInIndex: i,
        assetOutIndex: i + 1,
        amount: i === 0 ? amountIn : 0,
        userData: "0x",
      });
    }
    const funds = [signers.caller.address, false, signers.caller.address, false];
    const deltas = await vault.callStatic.queryBatchSwap(0, steps, path, funds);
    amountOut = deltas[path.length - 1].mul(NegativeOne);
    break;
  }
  case 5: {
    // quickswapv3
    const Quoter = await getContract("QuoterQuickswapV3");
    const encodedPath = await getEncodedPath(path, dex, pools);
    [amountOut] = await Quoter.callStatic.quoteExactInput(encodedPath, amountIn);
    break;
  }
  case 6: {
    // meshswap
    const routerImplContract = await getContractAt("RouterImpl", router);
    amountOut = (await routerImplContract.getAmountsOut(amountIn, path))[path.length - 1];
    break;
  }
  }
  return amountOut;
}

async function getAmountsIn(dex, amountOut, path, pools) {
  await initialize();
  let amountIn = BigNumber.from("0");
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;
  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);
  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1: {
    // uniswap v2
    const uniswapV2Router = await getContractAt("IUniswapV2Router02", router);
    amountIn = (await uniswapV2Router.getAmountsIn(amountOut, path))[0];
    break;
  }
  case 2: {
    // uniswap v3
    const Quoter = await getContract("QuoterUniswapV3");
    const encodedPath = getEncodedPath(path, dex, pools);
    amountIn = await Quoter.callStatic.quoteExactOutput(encodedPath, amountOut);
    break;
  }
  case 3: {
    // curve
    const inverseAmount = await getAmountsOut("curve", amountOut, path.concat().reverse(), pools.concat().reverse());
    // expanding the search to +50% and -50% from the inverseAmount
    let minValue = BigNumber.from(
      wadMul(inverseAmount.toString(), BigNumber.from("5").mul(BigNumber.from("10").pow("17")).toString()).toString(),
    );
    let maxValue = BigNumber.from(
      wadMul(inverseAmount.toString(), BigNumber.from("15").mul(BigNumber.from("10").pow("17")).toString()).toString(),
    );

    for (let i = 0; i <= 100; i++) {
      const middle = minValue.add(maxValue).div("2");
      if (amountIn.eq(middle)) break;
      amountIn = middle;
      const factAmountOut = await getAmountsOut("curve", amountIn, path, pools);
      if (factAmountOut.eq(amountOut)) {
        break;
      } else if (factAmountOut.lt(amountOut)) {
        minValue = amountIn;
      } else {
        maxValue = amountIn;
      }
    }
    break;
  }
  case 4: {
    const signers = await getNamedSigners();
    const vault = await getContractAt(await getContractAbi("Vault"), router);
    const steps = [];

    for (let i = 0; i < path.length - 1; i++) {
      const poolContract = await getContractAt(await getContractAbi("WeightedPool"), pools[i]);
      const poolId = await poolContract.getPoolId();
      steps.push({
        poolId: poolId,
        assetInIndex: i,
        assetOutIndex: i + 1,
        amount: 0,
        userData: "0x",
      });
    }
    steps.reverse();
    steps[0].amount = amountOut;
    const funds = [signers.caller.address, false, signers.caller.address, false];
    const deltas = await vault.callStatic.queryBatchSwap(1, steps, path, funds);
    amountIn = deltas[0];
    break;
  }
  case 5: {
    // quickswap v3
    const Quoter = await getContract("QuoterQuickswapV3");
    const encodedPath = getEncodedPath(path, dex, pools);
    [amountIn] = await Quoter.callStatic.quoteExactOutput(encodedPath, amountOut);
    break;
  }
  case 6: {
    // meshswap
    const routerImplContract = await getContractAt("RouterImpl", router);
    amountIn = (await routerImplContract.getAmountsIn(amountOut, path))[0];
    break;
  }
  }
  return amountIn;
}

async function getAncillaryDexData({ dex, fee = "3000", pid = "0", pool }) {
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;

  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);

  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1:
  case 5: {
    // uniswap v2, quickswapv3
    return HashZero;
  }
  case 2: {
    // uniswap v3
    return hexZeroPad(BigNumber.from(fee).toHexString(), 32);
  }
  case 3: {
    // curve
    return pool ? hexZeroPad(pool, 32) : HashZero;
  }
  case 4: {
    // Balancer
    const poolContract = await getContractAt(await getContractAbi("WeightedPool"), pool);
    const poolId = await poolContract.getPoolId();
    return poolId;
  }
  case 6: {
    // meshswap
    return HashZero;
  }
  }
}

async function getGas(dex) {
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;

  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);

  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1: {
    // uniswap v2
    return BigNumber.from("152809");
  }
  case 2:
  case 5: {
    // uniswap v3
    return BigNumber.from("184523");
  }
  case 3: {
    // curve
    return BigNumber.from("183758");
  }
  case 4: {
    // Balancer
    return BigNumber.from("196625");
  }
  case 6: {
    // meshswap
    return BigNumber.from("271000");
  }
  }
}

async function getPair(dex, token0, token1, fee = "3000", pool) {
  await initialize();
  let pairAddress, meshswapFactory, factoryImplContract;
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;
  const routerContract = await getContractAt("IUniswapV2Router02", router);
  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(routerContract.address);
  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1: {
    // uniswap v2
    const uniswapV2Factory = await getContractAt("UniswapV2Factory", await routerContract.factory());
    pairAddress = await uniswapV2Factory.getPair(token0, token1);
    break;
  }
  case 2: {
    // uniswap v3
    const uniswapV3Factory = await getContractAt("UniswapV3Factory", await routerContract.factory());
    pairAddress = await uniswapV3Factory.getPool(token1, token0, fee);
    break;
  }
  case 3: {
    // curve
    const curveRouter = await getContractAt("Swaps", (await PrimexDNS.dexes(dex)).routerAddress);
    const curveRegistry = await getContractAt("Registry", await curveRouter.registry());
    pairAddress = await curveRegistry.callStatic["find_pool_for_coins(address,address)"](token0, token1);
    break;
  }
  case 4: {
    pairAddress = pool;
    break;
  }
  case 5: {
    // quickswap v3
    const quickswapV3Factory = await getContract("QuickswapV3Factory");
    pairAddress = await quickswapV3Factory.poolByPair(token1, token0);
    break;
  }
  case 6: {
    // meshswap
    meshswapFactory = await getContract("MeshswapFactory");
    factoryImplContract = await getContractAt("FactoryImpl", meshswapFactory.address);
    pairAddress = await factoryImplContract.getPair(token0, token1);
    break;
  }
  }
  return pairAddress;
}

async function getEncodedPath(assetAddresses, dex, pools = ["3000"]) {
  const PrimexDNS = await getContract("PrimexDNS");
  const router = (await PrimexDNS.dexes(dex)).routerAddress;

  const DexAdapter = await getContract("DexAdapter");
  const dexType = await DexAdapter.dexType(router);

  switch (dexType) {
  case 0:
    // default(address is not a dex)
    throw new Error("not set as an dex in the dex adapter");
  case 1:
  case 6: {
    // uniswap v2
    return defaultAbiCoder.encode(["address[]"], [assetAddresses]);
  }
  case 2: {
    // uniswap v3
    const dataArr = [];
    for (let i = 0; i < assetAddresses.length; i++) {
      dataArr.push(assetAddresses[i]);
      if (i !== assetAddresses.length - 1) dataArr.push(hexZeroPad(BigNumber.from(pools[i]).toHexString(), 3));
    }
    return hexConcat(dataArr);
  }
  case 3: {
    // curve
    return defaultAbiCoder.encode(["address[]", "address[]"], [assetAddresses, pools]);
  }
  case 4: {
    // Balancer
    const poolIds = [];
    for (let i = 0; i < pools.length; i++) {
      const poolContract = await getContractAt(await getContractAbi("WeightedPool"), pools[i]);
      poolIds.push(await poolContract.getPoolId());
    }
    const limits = Array(assetAddresses.length).fill(0);
    limits[0] = MaxUint256.div(2);
    return defaultAbiCoder.encode(["address[]", "bytes32[]", "int256[]"], [assetAddresses, poolIds, limits]);
  }
  case 5: {
    return hexConcat(assetAddresses);
  }
  case 7: {
    return pools[0];
  }
  }
}

async function getPaths(pathData = []) {
  const paths = [];
  for (let i = 0; i < pathData.length; i++) {
    const { dex, path, shares, pool } = pathData[i];
    paths.push({
      dexName: dex,
      shares: shares,
      payload: await getEncodedPath(path, dex, pool),
    });
  }
  return paths;
}

async function getRoutes(routesData = []) {
  const routes = [];
  for (let i = 0; i < routesData.length; i++) {
    const { to, pathData } = routesData[i];
    routes.push({
      to: to,
      paths: await getPaths(pathData),
    });
  }
  return routes;
}

async function getSinglePath(path, dex, pools) {
  return [
    {
      dexName: dex,
      shares: 1,
      payload: await getEncodedPath(path, dex, pools),
    },
  ];
}

async function getSingleRoute(path, dex, pools) {
  return [
    {
      to: path[path.length - 1],
      paths: await getSinglePath(path, dex, pools),
    },
  ];
}

async function getSingleMegaRoute(path, dex, pools, shares = 1) {
  return [
    {
      shares: shares,
      routes: await getSingleRoute(path, dex, pools),
    },
  ];
}

async function getMegaRoutes(megaRoutesData = []) {
  const megaRoutes = [];
  for (let i = 0; i < megaRoutesData.length; i++) {
    const { shares, routesData } = megaRoutesData[i];
    megaRoutes.push({
      shares: shares,
      routes: await getRoutes(routesData),
    });
  }
  return megaRoutes;
}
async function getEmptyMegaRoute() {
  return {
    shares: 0,
    routes: [],
  };
}

module.exports = {
  addLiquidity,
  getAmountsOut,
  getAmountsIn,
  getPair,
  getRoutes,
  getEmptyMegaRoute,
  getMegaRoutes,
  getPaths,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  CurvePoolsByTokenAmount,
  getGas,
  getEncodedPath,
  getSingleRoute,
  getSingleMegaRoute,
  getSinglePath,
};
