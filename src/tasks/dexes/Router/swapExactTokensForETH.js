// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, amountIn, amountOutMin, path, to, deadline },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      provider: { getBalance },
    },
  },
) {
  let amountOut;
  path = path.split(",");
  router = await getContractAt("IUniswapV2Router02", router);
  deadline = new Date().getTime() + deadline;

  const token = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", path[0]);
  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountOut = await getBalance(to.address);

  let txApprove = await token.connect(from).approve(router.address, amountIn);
  txApprove = await txApprove.wait();
  let txSwap = await router.connect(from).swapExactTokensForETH(amountIn, amountOutMin, path, to.address, deadline);
  txSwap = await txSwap.wait();
  amountOut = (await getBalance(to.address)).sub(amountOut);

  if (from === to) {
    const gasOfApprove = txApprove.effectiveGasPrice.mul(txApprove.gasUsed);
    const gasOfSwap = txSwap.effectiveGasPrice.mul(txSwap.gasUsed);
    const gas = gasOfApprove.add(gasOfSwap);
    amountOut = amountOut.add(gas);
    return amountOut;
  }

  return amountOut;
};
