// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { from, pool, liquidityMin, assets, lpTokenReceiver },
  {
    ethers: {
      getNamedSigners,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  const { CurvePoolsByTokenAmount } = require("../../../test/utils/dexOperations");
  assets = JSON.parse(assets);
  const signers = await getNamedSigners();

  if (signers[from] !== undefined) {
    from = signers[from];
  }

  const isUnderlyingPool = CurvePoolsByTokenAmount[assets.length].underlying;
  const funcName = isUnderlyingPool ? "underlying_coins" : "coins";
  const poolName = CurvePoolsByTokenAmount[assets.length].name;
  const depositName = CurvePoolsByTokenAmount[assets.length].name;
  const poolContract = await getContractAt(isUnderlyingPool ? depositName : poolName, pool);

  const amounts = [];

  for (let i = 0; i < assets.length; i++) {
    const token = await getContractAt("ERC20Mock", await poolContract[funcName](i, { gasLimit: 1500000 }));
    amounts[i] = parseUnits(assets[i].amount, await token.decimals());

    const approveTx = await token.connect(from).approve(pool, amounts[i]);
    await approveTx.wait();
  }

  const txAddLiquidity = await poolContract.connect(from).add_liquidity(amounts, liquidityMin, { gasLimit: 1500000 });
  await txAddLiquidity.wait();

  if (lpTokenReceiver !== undefined) {
    if (signers[lpTokenReceiver] !== undefined) {
      lpTokenReceiver = signers[lpTokenReceiver].address;
    }
    if (lpTokenReceiver === from.address) return;

    const lpTokenAddress = await poolContract.token({ gasLimit: 1500000 });
    const lptoken = await getContractAt("ERC20Mock", lpTokenAddress);
    const lpTokenBalance = await lptoken.balanceOf(from.address);

    const transferTx = await lptoken.connect(from).transfer(lpTokenReceiver, lpTokenBalance);
    await transferTx.wait();
  }
};
