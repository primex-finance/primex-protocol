// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { curveRegistry, secondToken },
  {
    ethers: {
      getNamedSigners,
      getContract,
      getContractAt,
      getContractFactory,
      constants: { HashZero },
    },
  },
) {
  const { deployer } = await getNamedSigners();

  if (!curveRegistry) {
    curveRegistry = (await getContract("CurveRegistry")).address;
  }
  if (!secondToken) {
    secondToken = (
      await run("deploy:ERC20Mock", {
        name: "Wrapped Ether",
        symbol: "WETH",
        decimals: "18",
      })
    ).address;
  }

  const CurveRegistryContract = await getContractAt("Registry", curveRegistry);

  const CurveTokenFactory = await getContractFactory("CurveTokenV3");
  const lpToken = await CurveTokenFactory.deploy("Pool LP token", "crvLP");
  await lpToken.deployed();

  const CurvePoolFactory = await getContractFactory("StableSwapSTETH");
  const returnData = {};
  let tx;
  const deployParams = [
    deployer.address,
    ["0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE", secondToken],
    lpToken.address,
    5,
    4000000,
    5000000000,
  ];
  const addPoolParams = [
    2,
    lpToken.address,
    HashZero,
    4626, // Coin decimal values, tightly packed as uint8 in a little-endian bytes32 OR 0
    0,
    false,
    false,
    "Pool",
  ];

  const pool = await CurvePoolFactory.deploy(...deployParams);
  await pool.deployed();
  returnData.pool = pool.address;

  tx = await CurveRegistryContract.connect(deployer).add_pool_without_underlying(pool.address, ...addPoolParams, { gasLimit: 1500000 });
  await tx.wait();

  tx = await lpToken.set_minter(returnData.pool);
  await tx.wait();

  return returnData;
};
