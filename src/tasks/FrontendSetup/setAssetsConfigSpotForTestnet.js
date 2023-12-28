// SPDX-License-Identifier: BUSL-1.1
const { setConfig, getConfig } = require("../../config/configUtils");
const { USD_DECIMALS } = require("../../test/utils/constants");

module.exports = async function (
  { _ },
  {
    ethers: {
      getNamedSigners,
      getContract,
      getContractAt,
      utils: { parseEther, parseUnits },
    },
  },
) {
  const { deployer } = await getNamedSigners();
  const {
    assets,
    pricefeeds,
    dexes: {
      uniswap: { router },
    },
  } = getConfig();
  const { userAccounts, botAccounts } = require("../utils/accountAddresses");

  // Deploy new assets and mints to test accounts
  const testAccounts = [deployer.address].concat(userAccounts).concat(botAccounts);

  const testBalances = ["100000000"];
  for (let i = 0; i < userAccounts.length; i++) {
    testBalances.push("500");
  }
  for (let i = 0; i < botAccounts.length; i++) {
    testBalances.push("100000000");
  }

  const testAccountsJson = JSON.stringify(testAccounts);
  const testBalancesJson = JSON.stringify(testBalances);

  // Add new asset for spot if require.
  // If add new asset update: assetsForSpot, prices, amounts below.
  const aave = await run("deploy:ERC20Mock", {
    name: "Aave",
    symbol: "aave",
    decimals: "18",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseEther("250").toString(),
  });

  const bal = await run("deploy:ERC20Mock", {
    name: "Balancer",
    symbol: "bal",
    decimals: "18",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseEther("6000").toString(),
  });

  const assetsForSpot = {
    aave: aave.address,
    bal: bal.address,
  };
  const prices = {
    aave: "84", // aave-usd = 84 $
    bal: "3.45", // bal-usd = 3.45 $
  };
  const allAssets = { ...assets, ...assetsForSpot };
  setConfig("assets", allAssets);

  // Deploy priceFeed for newAsset-usd
  const allPriceFeeds = pricefeeds;

  for (const tokenSymbol in assetsForSpot) {
    const name = `${tokenSymbol}-usd`;
    const feedName = allPriceFeeds[tokenSymbol + "-usd"];
    let feed;
    if (feedName === undefined) {
      await run("deploy:PrimexAggregatorV3TestService", { name: name });
      feed = await getContract(`PrimexAggregatorV3TestService ${name} price feed`);
      allPriceFeeds.selfDeployed[name] = feed.address;
    }
    // PriceFeed setup
    // set feeds for new assets separately and don't update its value in priceBot
    let tx = await feed.setAnswer(parseUnits(prices[tokenSymbol], USD_DECIMALS));
    await tx.wait();
    tx = await feed.setDecimals(USD_DECIMALS);
    await tx.wait();
  }

  setConfig("pricefeeds", allPriceFeeds);

  // add liquidity on Dex
  const amounts = {
    "aave-bal": ["4300", "100000"],
    "aave-weth": ["10000", "45"],
    "aave-wbtc": ["2500", "6"],
    "aave-usdc": ["1000", "84000"],
    "bal-weth": ["50000", "80"],
    "bal-wbtc": ["100000", "10"],
    "bal-usdc": ["5000", "17250"],
  };

  const tokenAmounts = {};
  // calc needed amounts to mint
  for (const pair in amounts) {
    const amountsPair = amounts[pair];
    const tokenNames = pair.split("-");
    tokenAmounts[tokenNames[0]] = (tokenAmounts[tokenNames[0]] || 0) + parseInt(amountsPair[0]);
    tokenAmounts[tokenNames[1]] = (tokenAmounts[tokenNames[1]] || 0) + parseInt(amountsPair[1]);
  }
  for (const token in tokenAmounts) {
    const tokenContract = await getContractAt("ERC20Mock", allAssets[token]);
    const txMint = await tokenContract.mint(deployer.address, parseUnits(tokenAmounts[token].toString(), await tokenContract.decimals()));
    await txMint.wait();
  }
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

  for (const pair in amounts) {
    const amountsPair = amounts[pair];
    const tokenNames = pair.split("-"); // convert from string to array
    await addLiquidity(router, allAssets[tokenNames[0]], allAssets[tokenNames[1]], amountsPair);
  }
  console.log("Liquidity added!");
  console.log(
    "Initial setup for setting up new assets for spot/swap on testnet are complete. \n Please add data for 'pairsConfig' in pairsConfig.json.",
  );
};
