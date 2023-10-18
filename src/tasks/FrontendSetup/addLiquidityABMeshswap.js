// SPDX-License-Identifier: BUSL-1.1
const { devNode1, fuzzing, devNode2, devNode3 } = require("./amounts.json");
const { getConfig } = require("../../config/configUtils");

const FEE = "5";

module.exports = async function (
  { _ },
  {
    getNamedAccounts,
    run,
    ethers: {
      getContract,
      utils: { parseUnits },
    },
  },
) {
  const { deployer } = await getNamedAccounts();
  const FactoryAddress = getConfig("dexes").meshswap.factory;

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

  // TODO: add other tokens
  const tokensMap = {
    TokenWETH: await getContract("Wrapped Ether"),
    TokenWBTC: await getContract("Wrapped Bitcoin"),
    TokenUSDC: await getContract("USD Coin"),
    TokenLINK: await getContract("ChainLink"),
    TokenUNI: await getContract("Uniswap"),
    TokenUSDT: await getContract("Tether USD"),
  };

  const { botAccounts } = require("../utils/accountAddresses");
  const botAccount = botAccounts[1];

  for (const pair of Object.keys(amounts.meshswap)) {
    const tokenNames = pair.split("-"); // convert "TokenWETH-TokenWBTC" to ["TokenWETH", "TokenWBTC"]

    const tokenA = tokensMap[tokenNames[0]];
    const amountA = amounts.meshswap[pair][0];
    const tokenB = tokensMap[tokenNames[1]];
    const amountB = amounts.meshswap[pair][1];

    const txMintTokenA = await tokenA.mint(deployer, parseUnits(amountA, await tokenA.decimals()));
    await txMintTokenA.wait();
    const txMintTokenB = await tokenB.mint(deployer, parseUnits(amountB, await tokenB.decimals()));
    await txMintTokenB.wait();

    await run("Meshswap:createPoolAndAddLiquidity", {
      to: botAccount,
      factoryAddress: FactoryAddress,
      tokenA: tokenA.address,
      amountADesired: amountA,
      tokenB: tokenB.address,
      amountBDesired: amountB,
      fee: FEE,
    });
  }
  console.log("Liquidity Meshswap added!");
};
