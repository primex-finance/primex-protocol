// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getNamedSigners,
    utils: { parseEther, defaultAbiCoder },
    constants: { Zero },
    getContract,
    BigNumber,
  },
  deployments: { fixture },
} = require("hardhat");

const { RAY, BAR_CALC_PARAMS_DECODE } = require("../utils/constants");
const { barCalcParams } = require("../utils/defaultBarCalcParams");
const { parseArguments } = require("../utils/eventValidation");

process.env.TEST = true;

describe("InterestRateStrategy_unit", function () {
  let interestRateStrategy, ErrorsLibrary, snapshotId, reserveRate, deployer;
  before(async function () {
    ({ deployer } = await getNamedSigners());
    await fixture(["Test"]);
    interestRateStrategy = await getContract("InterestRateStrategy");
    ErrorsLibrary = await getContract("Errors");
    reserveRate = parseEther("0.1");
    const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]);
    await interestRateStrategy.setBarCalculationParams(paramsInBytes);
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

  it("Should setBarCalculationParams", async function () {
    const barCalcParams1 = { ...barCalcParams };
    barCalcParams1.urOptimal = "5555";
    const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams1)]);
    await interestRateStrategy.setBarCalculationParams(paramsInBytes);
    parseArguments(barCalcParams1, await interestRateStrategy.getBarCalculationParams(deployer.address));
  });

  it("Should emit BarCalculationParamsChanged when set is successful", async function () {
    const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]);
    await expect(interestRateStrategy.setBarCalculationParams(paramsInBytes))
      .to.emit(interestRateStrategy, "BarCalculationParamsChanged")
      .withArgs(deployer.address, barCalcParams.urOptimal, barCalcParams.k0, barCalcParams.k1, barCalcParams.b0, barCalcParams.b1);
  });

  it("Should calculate LAR=0 and BAR=0 if utilizationRatio=0", async function () {
    const result = await interestRateStrategy.calculateInterestRates(Zero, reserveRate);
    const bar = result[0];
    const lar = result[1];
    expect(bar).to.be.equal(Zero);
    expect(lar).to.be.equal(Zero);
  });

  it("Should revert if UR > 1", async function () {
    await expect(interestRateStrategy.calculateInterestRates(BigNumber.from(RAY).add(1), reserveRate)).to.be.revertedWithCustomError(
      ErrorsLibrary,
      "UR_IS_MORE_THAN_1",
    );
  });

  describe("ur < urOptimal", function () {
    it("Should return LAR and BAR", async function () {
      const urOptimal = BigNumber.from(barCalcParams.urOptimal);
      expect(await interestRateStrategy.calculateInterestRates(urOptimal.sub(1), reserveRate));
    });
  });

  describe("ur > urOptimal", function () {
    it("Should return LAR and BAR if ur = 1 and b1 < 0", async function () {
      expect(RAY).to.be.gt(BigNumber.from(barCalcParams.urOptimal));
      expect(await interestRateStrategy.calculateInterestRates(RAY, reserveRate));
    });

    it("Should revert if b1 < 0 and there is BAR overflow", async function () {
      const barCalcParams1 = { ...barCalcParams };
      barCalcParams1.urOptimal = "400000000000000000000000000"; // 0.40 in ray
      const ur1 = BigNumber.from("500000000000000000000000000"); // 0.50 in ray
      const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams1)]);
      await interestRateStrategy.setBarCalculationParams(paramsInBytes);
      expect(ur1).to.be.gt(barCalcParams1.urOptimal);
      expect(BigNumber.from(barCalcParams1.b1)).to.be.lt(BigNumber.from(0));
      await expect(interestRateStrategy.calculateInterestRates(ur1, reserveRate)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BAR_OVERFLOW",
      );
    });

    it("Should calculate LAR and BAR if b1 > 0", async function () {
      const barCalcParams1 = { ...barCalcParams };
      barCalcParams1.urOptimal = "400000000000000000000000000"; // 0.40 in ray
      barCalcParams1.b1 = "278571428570000000000000000000"; // 278.57142857 in ray

      const ur1 = BigNumber.from("500000000000000000000000000"); // 0.50 in ray
      const paramsInBytes = defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams1)]);
      await interestRateStrategy.setBarCalculationParams(paramsInBytes);
      expect(ur1).to.be.gt(BigNumber.from(barCalcParams1.urOptimal));
      expect(BigNumber.from(barCalcParams1.b1)).to.be.gt(BigNumber.from(0));
      expect(await interestRateStrategy.calculateInterestRates(ur1, reserveRate));
    });
  });
});
