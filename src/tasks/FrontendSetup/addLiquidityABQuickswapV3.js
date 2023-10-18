// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const { devNode1, fuzzing, devNode2, devNode3 } = require("./amounts.json");
const { AlgebraPool, AlgebraFactoryArtifact, NonfungiblePositionManagerArtifact } = require("../dexes/QuickswapV3/utils");
const { getConfig } = require("../../config/configUtils");

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    run,
    network,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  const NonfungiblePositionManager = getConfig("dexes").quickswapv3.nonfungiblePositionManager;

  let amounts;
  if (process.env.DEV_NODE2) {
    amounts = devNode2;
  } else if (process.env.DEV_NODE3) {
    amounts = devNode3;
  } else if (process.env.FUZZING) {
    amounts = fuzzing;
  } else {
    amounts = devNode1;
  }

  const { deployer } = await getNamedAccounts();

  const tokensMap = {
    TokenWETH: await getContract("Wrapped Ether"),
    TokenWBTC: await getContract("Wrapped Bitcoin"),
    TokenUSDC: await getContract("USD Coin"),
    TokenLINK: await getContract("ChainLink"),
    TokenUNI: await getContract("Uniswap"),
    TokenUSDT: await getContract("Tether USD"),
  };

  const pools = [];
  for (const pair of Object.keys(amounts.quickswapV3)) {
    const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]
    pools.push({ token0: tokensMap[tokenNames[0]], token1: tokensMap[tokenNames[1]], amounts: amounts.quickswapV3[pair] });
  }

  const addLiquidity = async function (tokenA, tokenB, [amountADesired, amountBDesired]) {
    const txMint = await tokenA.mint(deployer, parseUnits(amountADesired, await tokenA.decimals()));
    await txMint.wait();
    const txMint2 = await tokenB.mint(deployer, parseUnits(amountBDesired, await tokenB.decimals()));
    await txMint2.wait();

    await run("QuickswapV3:CreatePool", {
      nonfungiblePositionManager: NonfungiblePositionManager,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      from: "deployer",
      reservTokenA: amountADesired,
      reservTokenB: amountBDesired,
    });

    await run("QuickswapV3:addLiquidity", {
      nonfungiblePositionManager: NonfungiblePositionManager,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      from: "deployer",
      to: deployer,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
    });

    const NonfungiblePositionManagerContract = await getContractAt(NonfungiblePositionManagerArtifact.abi, NonfungiblePositionManager);
    const QuickswapV3Factory = await getContractAt(AlgebraFactoryArtifact.abi, await NonfungiblePositionManagerContract.factory());
    const poolAddress = await QuickswapV3Factory.poolByPair(tokenA.address, tokenB.address);
    const pairNames = ` ${await tokenA.symbol()}+${await tokenB.symbol()}`;
    fs.writeFileSync(
      `./deployments/${network.name}/QuickswapV3 ${pairNames}.json`,
      `{
      "address": "${poolAddress}", 
      "abi": ${JSON.stringify(AlgebraPool.abi)}
    }`,
    );
  };

  for (const pool of pools) {
    await addLiquidity(pool.token0, pool.token1, pool.amounts);
  }

  console.log("Liquidity QuickswapV3 added!");
};
