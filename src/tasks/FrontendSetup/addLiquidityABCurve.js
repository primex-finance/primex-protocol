// SPDX-License-Identifier: BUSL-1.1
const { devNode1: testAmounts } = require("./amounts.json");
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
    deployments: { getArtifact },
  },
) {
  const dexes = getConfig("dexes");
  const curveRegistry = dexes.curveRegistry;
  const { deployer } = await getNamedAccounts();
  const { CurvePoolsByTokenAmount } = require("../../test/utils/dexOperations");
  const { botAccounts } = require("../utils/accountAddresses");
  const botAccount = botAccounts[5];

  const tokensMap = {
    TokenWETH: await getContract("Wrapped Ether"),
    TokenWBTC: await getContract("Wrapped Bitcoin"),
    TokenUSDC: await getContract("USD Coin"),
    TokenLINK: await getContract("ChainLink"),
    TokenUNI: await getContract("Uniswap"),
    TokenUSDT: await getContract("Tether USD"),
  };

  const pools = [];
  for (const pair of Object.keys(testAmounts.curve)) {
    const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]
    for (const tokenName of tokenNames) {
      const Token = tokensMap[tokenName];
      const tokenAmount = testAmounts.curve[pair][tokenName];
      const txMint = await Token.mint(deployer, parseUnits(tokenAmount, await Token.decimals()));
      await txMint.wait();
    }
    // Decimal Sequence is important: 6/8/18
    pools.push({
      tokens: tokenNames.map(name => tokensMap[name].address),
      amounts: Object.values(testAmounts.curve[pair]),
    });
  }

  const addLiquidity = async function (tokens, amounts) {
    const assets = [];
    for (let i = 0; i < tokens.length; i++) {
      assets[i] = { token: tokens[i], amount: amounts[i] };
    }
    const pool = await run("curve:createPool", {
      assets: JSON.stringify(assets),
      from: "deployer",
      curveRegistry: curveRegistry,
    });
    await run("curve:addLiquidity", {
      from: "deployer",
      pool: pool.pool,
      assets: JSON.stringify(assets),
      liquidityMin: "0",
      lpTokenReceiver: botAccount,
    });
    return pool;
  };

  for (let i = 0; i < pools.length; i++) {
    pools[i].pool = (await addLiquidity(pools[i].tokens, pools[i].amounts)).pool;
  }
  const data = {};

  for (let i = 0; i < pools.length; i++) {
    let poolName = "";
    for (let j = 0; j < pools[i].tokens.length; j++) {
      const token = await getContractAt("ERC20Mock", pools[i].tokens[j]);
      let name = (await token.symbol()).toLowerCase();
      poolName += name += j === pools[i].tokens.length - 1 ? "" : "-";
    }
    data[poolName] = { pool: pools[i].pool };

    const CurvePool = await getArtifact(CurvePoolsByTokenAmount[pools[i].tokens.length].name);
    fs.writeFileSync(
      `./deployments/${network.name}/Curve ${poolName}.json`,
      `{
      "address": "${pools[i].pool}", 
      "abi": ${JSON.stringify(CurvePool.abi)}
    }`,
    );
  }

  dexes.curve.pools = data;
  setConfig("dexes", dexes);

  fs.writeFileSync(`./deployments/${network.name}/CurvePools.json`, JSON.stringify(data));
  console.log("Liquidity Curve added!");
};
