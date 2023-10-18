// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ disable }, { ethers: { getContract } }) {
  const enable = !disable;

  const TokenWETH = await getContract("Wrapped Ether");
  const TokenWBTC = await getContract("Wrapped Bitcoin");
  const TokenUSDC = await getContract("USD Coin");
  const TokenLINK = await getContract("ChainLink");
  const TokenUNI = await getContract("Uniswap");
  const TokenUSDT = await getContract("Tether USD");

  const tokens = [TokenWETH, TokenWBTC, TokenUSDC, TokenLINK, TokenUNI, TokenUSDT];

  for (const token of tokens) {
    const tx = await token.setMintTimeLimit(enable);
    await tx.wait();
  }
  console.log(`token limited mint ${enable}`);
};
