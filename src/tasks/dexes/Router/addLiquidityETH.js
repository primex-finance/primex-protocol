// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, amountETHDesired, token, amountTokenDesired, amountTokenMin, amountETHMin, to, deadline },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseEther },
      constants: { AddressZero },
    },
  },
) {
  let factory, lpToken;
  let lpAmountReceived = 0;
  amountTokenDesired = parseEther(amountTokenDesired);

  router = await getContractAt("IUniswapV2Router02", router);
  factory = await router.factory();
  factory = await getContractAt("IUniswapV2Factory", factory);
  lpToken = await factory.getPair(router.WETH(), token);

  if (lpToken !== AddressZero) {
    lpToken = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", lpToken);
    lpAmountReceived = await lpToken.balanceOf(to.address);
  }

  token = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", token);
  deadline = new Date().getTime() + deadline;

  const signers = await getNamedSigners();

  from = signers[from];
  to = signers[to];

  const txApprove = await token.connect(from).approve(router.address, amountTokenDesired);
  await txApprove.wait();
  const txAddLiquidityETH = await router
    .connect(from)
    .addLiquidityETH(token.address, amountTokenDesired, amountTokenMin, amountETHMin, to.address, deadline, {
      value: parseEther(amountETHDesired),
    });
  await txAddLiquidityETH.wait();

  lpToken = await factory.getPair(router.WETH(), token.address);
  lpToken = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", lpToken);
  lpAmountReceived = (await lpToken.balanceOf(to.address)).sub(lpAmountReceived);

  return lpAmountReceived;
};
