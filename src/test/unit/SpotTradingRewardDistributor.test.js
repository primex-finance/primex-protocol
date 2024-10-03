// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  network,
  upgrades,
  ethers: { BigNumber, provider, getNamedSigners, getContract, getContractFactory },
  deployments: { fixture },
} = require("hardhat");
const { parseEther } = require("ethers/lib/utils");
const {
  deployMockERC20,
  deployMockPriceOracle,
  deployMockAccessControl,
  deployMockTraderBalanceVault,
  deployMockPMXToken,
  deployMockTreasury,
} = require("../utils/waffleMocks");
const { USD_MULTIPLIER } = require("../utils/constants");
const { wadMul } = require("../utils/bnMath");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, EMERGENCY_ADMIN, SMALL_TIMELOCK_ADMIN } = require("../../Constants");

process.env.TEST = true;

describe("SpotTradingRewardDistributor_unit", function () {
  let spotTradingRewardDistributor, spotTradingRewardDistributorFactory;
  let mockRegistry, mockPriceOracle, mockPMX, mockERC20, mockTraderBalanceVault, mockTreasury;
  let primexPricingLibrary, errorsLibrary;
  let deployer, trader, caller;
  let args, periodDuration;
  let snapshotId;

  let positionAmount, totalReward, traderActivity, undistributedPMX, moreThanAvailable;

  before(async function () {
    // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
    await upgrades.silenceWarnings();

    await fixture(["PrimexPricingLibrary", "Errors"]);
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    errorsLibrary = await getContract("Errors");

    ({ deployer, trader, caller } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    let defaultExhangeRate;
    [mockPriceOracle, defaultExhangeRate] = await deployMockPriceOracle(deployer);
    mockPMX = await deployMockPMXToken(deployer);
    mockERC20 = await deployMockERC20(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    mockTreasury = await deployMockTreasury(deployer);

    periodDuration = 60 * 60 * 24; // 1 day
    args = [
      mockRegistry.address,
      periodDuration,
      mockPriceOracle.address,
      mockPMX.address,
      mockTraderBalanceVault.address,
      mockTreasury.address,
    ];

    spotTradingRewardDistributorFactory = await getContractFactory("SpotTradingRewardDistributor", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    spotTradingRewardDistributor = await upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
      unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
    });
    await spotTradingRewardDistributor.deployed();

    positionAmount = parseEther("1");
    totalReward = parseEther("5");

    const multiplier = BigNumber.from("10").pow(18 - (await mockERC20.decimals()));
    traderActivity = BigNumber.from(wadMul(positionAmount.mul(multiplier).toString(), defaultExhangeRate.toString()).toString()).div(
      USD_MULTIPLIER,
    );

    undistributedPMX = parseEther("15");
    await spotTradingRewardDistributor.connect(caller).topUpUndistributedPmxBalance(undistributedPMX);
    await spotTradingRewardDistributor.connect(caller).setRewardPerPeriod(totalReward);

    moreThanAvailable = undistributedPMX.add(1);

    await mockRegistry.mock.hasRole.returns(true);
    await mockTraderBalanceVault.mock.topUpAvailableBalance.returns();
  });

  beforeEach(async function () {
    args = [mockRegistry.address, 1, mockPriceOracle.address, mockPMX.address, mockTraderBalanceVault.address, mockTreasury.address];
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
    it("Should deploy", async function () {
      expect(
        await upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      );
    });
    it("Should revert initialize when the registry is not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the periodDuration is zero", async function () {
      args[1] = 0;
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "PERIOD_DURATION_IS_ZERO");
    });
    it("Should revert initialize when the priceOracle is not supported", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      args[2] = mockPriceOracle.address;
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the traderBalanceVault is not supported", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      args[4] = mockTraderBalanceVault.address;
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert initialize when the PMX address is not supported", async function () {
      await mockPMX.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert initialize when the Treasury address is not supported", async function () {
      await mockTreasury.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(spotTradingRewardDistributorFactory, [...args], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(errorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("topUpUndistributedPmxBalance", function () {
    it("Should emit when top up is successful", async function () {
      const amount = parseEther("1.5");
      await expect(spotTradingRewardDistributor.connect(caller).topUpUndistributedPmxBalance(amount))
        .to.emit(spotTradingRewardDistributor, "TopUpUndistributedPmxBalance")
        .withArgs(amount);
    });
  });

  describe("updateTraderActivity", function () {
    it("Should revert if caller is not granted with PM_ROLE", async function () {
      await mockRegistry.mock.hasRole.returns(false);

      await expect(
        spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0),
      ).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });

    it("Should allow to update trader activity if caller is granted with PM_ROLE", async function () {
      expect(await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0));
    });

    it("Should not set trader activity and total activity if rewardPerPeriod is zero", async function () {
      await spotTradingRewardDistributor.connect(caller).setRewardPerPeriod(0);
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0);

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      const period = await spotTradingRewardDistributor.periods(0);
      expect(spotTraderActivity).to.equal(0);
      expect(period.totalActivity).to.equal(0);
    });

    it("Should not set trader activity and total activity if rewardPerPeriod > undistributedPMX", async function () {
      await spotTradingRewardDistributor.connect(caller).setRewardPerPeriod(moreThanAvailable);
      expect(await spotTradingRewardDistributor.rewardPerPeriod()).to.equal(moreThanAvailable);

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0);

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      const period = await spotTradingRewardDistributor.periods(0);
      expect(spotTraderActivity).to.equal(0);
      expect(period.totalActivity).to.equal(0);
    });

    it("Should not set trader activity and total activity if not sufficient undistributedPMX top-up", async function () {
      await spotTradingRewardDistributor.connect(caller).setRewardPerPeriod(moreThanAvailable);
      expect(await spotTradingRewardDistributor.rewardPerPeriod()).to.equal(moreThanAvailable);

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0);

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      const period = await spotTradingRewardDistributor.periods(0);
      expect(spotTraderActivity).to.equal(0);
      expect(period.totalActivity).to.equal(0);
    });

    it("Should set trader activity and total activity if rewardPerPeriod <= undistributedPMX", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0);

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      const period = await spotTradingRewardDistributor.periods(0);
      expect(spotTraderActivity).to.equal(traderActivity);
      expect(period.totalActivity).to.equal(traderActivity);
    });

    it("Should add a period number to periodsWithTraderActivity array and should not duplicate period numbers", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period

      const periodsWithTraderActivity = await spotTradingRewardDistributor.getPeriodsWithTraderActivity(trader.address);

      expect(periodsWithTraderActivity.length).to.equal(2);
      expect(periodsWithTraderActivity[0]).to.equal(0);
      expect(periodsWithTraderActivity[1]).to.equal(4);
    });

    it("Should not set totalReward for the period if there is not enough undistributedPMX on a contract balance", async function () {
      await spotTradingRewardDistributor.withdrawPmx(undistributedPMX.sub(totalReward));
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval
      expect(await spotTradingRewardDistributor.undistributedPMX()).to.equal(0);

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period
      const period = await spotTradingRewardDistributor.periods(4);
      expect(period.totalReward).to.equal(0);
    });

    it("Should update trader activity if it was in the same period", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period

      const periodsWithTraderActivity = await spotTradingRewardDistributor.getPeriodsWithTraderActivity(trader.address);

      expect(periodsWithTraderActivity.length).to.equal(1);
      expect(periodsWithTraderActivity[0]).to.equal(0);

      // check activity
      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      const period = await spotTradingRewardDistributor.periods(0);
      expect(spotTraderActivity).to.equal(traderActivity.mul(3));
      expect(period.totalActivity).to.equal(traderActivity.mul(3));
    });
  });

  describe("claimReward", function () {
    it("Should emit SpotTradingClaimReward event if claim is successful", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period

      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      const reward = totalReward.mul(positionAmount).div(positionAmount);

      await expect(spotTradingRewardDistributor.connect(trader).claimReward())
        .to.emit(spotTradingRewardDistributor, "SpotTradingClaimReward")
        .withArgs(trader.address, reward);
    });

    it("Should revert if a trader does not have any activity", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period

      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      await spotTradingRewardDistributor.connect(trader).claimReward();
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      await expect(spotTradingRewardDistributor.connect(trader).claimReward()).to.be.revertedWithCustomError(
        errorsLibrary,
        "REWARD_AMOUNT_IS_ZERO",
      );
    });

    it("Should emit SpotTradingClaimReward event if claim is successful from several periods", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      const reward0period = totalReward.mul(positionAmount).div(positionAmount);
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period
      const reward4period = totalReward.mul(positionAmount).div(positionAmount);
      await network.provider.send("hardhat_mine", ["0x96", "0xE10"]); // 150 blocks with 1 hour interval

      const reward = reward0period.add(reward4period);

      await expect(spotTradingRewardDistributor.connect(trader).claimReward())
        .to.emit(spotTradingRewardDistributor, "SpotTradingClaimReward")
        .withArgs(trader.address, reward);
    });
    it("Should revert if spotTradingRewardDistributor is paused", async function () {
      await spotTradingRewardDistributor.pause();
      await expect(spotTradingRewardDistributor.connect(trader).claimReward()).to.be.revertedWith("Pausable: paused");
    });
    it("Should not remove period number from trader's periodsWithTraderActivity if it is equal to the current period number", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period

      await spotTradingRewardDistributor.connect(trader).claimReward();
      const periodsWithTraderActivity = await spotTradingRewardDistributor.getPeriodsWithTraderActivity(trader.address);

      expect(periodsWithTraderActivity.length).to.equal(1);
      expect(periodsWithTraderActivity[0]).to.equal(4);
    });

    it("Should remove all period numbers from trader's periodsWithTraderActivity if no activity during the current period", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period
      await network.provider.send("hardhat_mine", ["0x64", "0xE10"]); // 100 blocks with 1 hour interval

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 4 period
      await network.provider.send("hardhat_mine", ["0x96", "0xE10"]); // 150 blocks with 1 hour interval

      await spotTradingRewardDistributor.connect(trader).claimReward();
      const periodsWithTraderActivity = await spotTradingRewardDistributor.getPeriodsWithTraderActivity(trader.address);

      expect(periodsWithTraderActivity.length).to.equal(0);
    });
    it("Should revert if amount of reward is zero", async function () {
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period

      await expect(spotTradingRewardDistributor.connect(trader).claimReward()).to.be.revertedWithCustomError(
        errorsLibrary,
        "REWARD_AMOUNT_IS_ZERO",
      );
    });
  });

  describe("setRewardPerPeriod", function () {
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setRewardPerPeriod", async function () {
      await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(spotTradingRewardDistributor.connect(caller).setRewardPerPeriod(parseEther("5"))).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should set reward", async function () {
      const oldReward = await spotTradingRewardDistributor.rewardPerPeriod();
      const reward = parseEther("5");
      await spotTradingRewardDistributor.setRewardPerPeriod(reward.mul(2));
      const newReward = await spotTradingRewardDistributor.rewardPerPeriod();

      expect(newReward).to.not.equal(oldReward);
      expect(newReward).to.equal(reward.mul(2));
    });

    it("Should emit RewardPerPeriodChanged when set is successful", async function () {
      const reward = parseEther("10");
      await expect(spotTradingRewardDistributor.setRewardPerPeriod(reward))
        .to.emit(spotTradingRewardDistributor, "RewardPerPeriodChanged")
        .withArgs(reward);
    });
  });
  describe("decreaseRewardPerPeriod", function () {
    it("Should revert if not EMERGENCY_ADMIN call decreaseRewardPerPeriod", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, caller.address).returns(false);
      await expect(spotTradingRewardDistributor.connect(caller).decreaseRewardPerPeriod(1)).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if the current rewardPerPeriod is less than the passed one", async function () {
      await spotTradingRewardDistributor.setRewardPerPeriod(1);
      await expect(spotTradingRewardDistributor.decreaseRewardPerPeriod(2)).to.be.revertedWithCustomError(
        errorsLibrary,
        "REWARD_PER_PERIOD_IS_NOT_CORRECT",
      );
    });
    it("Should successfully set reward per period", async function () {
      await spotTradingRewardDistributor.decreaseRewardPerPeriod(1);
      expect(await spotTradingRewardDistributor.rewardPerPeriod()).to.equal(1);
    });

    it("Should emit RewardPerPeriodDecreased when successfully set reward per period", async function () {
      const rewardPerPeriod = 1;
      await expect(spotTradingRewardDistributor.decreaseRewardPerPeriod(rewardPerPeriod))
        .to.emit(spotTradingRewardDistributor, "RewardPerPeriodDecreased")
        .withArgs(rewardPerPeriod);
    });
  });
  describe("getSpotTraderActivity", function () {
    it("Should get spot trader activity", async function () {
      const reward = parseEther("5");
      await spotTradingRewardDistributor.setRewardPerPeriod(reward);
      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0); // 0 period

      const spotTraderActivity = await spotTradingRewardDistributor.getSpotTraderActivity(0, trader.address);
      expect(spotTraderActivity).to.equal(traderActivity);
    });
  });

  describe("getPeriodInfo", function () {
    it("Should get information for the corresponding period when totalReward is 0", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;

      const reward = parseEther("5");
      await spotTradingRewardDistributor.setRewardPerPeriod(reward);

      const [totalReward, totalActivity] = await spotTradingRewardDistributor.getPeriodInfo(timestamp);
      expect(totalReward).to.equal(reward);
      expect(totalActivity).to.equal(0);
    });

    it("Should get information for the corresponding period", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;
      const reward = parseEther("5");
      await spotTradingRewardDistributor.setRewardPerPeriod(reward);

      await spotTradingRewardDistributor.connect(caller).updateTraderActivity(trader.address, mockERC20.address, positionAmount, 0);

      const [totalReward, totalActivity] = await spotTradingRewardDistributor.getPeriodInfo(timestamp);
      expect(totalReward).to.equal(reward);
      expect(totalActivity).to.equal(traderActivity);
    });
    it("Should return totalReward = 0 if rewardPerPeriod is not set", async function () {
      const timestamp = (await provider.getBlock("latest")).timestamp;

      await spotTradingRewardDistributor.setRewardPerPeriod(0);

      const [totalReward, totalActivity] = await spotTradingRewardDistributor.getPeriodInfo(timestamp);
      expect(totalReward).to.equal(0);
      expect(totalActivity).to.equal(0);
    });
  });

  describe("withdrawPmx", function () {
    it("Should revert if not BIG_TIMELOCK_ADMIN call withdrawPmx", async function () {
      await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, caller.address).returns(false);

      await expect(spotTradingRewardDistributor.connect(caller).withdrawPmx(parseEther("13"))).to.be.revertedWithCustomError(
        errorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert while attempt to withdraw more than undistributedPMX", async function () {
      const amountToWithdraw = undistributedPMX.mul(2);
      await expect(spotTradingRewardDistributor.withdrawPmx(amountToWithdraw)).to.be.revertedWithCustomError(
        errorsLibrary,
        "AMOUNT_EXCEEDS_AVAILABLE_BALANCE",
      );
    });

    it("Should emit PmxWithdrawn when withdraw is successful", async function () {
      await expect(spotTradingRewardDistributor.withdrawPmx(undistributedPMX))
        .to.emit(spotTradingRewardDistributor, "PmxWithdrawn")
        .withArgs(undistributedPMX);
    });
  });

  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, caller.address).returns(false);
      await expect(spotTradingRewardDistributor.connect(caller).pause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, caller.address).returns(false);
      await expect(spotTradingRewardDistributor.connect(caller).unpause()).to.be.revertedWithCustomError(errorsLibrary, "FORBIDDEN");
    });
  });
});
