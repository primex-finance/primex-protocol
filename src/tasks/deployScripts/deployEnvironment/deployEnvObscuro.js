// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run, ethers: { getNamedSigners, getDefaultProvider } }) {
  // to use obscure you need to run Obscuro Wallet Extension first
  // https://docs.obscu.ro/wallet-extension/wallet-extension/
  process.env.OBSCURO = true;
  // isETHNotNative???
  await run("setup:deployEnv", {
    deployUniswap: true,
    deployCurve: true,
  });
};
