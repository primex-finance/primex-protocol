// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { to, factoryAddress, tokenA, tokenB, amountADesired, amountBDesired, fee },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  const signers = await getNamedSigners();

  if (signers[to] !== undefined) {
    to = signers[to].address;
  }

  const tokenAcontract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenA);
  const tokenBcontract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenB);

  const amountA = parseUnits(amountADesired, await tokenAcontract.decimals());
  const amountB = parseUnits(amountBDesired, await tokenBcontract.decimals());

  const txApproveToken0 = await tokenAcontract.approve(factoryAddress, amountA);
  await txApproveToken0.wait();
  const txApproveToken1 = await tokenBcontract.approve(factoryAddress, amountB);
  await txApproveToken1.wait();

  const FactoryImplContract = await getContractAt("FactoryImpl", factoryAddress);

  const tx = await FactoryImplContract.createTokenPool(tokenA, amountA, tokenB, amountB, fee);
  await tx.wait();

  const poolAddress = await FactoryImplContract.getPair(tokenA, tokenB);
  const poolContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", poolAddress);
  const amount = await poolContract.balanceOf(signers.deployer.address);
  const transferLPTx = await poolContract.transfer(to, amount);
  await transferLPTx.wait();

  return poolAddress;
};
