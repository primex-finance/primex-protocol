const { BigNumber } = require("ethers");

// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { curveRegistry, assets },
  {
    ethers: {
      getNamedSigners,
      getContract,
      getContractAt,
      getContractFactory,
      constants: { HashZero, AddressZero },
    },
  },
) {
  const { deployer } = await getNamedSigners();
  const { CurvePoolsByTokenAmount } = require("../../../test/utils/dexOperations");

  assets = JSON.parse(assets);

  if (!curveRegistry) {
    curveRegistry = (await getContract(CurvePoolsByTokenAmount[assets.length].cryptoRegistry ? "CurveCryptoRegistry" : "CurveRegistry"))
      .address;
  }
  const CurveRegistryContract = await getContractAt(
    CurvePoolsByTokenAmount[assets.length].cryptoRegistry ? "CryptoRegistry" : "Registry",
    curveRegistry,
  );

  const CurveTokenFactory = await getContractFactory(CurvePoolsByTokenAmount[assets.length].token);
  const lpToken = await CurveTokenFactory.deploy("Pool LP token", "crvLP");
  await lpToken.deployed();

  const CurveMathFactory = await getContractFactory("TriCryptoMath");
  const math = await CurveMathFactory.deploy();
  await math.deployed();

  const CurveViewsFactory = await getContractFactory("Views");
  const views = await CurveViewsFactory.deploy(math.address);
  await views.deployed();

  const CurvePoolFactory = await getContractFactory(CurvePoolsByTokenAmount[assets.length].name);
  const returnData = {};
  if (CurvePoolsByTokenAmount[assets.length].underlying) {
    const underlyingTokens = [];
    for (let i = 0; i < assets.length; i++) {
      // Test token from Curve
      const tokenFactory = await getContractFactory("yERC20");
      const token = await tokenFactory.deploy(`y-Token${i}`, `$tkn${i}`, 18, assets[i].token, 0);
      await token.deployed();
      underlyingTokens[i] = token.address;
    }
    const pool = await CurvePoolFactory.deploy(
      underlyingTokens,
      assets.map(asset => asset.token),
      lpToken.address,
      5000,
      0,
    );
    await pool.deployed();

    const DepositPoolFactory = await getContractFactory(CurvePoolsByTokenAmount[assets.length].name);
    const depositPool = await DepositPoolFactory.deploy(
      underlyingTokens,
      assets.map(asset => asset.token),
      pool.address,
      lpToken.address,
    );
    await depositPool.deployed();
    const tx = await CurveRegistryContract.connect(deployer).add_pool(
      pool.address,
      assets.length,
      lpToken.address,
      HashZero,
      0,
      0,
      true,
      true,
      "Pool",
      { gasLimit: 1500000 },
    );
    await tx.wait();
    returnData.depositPool = depositPool.address;
    returnData.pool = pool.address;
  } else {
    let deployParams;
    let addPoolParams;
    if (CurvePoolsByTokenAmount[assets.length].cryptoRegistry) {
      deployParams = [
        deployer.address,
        assets.map(asset => asset.token),
        lpToken.address,
        math.address,
        views.address,
        deployer.address,
        BigNumber.from("54000"), // A
        BigNumber.from("3500000000000000"), // gamma
        BigNumber.from("11000000"), // mid_fee
        BigNumber.from("45000000"), // out_fee
        BigNumber.from("2000000000000"), // price_threshold,
        BigNumber.from("500000000000000"), // fee_gamma,
        BigNumber.from("490000000000000"), // adjustment_step,
        BigNumber.from("5000000000"), // admin_fee,
        BigNumber.from("600"), // ma_half_time
        [BigNumber.from("100000000000000000000000"), BigNumber.from("10000000000000000000000")], // initial prices
      ];
      addPoolParams = [
        assets.length,
        lpToken.address,
        AddressZero,
        AddressZero,
        0, // Coin decimal values, tightly packed as uint8 in a little-endian bytes32 OR 0
        "Pool",
      ];
    } else {
      deployParams = [deployer.address, assets.map(asset => asset.token), lpToken.address, 5000, 0, 0];
      addPoolParams = [
        assets.length,
        lpToken.address,
        HashZero,
        0, // Coin decimal values, tightly packed as uint8 in a little-endian bytes32 OR 0
        0,
        true,
        false,
        "Pool",
      ];
    }
    const pool = await CurvePoolFactory.deploy(...deployParams);
    await pool.deployed();
    returnData.pool = pool.address;

    const tx = await CurveRegistryContract.connect(deployer).add_pool(pool.address, ...addPoolParams, { gasLimit: 1500000 });
    await tx.wait();
  }
  const tx = await lpToken.set_minter(returnData.pool);
  await tx.wait();

  return returnData;
};
