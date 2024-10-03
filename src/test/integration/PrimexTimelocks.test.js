// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  ethers: {
    getSigners,
    provider,
    getContract,
    utils: { keccak256, defaultAbiCoder, parseEther },
    constants: { HashZero, MaxUint256 },
  },
  deployments: { fixture },
} = require("hardhat");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, GUARDIAN_ADMIN } = require("../../Constants");
const { FeeRateType } = require("../utils/constants");
const { encodeFunctionData } = require("../../tasks/utils/encodeFunctionData");
process.env.TEST = true;

describe("PrimexTimelocks_integration", function () {
  let positionManager, priceOracle, registry, guardian;
  let bigTimelock, mediumTimelock, smallTimelock;

  before(async function () {
    await fixture(["Test"]);
    [, guardian] = await getSigners();

    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    registry = await getContract("Registry");

    bigTimelock = await getContract("BigTimelockAdmin");
    mediumTimelock = await getContract("MediumTimelockAdmin");
    smallTimelock = await getContract("SmallTimelockAdmin");
  });

  it("GUARDIAN_ADMIN can cancel operations in each timelock", async function () {
    const newTolerableLimit = "1000";
    const { payload } = await encodeFunctionData("setDefaultOracleTolerableLimit", [newTolerableLimit], "PositionManagerExtension");
    const data = positionManager.interface.encodeFunctionData("setProtocolParamsByAdmin", [payload]);
    const delay = await bigTimelock.getMinDelay();

    const args = [positionManager.address, 0, data, HashZero, HashZero, delay];
    await bigTimelock.schedule(...args);
    await mediumTimelock.schedule(...args);
    await smallTimelock.schedule(...args);
    args.pop();

    const hashOperation = keccak256(defaultAbiCoder.encode(["address", "uint256", "bytes", "bytes32", "bytes32"], args));

    await registry.grantRole(GUARDIAN_ADMIN, guardian.address);

    await bigTimelock.connect(guardian).cancel(hashOperation);
    await mediumTimelock.connect(guardian).cancel(hashOperation);
    await smallTimelock.connect(guardian).cancel(hashOperation);
  });
  it("scheduleBatch and executeBatch are working", async function () {
    const treasury = await getContract("Treasury");
    const reserve = await getContract("Reserve");
    await treasury.pause();
    await reserve.pause();

    const data = smallTimelock.interface.encodeFunctionData("unpause");
    const delay = await smallTimelock.getMinDelay();

    const targets = [treasury.address, reserve.address];
    const values = [0, 0];
    const payloads = [data, data];

    const args = [targets, values, payloads, HashZero, HashZero, delay];
    await smallTimelock.scheduleBatch(...args);

    const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
    await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

    args.pop();
    await smallTimelock.executeBatch(...args);

    expect(await treasury.paused()).to.equal(false);
    expect(await reserve.paused()).to.equal(false);
  });

  describe("BigTimelockAdmin", function () {
    it("BigTimelockAdmin has BIG_TIMELOCK_ADMIN", async function () {
      expect(await registry.hasRole(BIG_TIMELOCK_ADMIN, bigTimelock.address)).to.equal(true);
    });

    it("BigTimelockAdmin can call admin method", async function () {
      const primexDNS = await getContract("PrimexDNS");

      const feeRateType = FeeRateType.SpotPositionClosedByTrader;
      const feeRate = parseEther("0.01");
      const data = primexDNS.interface.encodeFunctionData("setProtocolFeeRate", [[feeRateType, feeRate]]);
      const delay = await bigTimelock.getMinDelay();

      const args = [primexDNS.address, 0, data, HashZero, MaxUint256, delay];
      await bigTimelock.schedule(...args);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

      // delay is not in execute function
      args.pop();
      await bigTimelock.execute(...args);

      expect(await primexDNS.protocolFeeRates(feeRateType)).to.equal(feeRate);
    });
  });

  describe("MediumTimelockAdmin", function () {
    it("MediumTimelockAdmin has MEDIUM_TIMELOCK", async function () {
      expect(await registry.hasRole(MEDIUM_TIMELOCK_ADMIN, mediumTimelock.address)).to.equal(true);
    });

    it("MediumTimelockAdmin can call method with MEDIUM_TIMELOCK_ADMIN", async function () {
      const newDefaultOracleTolerableLimit = "1000";
      const { payload } = await encodeFunctionData(
        "setDefaultOracleTolerableLimit",
        [newDefaultOracleTolerableLimit],
        "PositionManagerExtension",
      );
      const data = positionManager.interface.encodeFunctionData("setProtocolParamsByAdmin", [payload]);
      const delay = await mediumTimelock.getMinDelay();

      const args = [positionManager.address, 0, data, HashZero, MaxUint256, delay];
      await mediumTimelock.schedule(...args);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

      // delay is not in execute function
      args.pop();
      await mediumTimelock.execute(...args);

      expect(await positionManager.defaultOracleTolerableLimit()).to.equal(newDefaultOracleTolerableLimit);
    });
  });

  describe("SmallTimelockAdmin", function () {
    it("SmallTimelockAdmin has SMALL_TIMELOCK_ADMIN", async function () {
      expect(await registry.hasRole(SMALL_TIMELOCK_ADMIN, smallTimelock.address)).to.equal(true);
    });

    it("SmallTimelockAdmin can call method with SMALL_TIMELOCK_ADMIN", async function () {
      // setPairPriceDrop(address _assetA, address _assetB, uint256 _pairPriceDrop)
      const token0 = await getContract("TestTokenA");
      const token1 = await getContract("TestTokenB");

      const newPairPriceDrop = "1000";
      const data = priceOracle.interface.encodeFunctionData("setPairPriceDrop", [token0.address, token1.address, newPairPriceDrop]);
      const delay = await smallTimelock.getMinDelay();

      const args = [priceOracle.address, 0, data, HashZero, MaxUint256, delay];
      await smallTimelock.schedule(...args);

      const nextTimestamp = delay.add((await provider.getBlock("latest")).timestamp);
      await network.provider.send("evm_setNextBlockTimestamp", [nextTimestamp.toNumber()]);

      // delay is not in execute function
      args.pop();
      await smallTimelock.execute(...args);

      expect(await priceOracle.pairPriceDrops(token0.address, token1.address)).to.equal(newPairPriceDrop);
    });
  });
});
