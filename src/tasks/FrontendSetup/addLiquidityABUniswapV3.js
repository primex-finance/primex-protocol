// SPDX-License-Identifier: BUSL-1.1
const fs = require("fs");
const { devNode1, fuzzing, devNode2, devNode3 } = require("./amounts.json");
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
    deployments: { getArtifact },
  },
) {
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
  const NonfungiblePositionManager = getConfig("dexes").uniswapv3.nonfungiblePositionManager;

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
  for (const pair of Object.keys(amounts.uniswapV3)) {
    const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]
    pools.push({ token0: tokensMap[tokenNames[0]], token1: tokensMap[tokenNames[1]], amounts: amounts.uniswapV3[pair] });
  }

  const fees = ["10000", "3000", "500"];

  const addLiquidity = async function (tokenA, tokenB, [amountADesired, amountBDesired], fee) {
    const txMint = await tokenA.mint(deployer, parseUnits(amountADesired, await tokenA.decimals()));
    await txMint.wait();
    const txMint2 = await tokenB.mint(deployer, parseUnits(amountBDesired, await tokenB.decimals()));
    await txMint2.wait();

    await run("UniswapV3:CreatePool", {
      nonfungiblePositionManager: NonfungiblePositionManager,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      fee: fee,
      from: "deployer",
      reservTokenA: amountADesired,
      reservTokenB: amountBDesired,
    });

    await run("UniswapV3:addLiquidity", {
      nonfungiblePositionManager: NonfungiblePositionManager,
      tokenA: tokenA.address,
      tokenB: tokenB.address,
      fee: fee,
      from: "deployer",
      to: deployer,
      amountADesired: amountADesired,
      amountBDesired: amountBDesired,
    });

    const UniswapV3Pool = await getArtifact("UniswapV3Pool");
    const NonfungiblePositionManagerContract = await getContractAt("NonfungiblePositionManager", NonfungiblePositionManager);
    const UniswapV3Factory = await getContractAt("UniswapV3Factory", await NonfungiblePositionManagerContract.factory());
    const poolAddress = await UniswapV3Factory.getPool(tokenA.address, tokenB.address, fee);
    const pairNames = ` ${await tokenA.symbol()}+${await tokenB.symbol()} fee-${fee}`;
    fs.writeFileSync(
      `./deployments/${network.name}/UniswapV3 ${pairNames}.json`,
      `{
      "address": "${poolAddress}", 
      "abi": ${JSON.stringify(UniswapV3Pool.abi)}
    }`,
    );
  };

  for (const pool of pools) {
    for (const fee of fees) {
      if (pool.amounts.fee[fee]) {
        await addLiquidity(pool.token0, pool.token1, pool.amounts.fee[fee], fee);
      }
    }
  }

  console.log("Liquidity UniswapV3 added!");
};
