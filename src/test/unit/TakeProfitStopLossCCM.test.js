// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  ethers: {
    getContract,
    getNamedSigners,
    utils: { parseEther },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { getTakeProfitStopLossParams, getTakeProfitStopLossAdditionalParams } = require("../utils/conditionParams");
const { RAY } = require("../utils/constants");

const { deployMockBucket, deployMockERC20 } = require("../utils/waffleMocks");
const { getSingleRoute } = require("../utils/dexOperations");

process.env.TEST = true;

describe("TakeProfitStopLossCCM_unit", function () {
  let snapshotId, mockPosition, mockBucket, tokenA, tokenB, assetRoutes, dex, takeProfitStopLossCCM;
  let deployer, trader;
  let scaledDebtAmount, depositAmountInSoldAsset, positionAmount;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());

    takeProfitStopLossCCM = await getContract("TakeProfitStopLossCCM");
    mockBucket = await deployMockBucket(deployer);
    tokenA = await deployMockERC20(deployer);
    tokenB = await deployMockERC20(deployer);
    scaledDebtAmount = parseEther("1");
    depositAmountInSoldAsset = parseEther("1");
    positionAmount = parseEther("2");
    mockPosition = {
      id: 0,
      scaledDebtAmount: scaledDebtAmount,
      bucket: mockBucket.address,
      soldAsset: tokenB.address,
      depositAmountInSoldAsset: depositAmountInSoldAsset,
      positionAsset: tokenA.address,
      positionAmount: positionAmount,
      trader: trader.address,
      openBorrowIndex: RAY,
      createdAt: BigNumber.from(new Date().getTime()),
      updatedConditionsAt: BigNumber.from(new Date().getTime()),
      extraParams: "0x",
    };
    dex = "uniswap";
    assetRoutes = await getSingleRoute([tokenB.address, tokenA.address], dex);
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

  describe("canBeClosedBeforeSwap", function () {
    it("Should return false when params are empty", async function () {
      const additionalParams = getTakeProfitStopLossAdditionalParams(assetRoutes);
      const params = [];
      expect(
        await takeProfitStopLossCCM.callStatic[
          "canBeClosedBeforeSwap((uint256,uint256,address,address,uint256,address,uint256,address,uint256,uint256,uint256,bytes),bytes,bytes)"
        ](mockPosition, params, additionalParams),
      ).to.equal(false);
    });
  });

  describe("getTakeProfitStopLossPrices", function () {
    it("Should decode TakeProfit, StopLoss price", async function () {
      const tp = parseEther("10");
      const sl = parseEther("5");
      const encodedParams = getTakeProfitStopLossParams(tp, sl);

      expect(await takeProfitStopLossCCM.getTakeProfitStopLossPrices(encodedParams)).to.eql([tp, sl]);
    });
  });
});
