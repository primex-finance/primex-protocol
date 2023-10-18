// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  run,
  network,
  ethers: {
    getContract,
    getContractAt,
    getNamedSigners,
    utils: { parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");

const { addLiquidity, checkIsDexSupported, CurvePoolsByTokenAmount } = require("./utils/dexOperations");

process.env.TEST = true;

describe("CurveBotLens", function () {
  let PrimexDNS, snapshotId;
  let dex, dexRouter, pool;
  let testToken1, testToken2, testToken3;

  // These numbers are known to work properly with TriCrypto pool.
  // Do not use random numbers.
  const decimals = [6, 8, 18];
  const amounts = ["63843737", "3362", "49713"];
  let CurveBotLens, curveLPToken;
  let poolAssets = [];

  before(async function () {
    await fixture(["Test"]);

    PrimexDNS = await getContract("PrimexDNS");
    CurveBotLens = await getContract("CurveBotLens");

    await run("deploy:ERC20Mock", {
      name: "TestToken1",
      symbol: "TT1",
      decimals: "" + decimals[0],
    });
    testToken1 = await getContract("TestToken1");

    await run("deploy:ERC20Mock", {
      name: "TestToken2",
      symbol: "TT2",
      decimals: "" + decimals[1],
    });
    testToken2 = await getContract("TestToken2");

    await run("deploy:ERC20Mock", {
      name: "TestToken3",
      symbol: "TT3",
      decimals: "" + decimals[2],
    });
    testToken3 = await getContract("TestToken3");

    poolAssets = [
      { contract: testToken1, amount: parseUnits(amounts[0], decimals[0]) },
      { contract: testToken2, amount: parseUnits(amounts[1], decimals[1]) },
      { contract: testToken3, amount: parseUnits(amounts[2], decimals[2]) },
    ];

    dex = "curve";
    dexRouter = await PrimexDNS.getDexAddress(dex);
    checkIsDexSupported(dex);

    const liquidity = [
      { token: testToken1.address, amount: amounts[0] },
      { token: testToken2.address, amount: amounts[1] },
      { token: testToken3.address, amount: amounts[2] },
    ];
    pool = await addLiquidity({ dex: dex, from: "deployer", assets: liquidity });

    const curveSwapRouter = await getContractAt("Swaps", dexRouter);
    const registry = CurvePoolsByTokenAmount[poolAssets.length].cryptoRegistry
      ? await getContractAt("CryptoRegistry", await curveSwapRouter.crypto_registry())
      : await getContractAt("Registry", await curveSwapRouter.registry());
    const lpTokenAddress = await registry.get_lp_token(pool, { gasLimit: 1500000 });
    curveLPToken = await getContractAt("ERC20Mock", lpTokenAddress);
  });

  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });

  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });

  async function mintAndApprove(sender_, assets_) {
    for (const asset of assets_) {
      await asset.contract.mint(sender_.address, asset.amount);
      await asset.contract.connect(sender_).approve(CurveBotLens.address, asset.amount);
    }
  }

  async function assetBalances(user_, assets_) {
    const balances = [];
    for (const asset of assets_) {
      const balance = await asset.contract.balanceOf(user_.address);
      balances.push(balance);
    }
    return balances;
  }

  describe("removeAndSetLiquidity", function () {
    it("should have less lp tokens and more assets after reducing liquidity", async function () {
      const { deployer } = await getNamedSigners();

      const lpTokenBalanceBefore = await curveLPToken.balanceOf(deployer.address);
      const balancesBefore = await assetBalances(deployer, poolAssets);

      await curveLPToken.connect(deployer).approve(CurveBotLens.address, lpTokenBalanceBefore);
      const liquidity = [poolAssets[0].amount.div(2), poolAssets[1].amount.div(2), poolAssets[2].amount.div(2)];
      await CurveBotLens.connect(deployer).removeAndSetLiquidity(pool, liquidity);

      const lpTokenBalanceAfter = await curveLPToken.balanceOf(deployer.address);
      expect(lpTokenBalanceAfter.lt(lpTokenBalanceBefore));

      const balancesAfter = await assetBalances(deployer, poolAssets);
      expect(balancesAfter[0].gt(balancesBefore[0]));
      expect(balancesAfter[1].gt(balancesBefore[1]));
      expect(balancesAfter[2].gt(balancesBefore[2]));
    });

    it("should have more lp tokens and less assets after increasing liquidity", async function () {
      const { deployer } = await getNamedSigners();
      await mintAndApprove(deployer, poolAssets);

      const lpTokenBalanceBefore = await curveLPToken.balanceOf(deployer.address);
      const balancesBefore = await assetBalances(deployer, poolAssets);

      await curveLPToken.connect(deployer).approve(CurveBotLens.address, lpTokenBalanceBefore);
      const liquidity = [poolAssets[0].amount.mul(2), poolAssets[1].amount.mul(2), poolAssets[2].amount.mul(2)];
      await CurveBotLens.connect(deployer).removeAndSetLiquidity(pool, liquidity);

      const lpTokenBalanceAfter = await curveLPToken.balanceOf(deployer.address);
      const balancesAfter = await assetBalances(deployer, poolAssets);
      expect(lpTokenBalanceAfter.gt(lpTokenBalanceBefore));
      expect(balancesAfter[0].lt(balancesBefore[0]));
      expect(balancesAfter[1].lt(balancesBefore[1]));
      expect(balancesAfter[2].lt(balancesBefore[2]));
    });

    it("should add liquidity without initial liquidity", async function () {
      // make sure to set liquidity not less than initial liquidity
      const { trader } = await getNamedSigners();
      await mintAndApprove(trader, poolAssets);

      const lpTokenBalanceBefore = await curveLPToken.balanceOf(trader.address);

      const liquidity = [poolAssets[0].amount.mul(2), poolAssets[1].amount.mul(2), poolAssets[2].amount.mul(2)];
      await CurveBotLens.connect(trader).removeAndSetLiquidity(pool, liquidity);

      const lpTokenBalanceAfter = await curveLPToken.balanceOf(trader.address);
      expect(lpTokenBalanceAfter.gt(lpTokenBalanceBefore));
    });

    it("should recalculate amounts if cannot remove necessary liquidity", async function () {
      const { deployer, trader } = await getNamedSigners();

      // add external liquidity
      await mintAndApprove(trader, poolAssets);

      const liquidity = [poolAssets[0].amount.mul(2), poolAssets[1].amount.mul(2), poolAssets[2].amount.mul(2)];
      await CurveBotLens.connect(trader).removeAndSetLiquidity(pool, liquidity);

      const lpTokenBalanceBefore = await curveLPToken.balanceOf(deployer.address);

      await curveLPToken.connect(deployer).approve(CurveBotLens.address, lpTokenBalanceBefore);
      const deployerLiquidity = [poolAssets[0].amount.div(2), poolAssets[1].amount.div(2), poolAssets[2].amount.div(2)];
      await CurveBotLens.connect(deployer).removeAndSetLiquidity(pool, deployerLiquidity);

      const lpTokenBalanceAfter = await curveLPToken.balanceOf(deployer.address);
      expect(lpTokenBalanceAfter.gt(lpTokenBalanceBefore));
    });
  });
});
