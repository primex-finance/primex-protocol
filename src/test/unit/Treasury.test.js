// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    provider,
    getContract,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther },
  },
  deployments: { fixture },
} = require("hardhat");
const { deployMockAccessControl, deployMockERC20 } = require("../utils/waffleMocks");
const { parseArguments } = require("../utils/eventValidation");
const { NATIVE_CURRENCY, WAD } = require("../utils/constants");
const { BIG_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");

process.env.TEST = true;

describe("Treasury_unit", function () {
  let treasury, treasuryFactory;
  let mockRegistry, mockERC20;
  let tokenTransfersLibrary, errorsLibrary;
  let deployer, trader, caller;
  let spendingLimits, newSpendingLimits, maxAmountPerTransfer, maxPercentPerTransfer, minTimeBetweenTransfers;
  let timeframeDuration, maxAmountDuringTimeframe, maxTotalAmount;
  let snapshotId;

  before(async function () {
    // to hide OZ warnings
    await upgrades.silenceWarnings();

    await fixture(["Treasury", "Errors"]);
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    errorsLibrary = await getContract("Errors");

    ({ deployer, trader, caller } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    mockERC20 = await deployMockERC20(deployer);
    mockERC20.mock.decimals.returns(18);

    treasuryFactory = await getContractFactory("Treasury", {
      libraries: {
        TokenTransfersLibrary: tokenTransfersLibrary.address,
      },
    });
    treasury = await upgrades.deployProxy(treasuryFactory, [mockRegistry.address], {
      unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
    });
    await treasury.deployed();

    maxAmountPerTransfer = parseEther("1");
    maxPercentPerTransfer = parseEther("0.3");
    minTimeBetweenTransfers = 60 * 60 * 6; // 6 hours
    timeframeDuration = 60 * 60 * 24; // 1 day
    maxAmountDuringTimeframe = parseEther("2");
    maxTotalAmount = parseEther("10");
  });

  beforeEach(async function () {
    spendingLimits = {
      maxTotalAmount: maxTotalAmount,
      maxAmountPerTransfer: maxAmountPerTransfer,
      maxPercentPerTransfer: maxPercentPerTransfer,
      minTimeBetweenTransfers: minTimeBetweenTransfers,
      timeframeDuration: timeframeDuration,
      maxAmountDuringTimeframe: maxAmountDuringTimeframe,
    };

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

  describe("initialize", function () {
    it("Should deploy the Treasury contract if registry supports IAccessControl interface", async function () {
      expect(
        await upgrades.deployProxy(treasuryFactory, [mockRegistry.address], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      );
    });

    it("Should revert if registry does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(treasuryFactory, [mockRegistry.address], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("transferFromTreasury", function () {
    it("Should revert when function is on Pause", async function () {
      await treasury.pause();
      const amount = parseEther("1");
      await expect(treasury.connect(trader).transferFromTreasury(amount, mockERC20.address, trader.address)).to.be.revertedWith(
        "Pausable: paused",
      );
    });
    it("Should revert when transfer amount equal zero", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      const amount = parseEther("0");
      await expect(treasury.connect(trader).transferFromTreasury(amount, mockERC20.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "TRANSFER_RESTRICTIONS_NOT_MET",
      );
    });
    it("Should revert when transfer amount > maxAmountPerTransfer", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      const amount = parseEther("2");
      await expect(treasury.connect(trader).transferFromTreasury(amount, mockERC20.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "TRANSFER_RESTRICTIONS_NOT_MET",
      );
    });
    it("Should revert when minTimeBetweenTransfers is not reached", async function () {
      spendingLimits.lastWithdrawalTimestamp = (await provider.getBlock("latest")).timestamp;
      const amount = parseEther("1");
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      await expect(treasury.connect(trader).transferFromTreasury(amount, mockERC20.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "TRANSFER_RESTRICTIONS_NOT_MET",
      );
    });
    it("Should revert when amount > maxTotalAmount", async function () {
      spendingLimits.maxTotalAmount = parseEther("0.9");
      await treasury.setMaxSpendingLimit(deployer.address, mockERC20.address, spendingLimits);

      const amount = parseEther("1");
      await expect(
        treasury.connect(deployer).transferFromTreasury(amount, mockERC20.address, deployer.address),
      ).to.be.revertedWithCustomError(errorsLibrary, "TRANSFER_RESTRICTIONS_NOT_MET");
    });
    it("Should revert when amount of native token > balance on Treasury", async function () {
      const amount = parseEther("1");
      await treasury.setMaxSpendingLimit(trader.address, NATIVE_CURRENCY, spendingLimits);
      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      await expect(treasury.connect(trader).transferFromTreasury(amount, NATIVE_CURRENCY, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "INSUFFICIENT_NATIVE_TOKEN_BALANCE",
      );
    });
    it("Should revert when amount > balance on Treasury", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      const amount = parseEther("1");
      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");
      await expect(treasury.connect(trader).transferFromTreasury(amount, mockERC20.address, trader.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "INSUFFICIENT_TOKEN_BALANCE",
      );
    });
  });

  describe("setMaxSpendingLimit", function () {
    beforeEach(async function () {
      newSpendingLimits = {
        maxTotalAmount: parseEther("8"),
        maxAmountPerTransfer: parseEther("2"),
        maxPercentPerTransfer: parseEther("0.5"),
        minTimeBetweenTransfers: 60 * 60 * 12, // 12 hours,
        timeframeDuration: 60 * 60 * 48, // 1 day,
        maxAmountDuringTimeframe: parseEther("4"),
      };
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaxSpendingLimit", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(
        treasury.connect(caller).setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should revert if timeframeDuration is zero", async function () {
      newSpendingLimits.timeframeDuration = 0;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });
    it("Should revert if maxTotalAmount is zero", async function () {
      newSpendingLimits.maxTotalAmount = 0;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });
    it("Should revert if maxAmountPerTransfer is zero", async function () {
      newSpendingLimits.maxAmountPerTransfer = 0;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });
    it("Should revert if maxPercentPerTransfer is zero", async function () {
      newSpendingLimits.maxPercentPerTransfer = 0;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });
    it("Should revert if maxPercentPerTransfer is WAD", async function () {
      newSpendingLimits.maxPercentPerTransfer = WAD;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });

    it("Should revert if maxAmountDuringTimeframe is zero", async function () {
      newSpendingLimits.maxAmountDuringTimeframe = 0;
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDING_LIMITS_ARE_INCORRECT",
      );
    });

    it("Should set MaxSpendingLimit", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, newSpendingLimits);
      const spenderInfo = await treasury.spenders(trader.address, mockERC20.address);
      const expectedSpenderInfo = {
        isSpenderExist: true,
        limits: newSpendingLimits,
        lastWithdrawalTimestamp: await treasury.initialTimestamp(),
        withdrawnDuringTimeframe: 0,
      };
      parseArguments(spenderInfo, expectedSpenderInfo);
    });

    it("Should emit when setMaxSpendingLimit is successful", async function () {
      await expect(treasury.setMaxSpendingLimit(trader.address, mockERC20.address, Object.values(newSpendingLimits)))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });
  });

  describe("decreaseLimits", function () {
    beforeEach(async function () {
      newSpendingLimits = {
        maxTotalAmount: parseEther("5"),
        maxAmountPerTransfer: parseEther("0.5"),
        maxPercentPerTransfer: parseEther("0.05"),
        minTimeBetweenTransfers: 60 * 60 * 12, // 12 hours
        timeframeDuration: 60 * 60 * 48, // 2 days
        maxAmountDuringTimeframe: parseEther("1.9"),
      };
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call decreaseLimits", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(
        treasury.connect(caller).decreaseLimits(trader.address, mockERC20.address, newSpendingLimits),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should revert when newMaxTotalAmount > maxTotalAmount", async function () {
      newSpendingLimits.maxTotalAmount = parseEther("11");
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should emit MaxSpendingLimitChanged when newMaxTotalAmount is zero", async function () {
      newSpendingLimits.maxTotalAmount = 0;
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });
    it("Should revert when newMaxAmountPerTransfer > maxAmountPerTransfer", async function () {
      newSpendingLimits.maxAmountPerTransfer = parseEther("2");
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should emit MaxSpendingLimitChanged when newMaxAmountPerTransfer is zero", async function () {
      newSpendingLimits.maxAmountPerTransfer = 0;
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });
    it("Should revert when newMaxPercentPerTransfer > maxPercentPerTransfer", async function () {
      newSpendingLimits.maxPercentPerTransfer = parseEther("0.4");
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should emit MaxSpendingLimitChanged when newMaxPercentPerTransfer is zero", async function () {
      newSpendingLimits.maxPercentPerTransfer = 0;
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });
    it("Should revert when newMinTimeBetweenTransfers < minTimeBetweenTransfers", async function () {
      newSpendingLimits.minTimeBetweenTransfers = 60 * 60 * 5; // 5 hours
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should revert when newTimeframeDuration < timeframeDuration", async function () {
      newSpendingLimits.timeframeDuration = 60 * 60 * 11; // 11 hours
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should revert when newMaxAmountDuringTimeframe > maxAmountDuringTimeframe", async function () {
      newSpendingLimits.maxAmountDuringTimeframe = parseEther("2.1");
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "EXCEEDED_MAX_SPENDING_LIMITS",
      );
    });
    it("Should emit MaxSpendingLimitChanged when newMaxAmountDuringTimeframe is zero", async function () {
      newSpendingLimits.maxAmountDuringTimeframe = 0;
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });

    it("Should revert when the spender doesn't exist", async function () {
      await expect(treasury.decreaseLimits(caller.address, mockERC20.address, newSpendingLimits)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDER_IS_NOT_EXIST",
      );
    });

    it("Should set new spending Limits", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);

      await treasury.decreaseLimits(trader.address, mockERC20.address, newSpendingLimits);
      const spenderInfo = await treasury.spenders(trader.address, mockERC20.address);
      const expectedSpenderInfo = {
        isSpenderExist: true,
        limits: newSpendingLimits,
        lastWithdrawalTimestamp: await treasury.initialTimestamp(),
        withdrawnDuringTimeframe: 0,
      };

      parseArguments(spenderInfo, expectedSpenderInfo);
    });

    it("Should emit MaxSpendingLimitChanged when set new spending Limits", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      await expect(treasury.decreaseLimits(trader.address, mockERC20.address, Object.values(newSpendingLimits)))
        .to.emit(treasury, "MaxSpendingLimitChanged")
        .withArgs(trader.address, mockERC20.address, Object.values(newSpendingLimits));
    });
  });

  describe("canTransferByTime", function () {
    it("Should revert if spender is not valid", async function () {
      await expect(treasury.canTransferByTime(trader.address, mockERC20.address)).to.be.revertedWithCustomError(
        errorsLibrary,
        "SPENDER_IS_NOT_EXIST",
      );
    });
    it("Should return true when lastWithdrawalTimestamp + minTimeBetweenTransfers < current timestamp", async function () {
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);
      await network.provider.send("evm_increaseTime", [minTimeBetweenTransfers]);
      await network.provider.send("evm_mine");

      expect(await treasury.canTransferByTime(trader.address, mockERC20.address)).to.equal(true);
    });
    it("Should return false when lastWithdrawalTimestamp + minTimeBetweenTransfers >= current timestamp", async function () {
      spendingLimits.lastWithdrawalTimestamp = (await provider.getBlock("latest")).timestamp;
      await treasury.setMaxSpendingLimit(trader.address, mockERC20.address, spendingLimits);

      expect(await treasury.canTransferByTime(trader.address, mockERC20.address)).to.equal(false);
    });
  });

  describe("pause and unpause", function () {
    it("Should revert not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, caller.address).returns(false);
      await expect(treasury.connect(caller).pause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("pause can call only EMERGENCY_ADMIN", async function () {
      expect(await treasury.pause());
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(treasury.connect(caller).unpause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Only caller with SMALL_TIMELOCK_ADMIN role can set unpause", async function () {
      await treasury.connect(caller).pause();
      expect(await treasury.connect(caller).unpause());
    });
  });
});
