// SPDX-License-Identifier: BUSL-1.1
const { NonfungiblePositionManagerArtifact } = require("./utils.js");

module.exports = async function (
  {
    tokenA,
    tokenB,
    from,
    nonfungiblePositionManager,
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
    },
  },
) {
  const signers = await getNamedSigners();
  from = signers[from];

  if (from === undefined) throw new Error(`signer ${from} undefined`);
  if ((tickLower === undefined) !== (tickUpper === undefined)) throw new Error("one of ticks is undefined");

  if (!nonfungiblePositionManager) {
    nonfungiblePositionManager = (await getContract("QuickswapNonfungiblePositionManager")).address;
  }

  // In the quickswap the tikSpace is always 60
  const tikSpace = 60;

  if (tickLower === undefined) {
    // both params are undefined
    tickLower = (Math.ceil(-887272 / tikSpace) * tikSpace).toString();
    tickUpper = (Math.floor(887272 / tikSpace) * tikSpace).toString();
  }

  const tokenAContract = await getContractAt("ERC20", tokenA);
  const tokenBContract = await getContractAt("ERC20", tokenB);

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

  const NonfungiblePositionManagerContract = await getContractAt(NonfungiblePositionManagerArtifact.abi, nonfungiblePositionManager);

  const mintArgs = {
    token0: token0,
    token1: token1,
    tickLower: tickLower,
    tickUpper: tickUpper,
    amount0Desired: amount0Desired,
    amount1Desired: amount1Desired,
    amount0Min: amount0Min,
    amount1Min: amount1Min,
    recipient: to,
    deadline: deadline,
  };
  const estimateGas = await NonfungiblePositionManagerContract.connect(from).estimateGas.mint(mintArgs);
  const txAddLiquidity = await NonfungiblePositionManagerContract.connect(from).mint(mintArgs, { gasLimit: estimateGas.add("100000") });
  await txAddLiquidity.wait();
};
