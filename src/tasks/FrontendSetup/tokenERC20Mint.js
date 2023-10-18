// SPDX-License-Identifier: BUSL-1.1

const { setConfig } = require("../../config/configUtils.js");

module.exports = async function (
  { _ },
  {
    ethers: {
      getNamedSigners,
      utils: { parseEther, parseUnits },
      provider: { getBalance },
      constants: { MaxUint256 },
    },
  },
) {
  const { deployer } = await getNamedSigners();
  const { userAccounts, botAccounts } = require("../utils/accountAddresses");

  const testAccounts = [deployer.address].concat(userAccounts).concat(botAccounts);

  const testBalances = ["100000000"];
  for (let i = 0; i < userAccounts.length; i++) {
    testBalances.push("500");
  }
  for (let i = 0; i < botAccounts.length; i++) {
    testBalances.push("100000000");
  }
  if (process.env.FUZZING) {
    testAccounts.push(process.env.FUZZING_CONTRACT_ADDRESS);
    testBalances.push("10000000000000000000");
  }

  const testAccountsJson = JSON.stringify(testAccounts);
  const testBalancesJson = JSON.stringify(testBalances);

  const weth = await run("deploy:ERC20Mock", {
    name: "Wrapped Ether",
    symbol: "WETH",
    decimals: "18",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseEther("8").toString(),
  });

  const wbtc = await run("deploy:ERC20Mock", {
    name: "Wrapped Bitcoin",
    symbol: "WBTC",
    decimals: "8",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseUnits("0.5", 8).toString(),
  });

  const usdc = await run("deploy:ERC20Mock", {
    name: "USD Coin",
    symbol: "USDC",
    decimals: "6",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseUnits("21000", 6).toString(),
  });

  const link = await run("deploy:ERC20Mock", {
    name: "ChainLink",
    symbol: "LINK",
    decimals: "18",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseEther("2700").toString(),
  });

  const uniswap = await run("deploy:ERC20Mock", {
    name: "Uniswap",
    symbol: "UNI",
    decimals: "18",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseEther("3000").toString(),
  });

  const usdt = await run("deploy:ERC20Mock", {
    name: "Tether USD",
    symbol: "USDT",
    decimals: "6",
    initialAccounts: testAccountsJson,
    initialBalances: testBalancesJson,
    mintingAmount: parseUnits("21000", 6).toString(),
  });
  const assets = {
    weth: weth.address,
    wbtc: wbtc.address,
    usdc: usdc.address,
    link: link.address,
    uni: uniswap.address,
    usdt: usdt.address,
  };
  setConfig("assets", assets);

  if (!process.env.TEST && (process.env.DEV_NODE1 || process.env.DEV_NODE2 || process.env.DEV_NODE3)) {
    for (const acc of testAccounts) {
      if ((await getBalance(acc)).lte(parseEther("10.0"))) {
        const tx = await deployer.sendTransaction({
          to: acc,
          value: parseEther("80.0"),
        });
        await tx.wait();
      }
    }
  }

  console.log("Mints to test accounts completed.");
};
