// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  run,
  network,
  ethers: {
    getContract,
    getNamedSigners,
    utils: { parseEther },
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { getTrailingStopParams, getTrailingStopAdditionalParams } = require("../utils/conditionParams");
const { RAY } = require("../utils/constants");

const { deployMockBucket, deployMockERC20, deployMockPriceOracle } = require("../utils/waffleMocks");

process.env.TEST = true;

describe("TrailingStopCCM_unit", function () {
  let snapshotId,
    mockPosition,
    mockBucket,
    tokenA,
    tokenB,
    primexPricingLibrary,
    positionLibrary,
    primexDNS,
    registry,
    priceOracle,
    trailingStopCCM;
  let deployer, trader;
  let scaledDebtAmount, depositAmountInSoldAsset, positionAmount;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["PositionLibrary", "Registry", "Errors", "PrimexDNS"]);
    ({ deployer, trader } = await getNamedSigners());

    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    positionLibrary = await getContract("PositionLibrary");
    registry = await getContract("Registry");
    ErrorsLibrary = await getContract("Errors");
    [priceOracle] = await deployMockPriceOracle(deployer);
    primexDNS = await getContract("PrimexDNS");

    await run("deploy:TrailingStopCCM", {
      primexDNS: primexDNS.address,
      priceOracle: priceOracle.address,
      primexPricingLibrary: primexPricingLibrary.address,
      positionLibrary: positionLibrary.address,
    });
    trailingStopCCM = await getContract("TrailingStopCCM");

    mockBucket = await deployMockBucket(deployer);
    tokenA = await deployMockERC20(deployer);
    tokenB = await deployMockERC20(deployer);
    await mockBucket.mock.borrowedAsset.returns(tokenA.address);
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

  describe("constructor", function () {
    it("Should initialize with correct values", async function () {
      expect(await trailingStopCCM.priceOracle()).to.equal(priceOracle.address);
    });

    it("Should revert when initialized with wrong priceOracle address", async function () {
      const wrongAddress = registry.address;
      await expect(
        run("deploy:TrailingStopCCM", {
          primexDNS: primexDNS.address,
          priceOracle: wrongAddress,
          primexPricingLibrary: primexPricingLibrary.address,
          positionLibrary: positionLibrary.address,
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("canBeClosedBeforeSwap", function () {
    it("Should return false when params are empty", async function () {
      const additionalParams = getTrailingStopAdditionalParams(
        [BigNumber.from(1), BigNumber.from(1)],
        [BigNumber.from(1), BigNumber.from(1)],
      );
      const params = [];
      expect(
        await trailingStopCCM.callStatic[
          "canBeClosedBeforeSwap((uint256,uint256,address,address,uint256,address,uint256,address,uint256,uint256,uint256,bytes),bytes,bytes)"
        ](mockPosition, params, additionalParams),
      ).to.equal(false);
    });

    it("Should return false when additionalParams are empty", async function () {
      const additionalParams = [];
      const params = getTrailingStopParams(1, 1);
      expect(
        await trailingStopCCM.callStatic[
          "canBeClosedBeforeSwap((uint256,uint256,address,address,uint256,address,uint256,address,uint256,uint256,uint256,bytes),bytes,bytes)"
        ](mockPosition, params, additionalParams),
      ).to.equal(false);
    });

    it("Should revert when lowPriceRoundNumber < highPriceRoundNumber", async function () {
      const additionalParams = getTrailingStopAdditionalParams(
        [BigNumber.from(2), BigNumber.from(2)],
        [BigNumber.from(1), BigNumber.from(1)],
      );
      const params = getTrailingStopParams(1, 1);
      await expect(
        trailingStopCCM.callStatic[
          "canBeClosedBeforeSwap((uint256,uint256,address,address,uint256,address,uint256,address,uint256,uint256,uint256,bytes),bytes,bytes)"
        ](mockPosition, params, additionalParams),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "LOW_PRICE_ROUND_IS_LESS_HIGH_PRICE_ROUND");
    });
  });
});
