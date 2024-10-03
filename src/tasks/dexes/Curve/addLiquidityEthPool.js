// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { from, pool, liquidityMin, secondToken, amounts, lpTokenReceiver },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  amounts = JSON.parse(amounts);
  const signers = await getNamedSigners();

  if (signers[from] !== undefined) {
    from = signers[from];
  }

  const poolContract = await getContractAt("StableSwapSTETH", pool);

  secondToken = await getContractAt("ERC20Mock", secondToken);

  // 'cause first token is the native currency
  amounts[0] = parseUnits(amounts[0], 18);
  amounts[1] = parseUnits(amounts[1], await secondToken.decimals());

  const approveTx = await secondToken.connect(from).approve(pool, amounts[1]);
  await approveTx.wait();

  console.log(amounts[0]);
  console.log(amounts[1]);
  const txAddLiquidity = await poolContract.connect(from).add_liquidity(amounts, liquidityMin, { value: amounts[0] });
  await txAddLiquidity.wait();
  console.log("add");

  if (lpTokenReceiver !== undefined) {
    if (signers[lpTokenReceiver] !== undefined) {
      lpTokenReceiver = signers[lpTokenReceiver].address;
    }
    if (lpTokenReceiver === from.address) return;

    const lpTokenAddress = await poolContract.lp_token();
    const lptoken = await getContractAt("ERC20Mock", lpTokenAddress);
    const lpTokenBalance = await lptoken.balanceOf(from.address);

    const transferTx = await lptoken.connect(from).transfer(lpTokenReceiver, lpTokenBalance);
    await transferTx.wait();
  }
};
