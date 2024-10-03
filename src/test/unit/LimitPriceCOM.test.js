// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  ethers: {
    BigNumber,
    getContract,
    getNamedSigners,
    utils: { parseEther, parseUnits },
  },
  deployments: { fixture },
} = require("hardhat");

const { getLimitPriceParams } = require("../utils/conditionParams");

const { deployMockBucket, deployMockERC20 } = require("../utils/waffleMocks");
const { NATIVE_CURRENCY } = require("../utils/constants");

process.env.TEST = true;

describe("LimitPriceCOM_unit", function () {
  let snapshotId, mockOrder, mockBucket, tokenA, tokenB, params;
  let deployer, trader;
  let limitPriceCOM;

  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader } = await getNamedSigners());

    limitPriceCOM = await getContract("LimitPriceCOM");
    mockBucket = await deployMockBucket(deployer);
    tokenA = await deployMockERC20(deployer);
    tokenB = await deployMockERC20(deployer);
    mockOrder = {
      bucket: mockBucket.address,
      positionAsset: tokenA.address,
      depositAsset: tokenB.address,
      depositAmount: parseEther("5"),
      protocolFee: parseEther("1"), // not calculated number
      feeToken: NATIVE_CURRENCY,
      trader: trader.address,
      deadline: BigNumber.from(new Date().getTime() + 600),
      id: BigNumber.from(1),
      leverage: parseUnits("1", 18),
      shouldOpenPosition: true,
      createdAt: BigNumber.from(new Date().getTime()),
      updatedConditionsAt: BigNumber.from(new Date().getTime()),
      extraParams: "0x",
    };
    params = getLimitPriceParams(parseEther("1"));
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

  describe("canBeFilledAfterSwap", function () {
    const canBeFilledParams = [
      "(address,address,address,uint256,address,uint256,address,uint256,uint256,uint256,bool,uint256,uint256,bytes)",
      "bytes",
      "bytes",
      "uint256",
    ];
    it("Should return false if params is empty", async function () {
      const params = getLimitPriceParams(parseEther("0"));
      const exchangeRate = parseEther("1");
      expect(await limitPriceCOM[`canBeFilledAfterSwap(${canBeFilledParams})`](mockOrder, params, 0x0, exchangeRate)).to.equal(false);
    });

    it("Should return true if exchange rate is lower or equal to the limit price", async function () {
      const exchangeRate = parseEther("1");
      expect(await limitPriceCOM[`canBeFilledAfterSwap(${canBeFilledParams})`](mockOrder, params, 0x0, exchangeRate)).to.equal(true);
      const exchangeRate2 = parseEther("0.9");
      expect(await limitPriceCOM[`canBeFilledAfterSwap(${canBeFilledParams})`](mockOrder, params, 0x0, exchangeRate2)).to.equal(true);
    });

    it("Should return false if exchange rate is greater than the limit price", async function () {
      const exchangeRate = parseEther("1.1");
      expect(await limitPriceCOM[`canBeFilledAfterSwap(${canBeFilledParams})`](mockOrder, params, 0x0, exchangeRate)).to.equal(false);
    });
  });

  describe("getLimitPrice", function () {
    it("Should decode limit price", async function () {
      const amount = parseEther("10");
      const encodedParams = getLimitPriceParams(amount);

      expect(await limitPriceCOM.getLimitPrice(encodedParams)).to.equal(amount);
    });
  });
});
