// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  {
    tokenA,
    tokenB,
    from,
    nonfungiblePositionManager,
    fee,
    to,
    amountADesired,
    amountBDesired,
    amountAMin,
    amountBMin,
    tickLower,
    tickUpper,
    deadline,
  },
  {
    ethers: {
      getNamedSigners,
      getContract,
      getContractAt,
      utils: { parseUnits },
      BigNumber,
    },
  },
) {
  const signers = await getNamedSigners();
  from = signers[from];

  if (from === undefined) throw new Error(`signer ${from} undefined`);
  if ((tickLower === undefined) !== (tickUpper === undefined)) throw new Error("one of ticks is undefined");

  if (!nonfungiblePositionManager) {
    nonfungiblePositionManager = (await getContract("UniswapNonfungiblePositionManager")).address;
  }

  const feesData = { 10000: { tikSpace: 200 }, 3000: { tikSpace: 60 }, 500: { tikSpace: 10 } };

  if (!tickLower) {
    // both params are undefined
    tickLower = (Math.ceil(-887272 / feesData[fee].tikSpace) * feesData[fee].tikSpace).toString();
    tickUpper = (Math.floor(887272 / feesData[fee].tikSpace) * feesData[fee].tikSpace).toString();
  }

  const tokenAContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenA);
  const tokenBContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenB);

  amountADesired = parseUnits(amountADesired, await tokenAContract.decimals());
  amountBDesired = parseUnits(amountBDesired, await tokenBContract.decimals());

  const txApproveTokenA = await tokenAContract.approve(nonfungiblePositionManager, amountADesired);
  await txApproveTokenA.wait();

  const txApproveTokenB = await tokenBContract.approve(nonfungiblePositionManager, amountBDesired);
  await txApproveTokenB.wait();

  let token0, token1, amount0Min, amount1Min, amount0Desired, amount1Desired;
  if (tokenA.toLowerCase() > tokenB.toLowerCase()) {
    token0 = tokenB;
    token1 = tokenA;
    amount0Min = amountBMin;
    amount1Min = amountAMin;
    amount0Desired = amountBDesired;
    amount1Desired = amountADesired;
  } else {
    token0 = tokenA;
    token1 = tokenB;
    amount0Min = amountAMin;
    amount1Min = amountBMin;
    amount0Desired = amountADesired;
    amount1Desired = amountBDesired;
  }

  const NonfungiblePositionManagerContract = await getContractAt("NonfungiblePositionManager", nonfungiblePositionManager);

  const mintArgs = {
    token0: token0,
    token1: token1,
    tickLower: tickLower,
    tickUpper: tickUpper,
    fee: fee,
    recipient: to,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: amount0Min,
    amount1Min: amount1Min,
    deadline: deadline,
  };
  // estimateGas does not work in Obscuro
  const estimateGas = process.env.OBSCURO
    ? BigNumber.from("100000000")
    : await NonfungiblePositionManagerContract.connect(from).estimateGas.mint(mintArgs);
  const txAddLiquidity = await NonfungiblePositionManagerContract.connect(from).mint(mintArgs, { gasLimit: estimateGas.add("100000") });
  await txAddLiquidity.wait();
};
