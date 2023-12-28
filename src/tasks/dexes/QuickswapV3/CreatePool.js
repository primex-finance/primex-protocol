// SPDX-License-Identifier: BUSL-1.1
const { encodePriceSqrt } = require("../../../test/utils/encodePriceSqrt");
const { NonfungiblePositionManagerArtifact } = require("./utils.js");

module.exports = async function (
  { nonfungiblePositionManager, from, tokenA, tokenB, reservTokenA, reservTokenB },
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

  if (!nonfungiblePositionManager) {
    nonfungiblePositionManager = (await getContract("QuickswapNonfungiblePositionManager")).address;
  }

  const tokenAContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenA);
  const tokenBContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", tokenB);

  reservTokenA = parseUnits(reservTokenA, await tokenAContract.decimals());
  reservTokenB = parseUnits(reservTokenB, await tokenBContract.decimals());

  let token0, token1, reservToken0, reservToken1;
  if (tokenA.toLowerCase() > tokenB.toLowerCase()) {
    token0 = tokenB;
    token1 = tokenA;
    reservToken0 = reservTokenB;
    reservToken1 = reservTokenA;
  } else {
    token0 = tokenA;
    token1 = tokenB;
    reservToken0 = reservTokenA;
    reservToken1 = reservTokenB;
  }
  const NonfungiblePositionManagerContract = await getContractAt(NonfungiblePositionManagerArtifact.abi, nonfungiblePositionManager);
  const tx = await NonfungiblePositionManagerContract.connect(from).createAndInitializePoolIfNecessary(
    token0,
    token1,
    encodePriceSqrt(reservToken1, reservToken0),
  );
  tx.wait();
};
