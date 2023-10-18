// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { router, from, tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseUnits },
      constants: { AddressZero },
    },
  },
) {
  let factory, lpToken;
  let lpAmountReceived = 0;
  const signers = await getNamedSigners();

  if (signers[from] !== undefined) {
    from = signers[from];
  }
  if (signers[to] !== undefined) {
    to = signers[to].address;
  }
  router = await getContractAt("IUniswapV2Router02", router);
  factory = await router.factory();
  factory = await getContractAt("IUniswapV2Factory", factory);
  lpToken = await factory.getPair(tokenA, tokenB);
  if (lpToken !== AddressZero) {
    lpToken = await factory.getPair(tokenA, tokenB);
    lpToken = await getContractAt("IERC20Metadata", lpToken);
    lpAmountReceived = await lpToken.balanceOf(to);
  }
  const fristToken = await getContractAt("IERC20Metadata", tokenA);
  const secondToken = await getContractAt("IERC20Metadata", tokenB);
  amountADesired = parseUnits(amountADesired, await fristToken.decimals());
  amountBDesired = parseUnits(amountBDesired, await secondToken.decimals());

  deadline = new Date().getTime() + deadline;

  const txApprove1token = await fristToken.connect(from).approve(router.address, amountADesired);
  await txApprove1token.wait();
  const txApprove2token = await secondToken.connect(from).approve(router.address, amountBDesired);
  await txApprove2token.wait();
  const txAddLiquidity = await router
    .connect(from)
    .addLiquidity(tokenA, tokenB, amountADesired, amountBDesired, amountAMin, amountBMin, to, deadline);
  await txAddLiquidity.wait();
  lpToken = await factory.getPair(tokenA, tokenB);
  lpToken = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", lpToken);
  lpAmountReceived = (await lpToken.balanceOf(to)).sub(lpAmountReceived);

  return lpAmountReceived;
};
