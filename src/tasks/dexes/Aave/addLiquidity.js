// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ token, amount, from, to }, { ethers: { getNamedSigners, getContractAt } }) {
  const { getPoolAddressesProvider } = require("@aave/deploy-v3");
  const signers = await getNamedSigners();
  if (signers[from] !== undefined) {
    from = signers[from];
  }
  if (signers[to] !== undefined) {
    to = signers[to].address;
  }

  const addressesProvider = await getPoolAddressesProvider();
  const poolAddress = await addressesProvider.getPool();
  const AavePool = await getContractAt("Pool", poolAddress);

  const tokenContract = await getContractAt("ERC20Mock", token);
  const txApproveToken = await tokenContract.connect(from).approve(poolAddress, amount);
  await txApproveToken.wait();

  const txAddLiquidity = await AavePool.connect(from).supply(token, amount, to, 0);
  await txAddLiquidity.wait();
};
