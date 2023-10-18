// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { name, symbol, decimals, initialAccounts, initialBalances, mintingAmount },
  {
    deployments: { deploy },
    ethers: {
      getNamedSigners,
      utils: { parseUnits },
    },
  },
) {
  const { lender, deployer } = await getNamedSigners();

  initialAccounts = JSON.parse(initialAccounts);
  initialBalances = JSON.parse(initialBalances);

  if (initialBalances.length !== initialAccounts.length) throw new Error("number of initial accounts and balances does not match");

  if (initialAccounts.length === 0) {
    initialAccounts = [lender.address];
  }

  if (initialBalances.length === 0) {
    initialBalances = [parseUnits("1200", decimals)];
  } else {
    for (let i = 0; i < initialBalances.length; i++) {
      if (initialBalances[i] === "0") throw new Error("0 tokens cannot be minted");
      initialBalances[i] = parseUnits(initialBalances[i], decimals);
    }
  }

  return await deploy(name, {
    from: deployer.address,
    contract: "ERC20Mock",
    args: [name, symbol, decimals, initialAccounts, initialBalances, mintingAmount],
    log: !process.env.TEST,
  });
};
