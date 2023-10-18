// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, amountIn, amountOutMin, path, to, deadline },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseEther },
    },
  },
) {
  let amountOut;
  path = path.split(",");
  router = await getContractAt("IUniswapV2Router02", router);
  deadline = new Date().getTime() + deadline;

  const token = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", path[path.length - 1]);
  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  amountOut = await token.balanceOf(to.address);

  const txSwap = await router.connect(from).swapExactETHForTokens(amountOutMin, path, to.address, deadline, {
    value: parseEther(amountIn),
  });
  await txSwap.wait();

  amountOut = (await token.balanceOf(to.address)).sub(amountOut);

  return amountOut;
};
