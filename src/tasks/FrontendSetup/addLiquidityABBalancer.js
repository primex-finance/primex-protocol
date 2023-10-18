// SPDX-License-Identifier: BUSL-1.1
const { devNode1, fuzzing, devNode2, devNode3 } = require("./amounts.json");
const { getContractAbi } = require("../dexes/Balancer/utils");
const fs = require("fs");
const { getConfig, setConfig } = require("../../config/configUtils");

module.exports = async function (
  { _ },
  {
    network,
    getNamedAccounts,
    run,
    ethers: {
      utils: { parseUnits },
      getContract,
      getContractAt,
    },
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

  const dexes = getConfig("dexes");
  const Vault = dexes.balancer.router;
  const WeightedPoolFactory = dexes.balancer.weightedPoolFactory;

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
  for (const pair of Object.keys(amounts.balancer)) {
    const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]
    pools.push({
      tokens: tokenNames.map(name => tokensMap[name]),
      amounts: tokenNames.map(name => amounts.balancer[pair][name]),
      weights: amounts.balancer[pair].weights,
    });
  }

  for (let i = 0; i < pools.length; i++) {
    for (let j = 0; j < pools[i].tokens.length; j++) {
      const amount = parseUnits(pools[i].amounts[j], await pools[i].tokens[j].decimals());
      const txMint = await pools[i].tokens[j].mint(deployer, amount);
      await txMint.wait();
    }
  }
  const { botAccounts } = require("../utils/accountAddresses");
  const botAccount = botAccounts[6];
  const addLiquidity = async function (tokens, amounts, weights) {
    const assets = [];
    for (let i = 0; i < tokens.length; i++) {
      assets[i] = { token: tokens[i].address, amount: amounts[i], weight: weights[i] };
    }
    const pool = await run("balancer:createPool", {
      assets: JSON.stringify(assets),
      factory: WeightedPoolFactory,
      from: "deployer",
    });

    await run("balancer:addLiquidity", {
      pool,
      assets: JSON.stringify(assets),
      vault: Vault,
      from: "deployer",
      to: botAccount,
    });
    return pool;
  };

  for (let i = 0; i < pools.length; i++) {
    pools[i].pool = await addLiquidity(pools[i].tokens, pools[i].amounts, pools[i].weights);
  }
  const data = {};

  const poolAbi = await getContractAbi("WeightedPool");

  for (let i = 0; i < pools.length; i++) {
    const pool = pools[i].pool;
    let poolName = "";
    for (let j = 0; j < pools[i].tokens.length; j++) {
      const token = pools[i].tokens[j];
      let name = (await token.symbol()).toLowerCase();
      poolName += name += j === pools[i].tokens.length - 1 ? "" : "-";
    }
    const poolContract = await getContractAt(poolAbi, pool);
    const poolId = await poolContract.getPoolId();
    data[poolName] = { pool, poolId };
    fs.writeFileSync(
      `./deployments/${network.name}/BalancerPool ${poolName}.json`,
      `{
        "address": "${pool}", 
        "abi": ${JSON.stringify(poolAbi)}
      }`,
    );
  }

  dexes.balancer.pools = data;
  setConfig("dexes", dexes);

  fs.writeFileSync(`./deployments/${network.name}/BalancerPools.json`, JSON.stringify(data));
  console.log("Liquidity Balancer added!");
};
