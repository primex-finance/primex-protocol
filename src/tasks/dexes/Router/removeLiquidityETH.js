// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, token, liquidity, amountTokenMin, amountETHMin, to, deadline },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      provider: { getBalance },
    },
  },
) {
  let factory, lpToken, amountETHOut, amountTokenOut;

  router = await getContractAt("IUniswapV2Router02", router);
  token = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", token);
  factory = await router.factory();
  factory = await getContractAt("IUniswapV2Factory", factory);
  lpToken = await factory.getPair(router.WETH(), token.address);
  lpToken = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", lpToken);
  deadline = new Date().getTime() + deadline;

  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountETHOut = await getBalance(to.address);
  amountTokenOut = await token.balanceOf(to.address);

  let txApprove = await lpToken.connect(from).approve(router.address, liquidity);
  txApprove = await txApprove.wait();

  let txRemove = await router
    .connect(from)
    .removeLiquidityETH(token.address, liquidity, amountTokenMin, amountETHMin, to.address, deadline);
  txRemove = await txRemove.wait();

  amountETHOut = (await getBalance(to.address)).sub(amountETHOut);
  amountTokenOut = (await token.balanceOf(to.address)).sub(amountTokenOut);

  if (from === to) {
    const gasOfApprove = txApprove.effectiveGasPrice.mul(txApprove.gasUsed);
    const gasOfSwap = txRemove.effectiveGasPrice.mul(txRemove.gasUsed);
    const gas = gasOfApprove.add(gasOfSwap);
    amountETHOut = amountETHOut.add(gas);
  }

  return [amountETHOut, amountTokenOut];
};
