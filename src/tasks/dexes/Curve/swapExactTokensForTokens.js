// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, amountIn, amountOutMin, pool, tokenA, tokenB, to },
  { ethers: { getNamedSigners, getContractAt, getContract } },
) {
  let amountOut;
  tokenA = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", tokenA);
  tokenB = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", tokenB);
  if (router) {
    router = await getContractAt("Swaps", router);
  } else {
    router = await getContract("CurveSwapRouter");
  }
  const registry = await getContract("CurveCryptoRegistry");
  if (!pool) {
    pool = await registry.callStatic["find_pool_for_coins(address,address)"](tokenA.address, tokenB.address);
  }
  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountOut = await tokenB.balanceOf(to.address);

  const txApprove = await tokenA.connect(from).approve(router.address, amountIn);
  await txApprove.wait();

  const txSwap = await router
    .connect(from)
    ["exchange(address,address,address,uint256,uint256,address)"](
      pool,
      tokenA.address,
      tokenB.address,
      amountIn,
      amountOutMin,
      to.address,
      { gasLimit: 1500000 },
    );
  await txSwap.wait();
  amountOut = (await tokenB.balanceOf(to.address)).sub(amountOut);

  return amountOut;
};
