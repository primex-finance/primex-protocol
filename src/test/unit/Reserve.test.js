// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: {
    getSigners,
    getSigner,
    getContract,
    getContractFactory,
    constants: { AddressZero },
  },
  deployments: { fixture },
} = require("hardhat");
const { parseEther } = require("ethers/lib/utils");
const {
  deployMockBucket,
  deployMockPToken,
  deployMockDebtToken,
  deployBonusExecutor,
  deployMockPrimexDNS,
  deployMockAccessControl,
  deployMockERC20,
} = require("../utils/waffleMocks");
const { MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");
process.env.TEST = true;

describe("Reserve_unit", function () {
  let reserveContract;
  let reserveFactory;
  let mockPtoken, mockDebtToken, mockExecutor;
  let mockBucket;
  let mockPrimexDNS;
  let mockRegistry;
  let mockErc20;
  let deployer, executorSigner;
  let snapshotId;
  let ErrorsLibrary;

  before(async function () {
    await fixture(["Reserve", "Errors"]);
    [deployer] = await getSigners();
    mockPtoken = await deployMockPToken(deployer);
    mockDebtToken = await deployMockDebtToken(deployer);
    mockBucket = await deployMockBucket(deployer);
    mockExecutor = await deployBonusExecutor(deployer);
    mockRegistry = await deployMockAccessControl(deployer);
    mockErc20 = await deployMockERC20(deployer);
    ErrorsLibrary = await getContract("Errors");

    await mockBucket.mock.pToken.returns(mockPtoken.address);
    await mockBucket.mock.debtToken.returns(mockDebtToken.address);
    await mockBucket.mock.name.returns("bucket1");
    await mockDebtToken.mock.feeDecreaser.returns(mockExecutor.address);
    await mockPtoken.mock.interestIncreaser.returns(mockExecutor.address);
    await mockPtoken.mock.transfer.returns(true);

    await mockDebtToken.mock.feeDecreaser.returns(AddressZero);

    await network.provider.request({
      method: "hardhat_impersonateAccount",
      params: [mockExecutor.address],
    });

    await network.provider.send("hardhat_setBalance", [mockExecutor.address, parseEther("1000").toHexString()]);
    executorSigner = await getSigner(mockExecutor.address);

    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    await mockPrimexDNS.mock.buckets.returns(mockBucket.address, 1, 0, 0);

    reserveFactory = await getContractFactory("Reserve");
    reserveContract = await upgrades.deployProxy(reserveFactory, [mockPrimexDNS.address, mockRegistry.address], {
      unsafeAllow: ["constructor", "delegatecall"],
    });
    await reserveContract.deployed();
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
  describe("initialize", function () {
    it("Should revert initialize when the dns is not supported", async function () {
      await mockPrimexDNS.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(reserveFactory, [mockPrimexDNS.address, mockRegistry.address], {
          unsafeAllow: ["constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });
  describe("paybackPermanentLoss", function () {
    it("Should revert if Reserve contract is paused", async function () {
      await mockRegistry.mock.hasRole.returns(true);
      await reserveContract.pause();

      const paused = await reserveContract.paused();
      expect(paused).to.equal(true);

      await expect(reserveContract.paybackPermanentLoss(mockBucket.address)).to.be.revertedWith("Pausable: paused");
    });

    it("Should paybackPermanentLoss if bucket is active", async function () {
      await mockPrimexDNS.mock.buckets.returns(mockBucket.address, 1, 0, 0);

      await mockBucket.mock.permanentLoss.returns(parseEther("1"));
      await mockPtoken.mock.balanceOf.returns(parseEther("5"));
      expect(await reserveContract.paybackPermanentLoss(mockBucket.address));
    });

    it("Should paybackPermanentLoss if bucket is frozen", async function () {
      await mockPrimexDNS.mock.buckets.returns(mockBucket.address, 0, 0, 0);

      await mockBucket.mock.permanentLoss.returns(parseEther("1"));
      await mockPtoken.mock.balanceOf.returns(parseEther("5"));

      expect(await reserveContract.paybackPermanentLoss(mockBucket.address));
    });

    it("Should revert if bucket is not found in dnsBucket", async function () {
      await mockPrimexDNS.mock.buckets.returns(AddressZero, 0, 0, 0);

      await mockBucket.mock.permanentLoss.returns(parseEther("1"));
      await mockPtoken.mock.balanceOf.returns(parseEther("5"));

      await expect(reserveContract.paybackPermanentLoss(mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_PRIMEX_BUCKET",
      );
    });

    it("Should revert if amount to burn is zero", async function () {
      await mockBucket.mock.permanentLoss.returns(0);
      await mockPtoken.mock.balanceOf.returns(0);

      await expect(reserveContract.paybackPermanentLoss(mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BURN_AMOUNT_IS_ZERO",
      );
    });

    it("Should set (burnAmount == permanentLoss) if (permanentLoss < balance of Reserve contract)", async function () {
      const permanentLoss = parseEther("1");
      const balance = parseEther("5");
      await mockBucket.mock.permanentLoss.returns(permanentLoss);
      await mockPtoken.mock.balanceOf.returns(balance);

      await expect(reserveContract.paybackPermanentLoss(mockBucket.address))
        .to.emit(reserveContract, "BurnAmountCalculated")
        .withArgs(permanentLoss);
    });

    it("Should set (burnAmount == balance of Reserve contract) if (permanentLoss > balance of Reserve contract)", async function () {
      const permanentLoss = parseEther("6");
      const balance = parseEther("2");
      await mockBucket.mock.permanentLoss.returns(permanentLoss);
      await mockPtoken.mock.balanceOf.returns(balance);

      await expect(reserveContract.paybackPermanentLoss(mockBucket.address))
        .to.emit(reserveContract, "BurnAmountCalculated")
        .withArgs(balance);
    });
  });
  describe("payBonus", function () {
    it("Should revert when caller is not pToken or DebtToken", async function () {
      await expect(reserveContract.payBonus("bucket1", deployer.address, parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_EXECUTOR",
      );
    });
    it("Should payBonus when caller is feeDecreaser", async function () {
      expect(await reserveContract.connect(executorSigner).payBonus("bucket1", deployer.address, parseEther("1")));
    });
    it("Should payBonus when caller is interestIncreaser", async function () {
      await mockDebtToken.mock.feeDecreaser.returns(AddressZero);
      expect(await reserveContract.connect(executorSigner).payBonus("bucket1", deployer.address, parseEther("1")));
    });
  });
  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, deployer.address).returns(false);
      await expect(reserveContract.pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, deployer.address).returns(false);
      await expect(reserveContract.unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
  describe("transferToTreasury", function () {
    it("Should revert if Reserve contract is paused", async function () {
      await mockRegistry.mock.hasRole.returns(true);
      await reserveContract.pause();

      const paused = await reserveContract.paused();
      expect(paused).to.equal(true);

      await expect(reserveContract.transferToTreasury(mockBucket.address, parseEther("1"))).to.be.revertedWith("Pausable: paused");
    });

    it("Should revert if called by non MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);

      await expect(reserveContract.transferToTreasury(mockBucket.address, parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if the bucket is not launched", async function () {
      const LiquidityMiningParams = {
        liquidityMiningRewardDistributor: AddressZero,
        isBucketLaunched: false,
        accumulatingAmount: 0,
        deadlineTimestamp: 0,
        stabilizationDuration: 0,
        stabilizationEndTimestamp: 0,
        maxAmountPerUser: 0,
        maxDuration: 0,
        maxStabilizationEndTimestamp: 0,
      };
      await mockBucket.mock.getLiquidityMiningParams.returns(LiquidityMiningParams);
      await expect(reserveContract.transferToTreasury(mockBucket.address, parseEther("1"))).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_NOT_LAUNCHED",
      );
    });
  });

  describe("setTransferRestrictions", function () {
    it("Should revert if called by non MEDIUM_TIMELOCK_ADMIN", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(false);
      const transferRestrictions = {
        minAmountToBeLeft: parseEther("1"),
        minPercentOfTotalSupplyToBeLeft: parseEther("0.1"),
      };
      await expect(reserveContract.setTransferRestrictions(mockErc20.address, transferRestrictions)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should emit TransferRestrictionsChanged if set is successful", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, deployer.address).returns(true);
      const transferRestrictions = {
        minAmountToBeLeft: parseEther("1"),
        minPercentOfTotalSupplyToBeLeft: parseEther("0.1"),
      };
      await expect(reserveContract.setTransferRestrictions(mockErc20.address, transferRestrictions))
        .to.emit(reserveContract, "TransferRestrictionsChanged")
        .withArgs(mockErc20.address, Object.values(transferRestrictions));
    });
    it("Should revert when minPercentOfTotalSupplyToBeLeft is incorrect", async function () {
      const transferRestrictions = {
        minAmountToBeLeft: parseEther("1"),
        minPercentOfTotalSupplyToBeLeft: parseEther("1").add("1"),
      };
      await expect(reserveContract.setTransferRestrictions(mockErc20.address, transferRestrictions)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_TRANSFER_RESTRICTIONS",
      );
    });
  });
});
