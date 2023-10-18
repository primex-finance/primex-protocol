// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, tokenA, tokenB, liquidity, amountAMin, amountBMin, to, deadline },
  { ethers: { getNamedSigners, getContractAt } },
) {
  let factory, lpToken, amountTokenAOut, amountTokenBOut;

  router = await getContractAt("IUniswapV2Router02", router);
  factory = await router.factory();
  factory = await getContractAt("IUniswapV2Factory", factory);
  lpToken = await factory.getPair(tokenA, tokenB);
  lpToken = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", lpToken);
  tokenA = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", tokenA);
  tokenB = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", tokenB);
  deadline = new Date().getTime() + deadline;

  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountTokenAOut = await tokenA.balanceOf(to.address);
  amountTokenBOut = await tokenB.balanceOf(to.address);

  const txApprove = await lpToken.connect(from).approve(router.address, liquidity);
  await txApprove.wait();
  const txRemoveLiquidity = await router
    .connect(from)
    .removeLiquidity(tokenA.address, tokenB.address, liquidity, amountAMin, amountBMin, to.address, deadline);
  await txRemoveLiquidity.wait();
  amountTokenAOut = (await tokenA.balanceOf(to.address)).sub(amountTokenAOut);
  amountTokenBOut = (await tokenB.balanceOf(to.address)).sub(amountTokenBOut);

  return [amountTokenAOut, amountTokenBOut];
};
