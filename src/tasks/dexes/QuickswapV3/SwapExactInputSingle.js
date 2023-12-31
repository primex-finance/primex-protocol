// SPDX-License-Identifier: BUSL-1.1
const { encodePriceSqrt } = require("../../../test/utils/encodePriceSqrt");
const { SwapRouterArtifact } = require("./utils.js");

module.exports = async function (
  { swapRouter, tokenA, tokenB, from, to, deadline, amountIn, amountOutMinimum, reservTokenA, reservTokenB },
  { ethers: { getContract, getContractAt, getNamedSigners } },
) {
  const signers = await getNamedSigners();
  from = signers[from];
  if (from === undefined) throw new Error(`signer ${from} undefined`);

  const tokenBContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenB);
  let amountOut = await tokenBContract.balanceOf(to);

  if (!swapRouter) {
    swapRouter = (await getContract("QuickswapRouterV3")).address;
  }

  const tokenAContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenA);
  const txApprove = await tokenAContract.approve(swapRouter, amountIn);
  await txApprove.wait();
  const SwapRouterContract = await getContractAt(SwapRouterArtifact.abi, swapRouter);

  const reservToken0 = tokenA.toLowerCase() > tokenB.toLowerCase() ? reservTokenB : reservTokenA;
  const reservToken1 = tokenA.toLowerCase() > tokenB.toLowerCase() ? reservTokenA : reservTokenB;

  const txSwap = await SwapRouterContract.connect(from).exactInputSingle({
    tokenIn: tokenA,
    tokenOut: tokenB,
    recipient: to,
    deadline: deadline,
    amountIn: amountIn,
    amountOutMinimum: amountOutMinimum,
    limitSqrtPrice: encodePriceSqrt(reservToken0, reservToken1), // this variable is used to swap up to a certain price. It is not used in our cases
  });
  await txSwap.wait();
  amountOut = (await tokenBContract.balanceOf(to)).sub(amountOut);

  return amountOut;
};
