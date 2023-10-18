// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, amountIn, amountOutMin, path, to, deadline },
  { ethers: { getNamedSigners, getContractAt } },
) {
  let amountOut;
  path = path.split(",");
  const token1 = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", path[0]);
  const token2 = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", path[path.length - 1]);
  router = await getContractAt("IUniswapV2Router02", router);
  deadline = new Date().getTime() + deadline;

  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountOut = await token2.balanceOf(to.address);

  const txApprove = await token1.connect(from).approve(router.address, amountIn);
  await txApprove.wait();

  const txSwap = await router.connect(from).swapExactTokensForTokens(amountIn, amountOutMin, path, to.address, deadline);
  txSwap.wait();

  amountOut = (await token2.balanceOf(to.address)).sub(amountOut);

  return amountOut;
};
