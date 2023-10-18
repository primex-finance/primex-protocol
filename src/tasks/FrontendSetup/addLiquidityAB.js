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
      utils: { parseUnits },
      getContract,
      getContractAt,
    },
    deployments: { getArtifact },
  },
) {
  const { deployer } = await getNamedAccounts();

  const tokensMap = {
    TokenWETH: await getContract("Wrapped Ether"),
    TokenWBTC: await getContract("Wrapped Bitcoin"),
    TokenUSDC: await getContract("USD Coin"),
    TokenLINK: await getContract("ChainLink"),
    TokenUNI: await getContract("Uniswap"),
    TokenUSDT: await getContract("Tether USD"),
  };

  const routers = [];
  const dexes = [];

  let amounts = devNode1;
  const dexesConfig = getConfig("dexes");

  if (dexesConfig.uniswap?.router !== undefined) {
    routers.push(dexesConfig.uniswap.router);
    dexes.push("uniswapV2");
  }

  if (dexesConfig.quickswap?.router !== undefined) {
    routers.push(dexesConfig.quickswap.router);
    // for quickswap we use amounts from uniswap
    dexes.push("uniswapV2");
  }

  if (dexesConfig.sushiswap?.router !== undefined) {
    routers.push(dexesConfig.sushiswap.router);
    dexes.push("sushiswapV2");
  }

  if (process.env.DEV_NODE2) {
    amounts = devNode2;
  } else if (process.env.DEV_NODE3) {
    amounts = devNode3;
  } else if (process.env.FUZZING) {
    amounts = fuzzing;
  }

  const tokenAmounts = {};
  // calc needed amounts to mint
  for (let i = 0; i < dexes.length; i++) {
    for (const pair of Object.keys(amounts[dexes[i]])) {
      const amountsPair = amounts[dexes[i]][pair];
      const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]
      tokenAmounts[tokenNames[0]] = (tokenAmounts[tokenNames[0]] || 0) + parseInt(amountsPair[0]);
      tokenAmounts[tokenNames[1]] = (tokenAmounts[tokenNames[1]] || 0) + parseInt(amountsPair[1]);
    }
  }

  for (const token of Object.keys(tokenAmounts)) {
    const txMint = await tokensMap[token].mint(deployer, parseUnits(tokenAmounts[token].toString(), await tokensMap[token].decimals()));
    await txMint.wait();
  }

  const { botAccounts } = require("../utils/accountAddresses");
  const botAccount = botAccounts[2];

  const addLiquidity = async function (router, tokenA, tokenB, [amountADesired, amountBDesired]) {
    await run("router:addLiquidity", {
      router,
      from: "deployer",
      to: botAccount,
      tokenA,
      tokenB,
      amountADesired,
      amountBDesired,
    });
  };

  const factories = [];
  for (let i = 0; i < dexes.length; i++) {
    for (const pair of Object.keys(amounts[dexes[i]])) {
      const amountsPair = amounts[dexes[i]][pair];
      const tokenNames = pair.split("-"); // convert from string to array
      await addLiquidity(routers[i], tokensMap[tokenNames[0]].address, tokensMap[tokenNames[1]].address, amountsPair);
      const router = await getContractAt("IUniswapV2Router02", routers[i]);
      factories.push(await getContractAt("IUniswapV2Factory", await router.factory()));
    }
  }

  const pairArtifact = await getArtifact("UniswapV2Pair");

  const tokens = Object.values(tokensMap);
  for (let k = 0; k < dexes.length; k++) {
    for (let i = 0; i < tokens.length - 1; i++) {
      for (let j = i + 1; j < tokens.length; j++) {
        const pair = await factories[k].getPair(tokens[i].address, tokens[j].address);
        const pairName = `${dexes[k]} ${await tokens[i].symbol()}+${await tokens[j].symbol()} Pair`;
        fs.writeFileSync(
          `./deployments/${network.name}/${pairName}.json`,
          `{
        "address": "${pair}", 
        "abi": ${JSON.stringify(pairArtifact.abi)}
      }`,
        );
      }
    }
  }
  console.log("Liquidity added!");
};
