// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  upgrades,
  network,
  ethers: {
    BigNumber,
    provider,
    getContractFactory,
    getContract,
    getSigners,
    utils: { parseEther },
    constants: { AddressZero, MaxUint256, Zero },
  },

  deployments: { fixture },
} = require("hardhat");
const { BigNumber: BN } = require("bignumber.js");
const { parseArguments } = require("../utils/eventValidation");

process.env.TEST = true;

const { rayMul, rayDiv, calculateCompoundInterest, wadMul, calculateLinearInterest, calculateBar } = require("../utils/math");
const { WAD, RAY } = require("../utils/constants");
const { getImpersonateSigner } = require("../utils/hardhatUtils");
const {
  deployMockBucket,
  deployBonusNft,
  deployMockPToken,
  deployMockDebtToken,
  deployMockReserve,
  deployMockAccessControl,
  deployMockPrimexDNS,
  deployMockWhiteBlackList,
} = require("../utils/waffleMocks");
const { barCalcParams } = require("../utils/defaultBarCalcParams");
const { BIG_TIMELOCK_ADMIN, MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN } = require("../../Constants");

const reserveRate = "100000000000000000"; // 0.1 - 10%
const HOUR = BigNumber.from("3600");

describe("BonusExecutor_unit", function () {
  let deployer, user, user2, user3, user4;
  let InterestIncreaser, FeeDecreaser, InterestIncreaserFactory, FeeDecreaserFactory, ErrorsLibrary;
  let mockBonusNft, mockBucket, mockPToken, mockDebtToken, mockReserve, mockRegistry, mockPrimexDNS, mockWhiteBlackList;
  let tier, percent, maxAmount, deadline;
  let LAR, BAR, normalizedIncome, normalizedDebt, lastUpdatedBlock, lastUpdatedTimestamp;
  let bonusNftSigner, pTokenSigner, debtTokenSigner;
  let tiers, bonuses;
  const nftId = 0;

  function getApproxValue(deadline, lowestTimestamp, highestTimestamp, lowestIndex, highestIndex) {
    const multiplier = rayDiv(deadline.sub(lowestTimestamp).toString(), highestTimestamp.sub(lowestTimestamp).toString()).toString();
    const multipliable = highestIndex.sub(lowestIndex).toString();
    return lowestIndex.add(rayMul(multipliable, multiplier).toString());
  }

  before(async function () {
    await fixture(["Test"]);

    await upgrades.silenceWarnings();

    [deployer, user, user2, user3, user4] = await getSigners();
    InterestIncreaserFactory = await getContractFactory("InterestIncreaser");
    FeeDecreaserFactory = await getContractFactory("FeeDecreaser");
    ErrorsLibrary = await getContract("Errors");
    mockBonusNft = await deployBonusNft(deployer);
    mockBucket = await deployMockBucket(deployer);
    mockPToken = await deployMockPToken(deployer);
    mockDebtToken = await deployMockDebtToken(deployer);
    mockReserve = await deployMockReserve(deployer);
    mockRegistry = await deployMockAccessControl(deployer);
    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

    const bucketName = "bucket1";
    await mockPrimexDNS.mock.getBucketAddress.withArgs(bucketName).returns(mockBucket.address);

    await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, user.address).returns(false);
    await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, user2.address).returns(false);
    await mockRegistry.mock.hasRole.withArgs(BIG_TIMELOCK_ADMIN, user3.address).returns(false);
    await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, user4.address).returns(false);

    await mockBonusNft.mock.supportsInterface.returns(true);
    await mockBonusNft.mock.registry.returns(mockRegistry.address);
    await mockBonusNft.mock.getNft
      .withArgs(nftId)
      .returns({ bucket: mockBucket.address, bonusTypeId: 0, tier: 0, activatedBy: AddressZero, uri: "" });

    await mockBucket.mock.pToken.returns(mockPToken.address);
    await mockBucket.mock.debtToken.returns(mockDebtToken.address);
    await mockBucket.mock.reserve.returns(mockReserve.address);
    await mockBucket.mock.name.returns(bucketName);
    await mockReserve.mock.payBonus.returns();
    InterestIncreaser = await upgrades.deployProxy(
      InterestIncreaserFactory,
      [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
      { unsafeAllow: ["constructor", "delegatecall"] },
    );
    FeeDecreaser = await upgrades.deployProxy(
      FeeDecreaserFactory,
      [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
      { unsafeAllow: ["constructor", "delegatecall"] },
    );
    await InterestIncreaser.setMaxBonusCount(mockBucket.address, 2);
    await FeeDecreaser.setMaxBonusCount(mockBucket.address, 2);

    percent = parseEther("0.1");
    maxAmount = parseEther("1");
    deadline = 60 * 60 * 24 * 7; // week

    tiers = [0, 1, 2, 3, 4];
    bonuses = [
      { percent: percent, maxAmount: maxAmount, duration: deadline },
      { percent: percent, maxAmount: BigNumber.from(5), duration: deadline },
      { percent: percent, maxAmount: BigNumber.from(1000), duration: deadline },
      { percent: percent, maxAmount: maxAmount, duration: 0 },
      { percent: percent, maxAmount: 0, duration: deadline },
    ];
    await InterestIncreaser.setTierBonus(mockBucket.address, tiers, bonuses);
    await FeeDecreaser.setTierBonus(mockBucket.address, tiers, bonuses);

    const deposit = parseEther("100");
    const borrow = parseEther("5");
    const uRatio = rayDiv(borrow.toString(), deposit.toString());

    BAR = calculateBar(uRatio, barCalcParams);
    LAR = wadMul(rayMul(BAR, uRatio), new BN(WAD).minus(reserveRate));
    lastUpdatedBlock = await provider.getBlockNumber();
    lastUpdatedTimestamp = (await provider.getBlock("latest")).timestamp;
    normalizedIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, lastUpdatedTimestamp + 1)
      .dp(0, 1)
      .toString();
    normalizedDebt = calculateCompoundInterest(BAR, lastUpdatedTimestamp, lastUpdatedTimestamp + 1)
      .dp(0, 1)
      .toString();
    lastUpdatedBlock = lastUpdatedBlock + 1;
    lastUpdatedTimestamp = lastUpdatedTimestamp + 1;
    await mockBucket.mock.getNormalizedIncome.returns(normalizedIncome);
    await mockBucket.mock.getNormalizedVariableDebt.returns(normalizedDebt);

    bonusNftSigner = await getImpersonateSigner(mockBonusNft);
    pTokenSigner = await getImpersonateSigner(mockPToken);
    debtTokenSigner = await getImpersonateSigner(mockDebtToken);
  });

  describe("searchNearestIndex", function () {
    let NearestSearchMock;
    let randomTimestamps;
    const indexes = [];
    let currentIndex;
    async function generateTimeStamps(qty) {
      const HOUR = BigNumber.from("3600");
      const array = [];
      const timeStamp = (await provider.getBlock("latest")).timestamp;
      array[0] = BigNumber.from(timeStamp);
      for (let i = 1; i < qty; i++) {
        const value = array[i - 1].add(HOUR).add(Math.floor(Math.random() * (100 - 1) + 1));
        array.push(value);
      }
      return array;
    }

    before(async function () {
      const nearestSearchMockFactory = await getContractFactory("MockNearestSearch");
      NearestSearchMock = await upgrades.deployProxy(
        nearestSearchMockFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      await NearestSearchMock.deployed();

      randomTimestamps = await generateTimeStamps(20);
      indexes[0] = BigNumber.from(RAY.toString());
      for (let i = 1; i < randomTimestamps.length; i++) {
        indexes[i] = BigNumber.from(indexes[i - 1]).add(parseEther("0.1"));
      }
      await NearestSearchMock.setIndexes(randomTimestamps, indexes, mockBucket.address);
      currentIndex = indexes[indexes.length - 1].add(parseEther("1"));
    });

    it("Should return correct value when the bonusDeadline is one of the randomTimestamps", async function () {
      const bonusDeadline = randomTimestamps[5];
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        randomTimestamps,
        currentIndex,
        mockBucket.address,
      );
      expect(await NearestSearchMock.indexes(mockBucket.address, bonusDeadline)).to.be.equal(foundIndex);
    });
    it("Should return correct value when the bonusDeadline is the first timestamp of the randomTimestamps", async function () {
      const bonusDeadline = randomTimestamps[0];
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        randomTimestamps,
        currentIndex,
        mockBucket.address,
      );
      expect(await NearestSearchMock.indexes(mockBucket.address, bonusDeadline)).to.be.equal(foundIndex);
    });
    it("Should return correct value when the bonusDeadline is the last timestamp of the randomTimestamps", async function () {
      const bonusDeadline = randomTimestamps[randomTimestamps.length - 1];
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        randomTimestamps,
        currentIndex,
        mockBucket.address,
      );
      expect(await NearestSearchMock.indexes(mockBucket.address, bonusDeadline)).to.be.equal(foundIndex);
    });
    it("Should return correct value when the randomTimestamps contains only one element which equal to the bonusDeadline", async function () {
      const bonusDeadline = randomTimestamps[0];
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        [bonusDeadline],
        currentIndex,
        mockBucket.address,
      );
      expect(await NearestSearchMock.indexes(mockBucket.address, bonusDeadline)).to.be.equal(foundIndex);
    });
    it("Should return correct value when the randomTimestamps contains only one element which less than the bonusDeadline", async function () {
      const bonusDeadline = randomTimestamps[0].add("50");
      const lowestIndex = await NearestSearchMock.indexes(mockBucket.address, randomTimestamps[0]);
      const currentIndex = await NearestSearchMock.indexes(mockBucket.address, randomTimestamps[3]);

      await provider.send("evm_increaseTime", [100]);
      const timeStamp = (await provider.getBlock("latest")).timestamp;

      const approxValue = getApproxValue(bonusDeadline, randomTimestamps[0], BigNumber.from(timeStamp), lowestIndex, currentIndex);
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        [randomTimestamps[0]],
        currentIndex,
        mockBucket.address,
      );
      expect(approxValue).to.be.equal(foundIndex);
    });
    it("Should return correct value when the bonusDeadline does not match any timestamp of the array", async function () {
      // add 600 seconds to the random timestamp
      const bonusDeadline = randomTimestamps[10].add("600");
      const foundIndex = await NearestSearchMock.callStatic.searchNearestIndex(
        bonusDeadline,
        randomTimestamps,
        currentIndex,
        mockBucket.address,
      );
      // the bonusDeadline will be between the lowestTimestamp and the lowestTimestamp
      const lowestTimestamp = randomTimestamps[10];
      const highestTimestamp = randomTimestamps[11];
      const lowestIndex = await NearestSearchMock.indexes(mockBucket.address, lowestTimestamp);
      const highestIndex = await NearestSearchMock.indexes(mockBucket.address, highestTimestamp);
      const expectIndex = getApproxValue(bonusDeadline, lowestTimestamp, highestTimestamp, lowestIndex, highestIndex);
      expect(expectIndex).to.be.gt(lowestIndex);
      expect(expectIndex).to.be.lt(highestIndex);
      expect(expectIndex).to.be.equal(foundIndex);
    });
  });
  describe("InterestIncreaser", function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      tier = 0;
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should update the indexes via activateBonus when length of the updatedTimestamps is equal to zero", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await expect(InterestIncreaser.updatedTimestamps(mockBucket.address, 0)).to.be.reverted;
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      expect(await InterestIncreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(timestamp);
    });
    it("Should update the indexes via activateBonus when last value of the updatedTimestamps plus 1 HOUR is less than the current timestamp", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      expect(await InterestIncreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(timestamp);
      await provider.send("evm_increaseTime", [HOUR.toNumber() + 1]);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        0,
        mockBucket.address,
        BigNumber.from(normalizedIncome).add("100"),
      );
      const secondTimestamp = (await provider.getBlock("latest")).timestamp;
      expect(await InterestIncreaser.updatedTimestamps(mockBucket.address, 1)).to.be.equal(secondTimestamp);
    });
    it("Should not update the indexes via activateBonus when length of the updatedTimestamps isn't equal to zero and last value of the updatedTimestamps plus 1 HOUR is greater than the current timestamp", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      await provider.send("evm_increaseTime", [HOUR.toNumber() - 10]);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        0,
        mockBucket.address,
        BigNumber.from(normalizedIncome).add("100"),
      );
      await expect(InterestIncreaser.updatedTimestamps(mockBucket.address, 1)).to.be.reverted;
    });
    it("Should revert if not BIG_TIMELOCK_ADMIN call setTierBonus", async function () {
      const InterestIncreaser = await upgrades.deployProxy(
        InterestIncreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      await expect(InterestIncreaser.connect(user3).setTierBonus(mockBucket.address, tiers, bonuses)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert setTierBonus when bonuses length isn't equal tiers length", async function () {
      const badTiers = [...tiers];
      badTiers.pop();
      await expect(InterestIncreaser.setTierBonus(mockBucket.address, badTiers, bonuses)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WRONG_LENGTH",
      );
    });
    it("Should revert setTierBonus when one of the bonus percent is zero", async function () {
      const badBonuses = [{ ...bonuses[0] }];
      badBonuses[badBonuses.length - 1].percent = Zero;

      await expect(InterestIncreaser.setTierBonus(mockBucket.address, [tiers[0]], badBonuses)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BONUS_PERCENT_IS_ZERO",
      );
    });
    it("setTierBonus should correct update state", async function () {
      const InterestIncreaser = await upgrades.deployProxy(
        InterestIncreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      const updateBonuses = [...bonuses];
      // updateBonuses[-1] and updateBonuses[-2] duration and amount is 0
      for (let i = 0; i < updateBonuses.length - 2; i++) {
        updateBonuses[i].percent = updateBonuses[i].percent.sub(100);
        updateBonuses[i].maxAmount = updateBonuses[i].maxAmount.sub(2);
        updateBonuses[i].duration = updateBonuses[i].duration - 3;
      }

      await InterestIncreaser.setTierBonus(mockBucket.address, tiers, updateBonuses);
      const bonusesFromContract = [];
      for (let i = 0; i < updateBonuses.length; i++) {
        bonusesFromContract.push(await InterestIncreaser.tierBonus(mockBucket.address, i));
      }

      parseArguments(updateBonuses, bonusesFromContract);
    });
    it("Should revert activateBonus for not initialize in bonus executor bucket", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      const InterestIncreaser = await upgrades.deployProxy(
        InterestIncreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      await InterestIncreaser.setMaxBonusCount(mockBucket.address, 2);
      await expect(
        InterestIncreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TIER_IS_NOT_ACTIVE");
    });
    it("Should revert if the nft contract does not support IPMXBonusNFT interface", async function () {
      await mockBonusNft.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          InterestIncreaserFactory,
          [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if the registry does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          InterestIncreaserFactory,
          [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert activate when caller is not the NFT contract", async function () {
      await expect(InterestIncreaser.activateBonus(0, tier, mockBucket.address, deployer.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_NFT",
      );
    });
    it("Should revert when the bonus is already activated", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      await expect(
        InterestIncreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_FOR_BUCKET_ALREADY_ACTIVATED");
    });
    it("Should activate bonus and return the correct metadata", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);

      const timestamp = (await provider.getBlock("latest")).timestamp;
      const expectActivatedBonus = [
        BigNumber.from(nftId),
        mockBucket.address,
        percent,
        maxAmount,
        BigNumber.from(0),
        BigNumber.from(normalizedIncome),
        BigNumber.from(timestamp).add(deadline).add(1),
        BigNumber.from(0),
      ];
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const activatedBonus = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(activatedBonus).to.deep.equal(expectActivatedBonus);
    });

    it("Should activate bonus with duration 0 and return correct metadata", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);

      const expectActivatedBonus = [
        BigNumber.from(nftId),
        mockBucket.address,
        percent,
        maxAmount,
        BigNumber.from(0),
        BigNumber.from(normalizedIncome),
        BigNumber.from(0),
        BigNumber.from(0),
      ];
      const tier = 3;
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const activatedBonus = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(activatedBonus).to.deep.equal(expectActivatedBonus);
    });

    it("Should revert update bonus when the contract is paused", async function () {
      await InterestIncreaser.pause();
      await expect(InterestIncreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert update bonus when the bucket is equal to zero", async function () {
      await expect(InterestIncreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BONUS_DOES_NOT_EXIST",
      );
    });
    it("Should revert update bonus  when the nftId does not match the passed one", async function () {
      const nftIdForUser = BigNumber.from("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftIdForUser).returns(user.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftIdForUser, tier, mockBucket.address, deployer.address);
      await expect(InterestIncreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BONUS_DOES_NOT_EXIST",
      );
    });
    it("Should revert updateBonus when the caller is not the pToken contract", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      await expect(
        InterestIncreaser["updateBonus(address,uint256,address,uint256)"](
          deployer.address,
          parseEther("100"),
          mockBucket.address,
          normalizedIncome,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_P_TOKEN");
    });

    it("Should updateBonus", async function () {
      const balance = parseEther("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );
      const a = wadMul(percent.toString(), balance.toString()).toString();
      const b = rayMul(a, BN(currentIncome).minus(normalizedIncome)).toString();
      const { accumulatedAmount, lastUpdatedIndex } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(b);
      expect(lastUpdatedIndex).to.be.equal(currentIncome);

      // check index
    });
    it("Should revert when the bucket is equal to zero and not ptoken call updateBonus", async function () {
      const balance = parseEther("1");
      await expect(
        InterestIncreaser["updateBonus(address,uint256,address,uint256)"](user.address, balance, mockBucket.address, normalizedIncome),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_P_TOKEN");
    });
    it("Should update historical timestamp and index, but not updateBonus when the bucket is equal to zero", async function () {
      const balance = parseEther("1");
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        user.address,
        balance,
        mockBucket.address,
        normalizedIncome,
      );
      const blockTimestamp = (await provider.getBlock("latest")).timestamp;
      expect((await InterestIncreaser.getBonus(user.address, nftId)).lastUpdatedIndex).to.be.equal(0);
      expect(await InterestIncreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(blockTimestamp);
      expect(await InterestIncreaser.indexes(mockBucket.address, blockTimestamp)).to.be.equal(normalizedIncome);
    });
    it("Should not updateBonus when the contract is paused", async function () {
      const balance = parseEther("1");
      await InterestIncreaser.pause();
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        user.address,
        balance,
        mockBucket.address,
        normalizedIncome,
      );
      expect((await InterestIncreaser.getBonus(user.address, nftId)).lastUpdatedIndex).to.be.equal(0);
    });
    it("Should not updateBonus when the accumulatedAmount is equal to the maxAmount", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      const maxAmount = 5; // 5 wei

      tier = 1;
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      // here the accumulatedAmount will be equal to the maxAmount
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );
      const { accumulatedAmount, lastUpdatedIndex } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(maxAmount);
      // to make sure that lastUpdatedIndex has not been updated
      const newCurrentIncome = BigNumber.from(currentIncome).add(100);
      await mockBucket.mock.getNormalizedIncome.returns(newCurrentIncome);
      // try to update the bonus again
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentIncome,
      );
      // the bonus is not updated
      expect((await InterestIncreaser.getBonus(deployer.address, nftId)).lastUpdatedIndex).to.be.equal(lastUpdatedIndex);
    });
    it("Should updateBonus via the searchApproxIndex when the deadline is less than current timestamp", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await InterestIncreaser.getBonus(deployer.address, nftId);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline]);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );
      const {
        accumulatedAmount,
        lastUpdatedIndex,
        deadline: deadlineInContract,
      } = await InterestIncreaser.getBonus(deployer.address, nftId);
      const lowestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 0);
      const highestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 1);
      const lowestIndex = await InterestIncreaser.indexes(mockBucket.address, lowestTS);
      const highestIndex = await InterestIncreaser.indexes(mockBucket.address, highestTS);
      const approx = getApproxValue(activatedDeadline, lowestTS, highestTS, lowestIndex, highestIndex);
      // the bonus is not updated
      expect(accumulatedAmount).to.be.gt(0);
      expect(lastUpdatedIndex).to.be.equal(approx);
      expect(deadlineInContract).to.be.equal(MaxUint256);
    });
    it("Should not updateBonus when the deadline is less than current timestamp and the bonus has already been updated via the searchApproxIndex", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline]);
      // last upd via the searchApproxIndex
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );
      const { lastUpdatedIndex: approxIndex } = await InterestIncreaser.getBonus(deployer.address, nftId);
      // second try
      const newCurrentIncome = BigNumber.from(currentIncome).add("100");
      await mockBucket.mock.getNormalizedIncome.returns(newCurrentIncome);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentIncome,
      );
      // the lastUpdatedIndex is still equal to the previous index
      const { lastUpdatedIndex } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(lastUpdatedIndex).to.be.equal(approxIndex);
    });
    it("Should revert claim when the amount is zero", async function () {
      await expect(InterestIncreaser.claim(nftId, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });
    it("Should revert claim when the bucket is equal to zero", async function () {
      await expect(InterestIncreaser.connect(user).claim(100, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_DOES_NOT_EXIST");
    });
    it("Should revert the claim when the contract is paused", async function () {
      await InterestIncreaser.pause();
      await expect(InterestIncreaser.claim(0, nftId)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert claim when the nftId does not match the passed one", async function () {
      const nftIdForUser = BigNumber.from("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftIdForUser).returns(user.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftIdForUser, tier, mockBucket.address, deployer.address);
      await expect(InterestIncreaser.connect(user).claim(100, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_DOES_NOT_EXIST");
    });
    it("Should not update the bonus when the accumulatedAmount is equal to the claimedAmount", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(BigNumber.from(currentIncome).add(100));
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );

      const { accumulatedAmount } = await InterestIncreaser.getBonus(deployer.address, nftId);
      // first claim
      await InterestIncreaser.claim(accumulatedAmount, nftId);
      const { claimedAmount } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(claimedAmount, nftId);
      const bonusBeforeSecondWithdraw = await InterestIncreaser.getBonus(deployer.address, nftId);
      // second claim
      await InterestIncreaser.claim("100", nftId);
      // no changes
      expect(bonusBeforeSecondWithdraw).to.deep.equal(await InterestIncreaser.getBonus(deployer.address, nftId));
    });
    it("Should claim and delete the bonus when the deadline is equal to the magic number and claimedAmount is equal to accumulatedAmount", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = lastUpdatedTimestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      const newCurrentIncone = BigNumber.from(currentIncome).add(100);
      await mockBucket.mock.getNormalizedIncome.returns(newCurrentIncone);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentIncone,
      );
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline + 1]);
      // upd via the searchApproxIndex
      await mockBucket.mock.getNormalizedIncome.returns(newCurrentIncone.add(parseEther("10")).add("300"));
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentIncone.add(parseEther("10")).add("300"),
      );
      const { accumulatedAmount } = await InterestIncreaser.getBonus(deployer.address, nftId);
      await InterestIncreaser.claim(accumulatedAmount, nftId);
      const { bucket } = await InterestIncreaser.getBonus(deployer.address, nftId);
      // the bonus has been deleted
      expect(bucket).to.be.equal(AddressZero);
    });
    it("Should claim and update the bonus when the deadline is less than the current timestamp", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      // activate
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline, lastUpdatedIndex: lastUpdatedIndex1 } = await InterestIncreaser.getBonus(
        deployer.address,
        nftId,
      );

      let txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp + 1000]);

      const currentIndex1 = calculateLinearInterest(LAR, txBlockTimestamp, txBlockTimestamp + 1000)
        .dp(0, 1)
        .toString();
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIndex1,
      );
      txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      const multiplierForIncrementCalc = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAfterUpdate = rayMul(multiplierForIncrementCalc, BN(currentIndex1.toString()).minus(lastUpdatedIndex1.toString()));

      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline + 100]);
      await provider.send("evm_mine");
      const newTimestmap = (await provider.getBlock("latest")).timestamp;
      const secondCurrentIncome = calculateLinearInterest(LAR, txBlockTimestamp, newTimestmap).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(secondCurrentIncome);
      const lowestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 0);
      const higherTS = (await provider.getBlock("latest")).timestamp + 100;

      let currentIndex2 = getApproxValue(
        activatedDeadline,
        lowestTS,
        BigNumber.from(higherTS),
        lastUpdatedIndex1,
        BigNumber.from(secondCurrentIncome),
      );
      const { lastUpdatedIndex: lastUpdatedIndex2 } = await InterestIncreaser.getBonus(deployer.address, nftId);

      await mockBucket.mock.getNormalizedIncome.returns(secondCurrentIncome);
      if (currentIndex2.lte(lastUpdatedIndex2)) {
        currentIndex2 = lastUpdatedIndex2; // bonus.accumulatedAmount will not change in this case because bonusIncrement will be zero
      }
      const accumulatedAfterWithdraw = rayMul(
        multiplierForIncrementCalc,
        BN(currentIndex2.toString()).minus(lastUpdatedIndex2.toString()),
      ).toString();
      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await InterestIncreaser.claim(1, nftId);
      expect(await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(
        accumulatedAfterUpdate.plus(accumulatedAfterWithdraw),
      );
    });
    it("Should claim and not update the bonus when the deadline is less than the current timestamp and the approx index < lastUpdatedIndex", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      // activate
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline, lastUpdatedIndex: lastUpdatedIndex1 } = await InterestIncreaser.getBonus(
        deployer.address,
        nftId,
      );

      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);

      const currentIndex1 = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIndex1,
      );
      const multiplierForIncrementCalc = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAfterUpdate = rayMul(multiplierForIncrementCalc, BN(currentIndex1.toString()).minus(lastUpdatedIndex1.toString()));

      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline + 100]);
      const secondCurrentIncome = BigNumber.from(currentIndex1).add(parseEther("10")).add("300");
      await mockBucket.mock.getNormalizedIncome.returns(secondCurrentIncome);
      const lowestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 0);
      const higherTS = (await provider.getBlock("latest")).timestamp + 100;

      const approxIndex = getApproxValue(activatedDeadline, lowestTS, BigNumber.from(higherTS), lastUpdatedIndex1, secondCurrentIncome);

      // make sure that approxIndex < bonus.lastUpdatedIndex
      expect(approxIndex.lte(currentIndex1)).to.equal(true);

      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await InterestIncreaser.claim(1, nftId);

      expect(await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAfterUpdate);
    });
    it("Should claim and update the bonus", async function () {
      const claimAmount = "1000";
      await mockPToken.mock.transferFrom.returns(true);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      await InterestIncreaser.claim(claimAmount, nftId);
      const { lastUpdatedIndex, claimedAmount } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(lastUpdatedIndex).to.be.equal(currentIncome);
      expect(claimedAmount).to.be.equal(claimAmount);
    });
    it("Should claim and delete the bonus when maxAmount is equal to the claimedAmount", async function () {
      const maxAmount = BigNumber.from("1000"); // wei

      tier = 2;

      await mockPToken.mock.transferFrom.returns(true);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(currentIncome);
      await InterestIncreaser.claim(maxAmount.add("10"), nftId);
      const { bucket } = await InterestIncreaser.getBonus(deployer.address, nftId);
      expect(bucket).to.be.equal(AddressZero);
    });
    it("Should getAvailableAmount return 0 when bucket is equal to zero", async function () {
      expect(await InterestIncreaser.getAvailableAmount(user.address, nftId)).to.be.equal(0);
    });
    it("Should getAvailableAmount return correct accumulatedAmount when the deadline is less than current timestamp", async function () {
      const balance = parseEther("1");

      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      const newNormalizedIncome = BigNumber.from(normalizedIncome).add(parseEther("3"));
      await mockBucket.mock.getNormalizedIncome.returns(newNormalizedIncome);

      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await InterestIncreaser.getBonus(deployer.address, nftId);
      await mockBucket.mock.getNormalizedIncome.returns(newNormalizedIncome);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newNormalizedIncome,
      );
      // deadline < current timestamp
      const lowestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 0);
      const lowestIndex = await InterestIncreaser.indexes(mockBucket.address, lowestTS);
      // await provider.send("evm_increaseTime", [deadline]);
      const higherTS = (await provider.getBlock("latest")).timestamp + deadline + 2;
      const approx = getApproxValue(
        activatedDeadline,
        lowestTS,
        BigNumber.from(higherTS),
        lowestIndex,
        BigNumber.from(normalizedIncome).add(parseEther("5")),
      );
      const multiplier = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAmount = rayMul(multiplier, BN(approx.toString()).minus(lowestIndex.toString())).toString();
      await mockBucket.mock.getNormalizedIncome.returns(BigNumber.from(normalizedIncome).add(parseEther("5")));
      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await network.provider.send("evm_mine");
      expect(await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAmount);
    });
    it("Should getAvailableAmount return correct accumulatedAmount when the deadline is equal to the max of uint256", async function () {
      const balance = parseEther("1");

      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      const firstNormalizedIncome = BigNumber.from(normalizedIncome).add(parseEther("3"));
      await mockBucket.mock.getNormalizedIncome.returns(firstNormalizedIncome);

      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await InterestIncreaser.getBonus(deployer.address, nftId);
      await mockBucket.mock.getNormalizedIncome.returns(firstNormalizedIncome);
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        firstNormalizedIncome,
      );
      // deadline < current timestamp
      const secondNormalizedIncome = firstNormalizedIncome.add(parseEther("2"));
      const lowestTS = await InterestIncreaser.updatedTimestamps(mockBucket.address, 0);
      const lowestIndex = await InterestIncreaser.indexes(mockBucket.address, lowestTS);
      await provider.send("evm_increaseTime", [deadline]);
      const highestTimestamp = BigNumber.from((await provider.getBlock("latest")).timestamp + deadline + 1);
      const approx = getApproxValue(activatedDeadline, lowestTS, highestTimestamp.add(1), lowestIndex, secondNormalizedIncome);
      await provider.send("evm_setNextBlockTimestamp", [highestTimestamp.toNumber()]);
      const multiplier = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAmount = rayMul(multiplier, BN(approx.toString()).minus(lowestIndex.toString())).toString();
      await mockBucket.mock.getNormalizedIncome.returns(secondNormalizedIncome);
      // last update
      await InterestIncreaser.connect(pTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        secondNormalizedIncome,
      );
      const thirdNormalizedIncome = secondNormalizedIncome.add(parseEther("2"));
      await mockBucket.mock.getNormalizedIncome.returns(thirdNormalizedIncome);
      // the index has been change but accumulated amount remains the same
      expect(await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAmount);
    });
    it("Should getAvailableAmount return correct amount", async function () {
      const claimAmount = "1000";
      await mockPToken.mock.transferFrom.returns(true);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      await mockBucket.mock.getNormalizedIncome.returns(BigNumber.from(normalizedIncome).add(parseEther("3")));
      await InterestIncreaser.claim(claimAmount, nftId);
      const accumulatedAmount = await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId);
      expect(await InterestIncreaser.getAvailableAmount(deployer.address, nftId)).to.be.equal(accumulatedAmount.sub(claimAmount));
    });
    it("Should getAvailableAmount return correct amount when the maxAmount is equal to zero", async function () {
      const claimAmount = "1000";
      tier = 4;
      await mockPToken.mock.transferFrom.returns(true);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      await mockBucket.mock.getNormalizedIncome.returns(BigNumber.from(normalizedIncome).add(parseEther("3")));
      await InterestIncreaser.claim(claimAmount, nftId);
      const accumulatedAmount = await InterestIncreaser.getAccumulatedAmount(deployer.address, nftId);
      expect(await InterestIncreaser.getAvailableAmount(deployer.address, nftId)).to.be.equal(accumulatedAmount.sub(claimAmount));
    });
    it("Should revert deactivateBonus when caller is not the NFT contract", async function () {
      await expect(InterestIncreaser.deactivateBonus(deployer.address, mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_NFT",
      );
    });
    it("Should deactivateBonus", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      expect((await InterestIncreaser.getBonus(deployer.address, nftId)).bucket).to.be.equal(mockBucket.address);
      await InterestIncreaser.connect(bonusNftSigner).deactivateBonus(deployer.address, mockBucket.address);
      expect((await InterestIncreaser.getBonus(deployer.address, nftId)).bucket).to.be.equal(AddressZero);
    });
    it("Should revert the if not EMERGENCY_ADMIN call pause", async function () {
      await expect(InterestIncreaser.connect(user).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert the if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(InterestIncreaser.connect(user4).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
  describe("FeeDecreaser", function () {
    let snapshotId;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      tier = 0;
    });

    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should update the indexes via activateBonus when length of the updatedTimestamps is equal to zero", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await expect(FeeDecreaser.updatedTimestamps(mockBucket.address, 0)).to.be.reverted;
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      expect(await FeeDecreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(timestamp);
    });
    it("Should update the indexes via activateBonus when last value of the updatedTimestamps plus 1 HOUR is less than the current timestamp", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const timestamp = (await provider.getBlock("latest")).timestamp;
      expect(await FeeDecreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(timestamp);
      await provider.send("evm_increaseTime", [HOUR.toNumber() + 1]);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        0,
        mockBucket.address,
        BigNumber.from(normalizedDebt).add("100"),
      );
      const secondTimestamp = (await provider.getBlock("latest")).timestamp;
      expect(await FeeDecreaser.updatedTimestamps(mockBucket.address, 1)).to.be.equal(secondTimestamp);
    });
    it("Should not update the indexes via activateBonus when length of the updatedTimestamps isn't equal to zero and last value of the updatedTimestamps plus 1 HOUR is greater than the current timestamp", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      await provider.send("evm_increaseTime", [HOUR.toNumber() - 10]);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        0,
        mockBucket.address,
        BigNumber.from(normalizedDebt).add("100"),
      );
      await expect(FeeDecreaser.updatedTimestamps(mockBucket.address, 1)).to.be.reverted;
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setTierBonus", async function () {
      const FeeDecreaser = await upgrades.deployProxy(
        FeeDecreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      await expect(FeeDecreaser.connect(user3).setTierBonus(mockBucket.address, tiers, bonuses)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert setTierBonus when bonuses length isn't equal tiers length", async function () {
      const badTiers = [...tiers];
      badTiers.pop();
      await expect(FeeDecreaser.setTierBonus(mockBucket.address, badTiers, bonuses)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "WRONG_LENGTH",
      );
    });
    it("setTierBonus should correct update state", async function () {
      const FeeDecreaser = await upgrades.deployProxy(
        FeeDecreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      const updateBonuses = [...bonuses];
      for (let i = 0; i < updateBonuses.length - 2; i++) {
        updateBonuses[i].percent = updateBonuses[i].percent.sub(100);
        updateBonuses[i].maxAmount = updateBonuses[i].maxAmount.sub(2);
        updateBonuses[i].duration = updateBonuses[i].duration - 3;
      }

      await FeeDecreaser.setTierBonus(mockBucket.address, tiers, updateBonuses);
      const bonusesFromContract = [];
      for (let i = 0; i < updateBonuses.length; i++) {
        bonusesFromContract.push(await FeeDecreaser.tierBonus(mockBucket.address, i));
      }

      parseArguments(updateBonuses, bonusesFromContract);
    });
    it("Should revert activateBonus for not initialize in bonus executor bucket", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      const FeeDecreaser = await upgrades.deployProxy(
        FeeDecreaserFactory,
        [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
        { unsafeAllow: ["constructor", "delegatecall"] },
      );
      await FeeDecreaser.setMaxBonusCount(mockBucket.address, 2);
      await expect(
        FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "TIER_IS_NOT_ACTIVE");
    });
    it("Should revert if the nft contract does not support IPMXBonusNFT interface", async function () {
      await mockBonusNft.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          FeeDecreaserFactory,
          [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if registry does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(
          FeeDecreaserFactory,
          [mockBonusNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address],
          {
            unsafeAllow: ["constructor", "delegatecall"],
          },
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert activate when caller is not the NFT contract", async function () {
      await expect(FeeDecreaser.activateBonus(0, tier, mockBucket.address, deployer.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_NFT",
      );
    });
    it("Should revert when the bonus is already activated", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      await expect(
        FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_FOR_BUCKET_ALREADY_ACTIVATED");
    });
    it("Should activate bonus and return the correct metadata", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);

      const timestamp = (await provider.getBlock("latest")).timestamp;
      const expectActivatedBonus = [
        BigNumber.from(nftId),
        mockBucket.address,
        percent,
        maxAmount,
        BigNumber.from(0),
        BigNumber.from(normalizedDebt),
        BigNumber.from(timestamp).add(deadline).add(1),
        BigNumber.from(0),
      ];
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      const activatedBonus = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(activatedBonus).to.deep.equal(expectActivatedBonus);
    });
    it("Should revert update bonus when the contract is paused", async function () {
      await FeeDecreaser.pause();
      await expect(FeeDecreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert update bonus when the bucket is equal to zero", async function () {
      await expect(FeeDecreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BONUS_DOES_NOT_EXIST",
      );
    });
    it("Should revert update bonus  when the nftId does not match the passed one", async function () {
      const nftIdForUser = BigNumber.from("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftIdForUser).returns(user.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftIdForUser, tier, mockBucket.address, deployer.address);
      await expect(FeeDecreaser.connect(user)["updateBonus(uint256)"](nftId)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BONUS_DOES_NOT_EXIST",
      );
    });

    it("Should revert updateBonus when the caller is not the debtToken contract", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      await expect(
        FeeDecreaser["updateBonus(address,uint256,address,uint256)"](
          deployer.address,
          parseEther("100"),
          mockBucket.address,
          normalizedDebt,
        ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_DEBT_TOKEN");
    });
    it("Should updateBonus", async function () {
      const balance = parseEther("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp + deadline - 2]);
      await network.provider.send("evm_mine");
      const currentDebt = calculateCompoundInterest(BAR, txBlockTimestamp, (await provider.getBlock("latest")).timestamp)
        .dp(0, 1)
        .toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentDebt);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentDebt,
      );
      const a = wadMul(percent.toString(), balance.toString()).toString();
      const b = rayMul(a, BN(currentDebt).minus(normalizedDebt)).toString();
      const { accumulatedAmount, lastUpdatedIndex } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(b);
      expect(lastUpdatedIndex).to.be.equal(currentDebt);
    });
    it("Should revert when the bucket is equal to zero and not ptoken call updateBonus", async function () {
      const balance = parseEther("1");
      await expect(
        FeeDecreaser["updateBonus(address,uint256,address,uint256)"](user.address, balance, mockBucket.address, normalizedDebt),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_DEBT_TOKEN");
    });

    it("Should update historical timestamp and index, but not updateBonus when the bucket is equal to zero", async function () {
      const balance = parseEther("1");
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        user.address,
        balance,
        mockBucket.address,
        normalizedDebt,
      );
      const blockTimestamp = (await provider.getBlock("latest")).timestamp;
      expect((await FeeDecreaser.getBonus(user.address, nftId)).lastUpdatedIndex).to.be.equal(0);
      expect(await FeeDecreaser.updatedTimestamps(mockBucket.address, 0)).to.be.equal(blockTimestamp);
      expect(await FeeDecreaser.indexes(mockBucket.address, blockTimestamp)).to.be.equal(normalizedDebt);
    });
    it("Should not updateBonus when the contract is paused", async function () {
      const balance = parseEther("1");
      await FeeDecreaser.pause();
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        user.address,
        balance,
        mockBucket.address,
        normalizedDebt,
      );
      expect((await FeeDecreaser.getBonus(user.address, nftId)).lastUpdatedIndex).to.be.equal(0);
    });
    it("Should not updateBonus when the accumulatedAmount is equal to the maxAmount", async function () {
      const balance = parseEther("1");
      const maxAmount = 5;
      tier = 1;
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentDebt = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentDebt);
      // here the accumulatedAmount will be equal to the maxAmount
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentDebt,
      );
      const { accumulatedAmount, lastUpdatedIndex } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(maxAmount);
      const newCurrentDebt = BigNumber.from(currentDebt).add(100);
      // to make sure that lastUpdatedIndex has not been updated
      await mockBucket.mock.getNormalizedVariableDebt.returns(newCurrentDebt);
      // try to update the bonus again
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentDebt,
      );
      // the bonus is not updated
      expect((await FeeDecreaser.getBonus(deployer.address, nftId)).lastUpdatedIndex).to.be.equal(lastUpdatedIndex);
    });
    it("Should updateBonus via the searchApproxIndex when the deadline is less than current timestamp", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await FeeDecreaser.getBonus(deployer.address, nftId);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentIncome);
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline]);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIncome,
      );
      const { accumulatedAmount, lastUpdatedIndex, deadline: deadlineInContract } = await FeeDecreaser.getBonus(deployer.address, nftId);
      const lowestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 0);
      const highestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 1);
      const lowestIndex = await FeeDecreaser.indexes(mockBucket.address, lowestTS);
      const highestIndex = await FeeDecreaser.indexes(mockBucket.address, highestTS);
      const approx = getApproxValue(activatedDeadline, lowestTS, highestTS, lowestIndex, highestIndex);
      // the bonus is not updated
      expect(accumulatedAmount).to.be.gt(0);
      expect(lastUpdatedIndex).to.be.equal(approx);
      expect(deadlineInContract).to.be.equal(MaxUint256);
    });
    it("Should not updateBonus when the deadline is less than current timestamp and the bonus has already been updated via the searchApproxIndex", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentDebt = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentDebt);
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline]);
      // last upd via the searchApproxIndex
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentDebt,
      );
      const { lastUpdatedIndex: approxIndex } = await FeeDecreaser.getBonus(deployer.address, nftId);
      // second try
      const newCurrentDebt = BigNumber.from(currentDebt).add("100");
      await mockBucket.mock.getNormalizedVariableDebt.returns(newCurrentDebt);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentDebt,
      );
      // the lastUpdatedIndex is still equal to the previous index
      const { lastUpdatedIndex } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(lastUpdatedIndex).to.be.equal(approxIndex);
    });
    it("Should revert FeeDecreaser when the amount is zero", async function () {
      await expect(FeeDecreaser.claim(0, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_0");
    });
    it("Should revert claim when the bucket is equal to zero", async function () {
      await expect(FeeDecreaser.connect(user).claim(100, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_DOES_NOT_EXIST");
    });
    it("Should revert the claim when the contract is paused", async function () {
      await FeeDecreaser.pause();
      await expect(FeeDecreaser.claim(0, nftId)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert claim when the nftId does not match the passed one", async function () {
      const nftIdForUser = BigNumber.from("1");
      await mockBonusNft.mock.ownerOf.withArgs(nftIdForUser).returns(user.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftIdForUser, tier, mockBucket.address, deployer.address);
      await expect(FeeDecreaser.connect(user).claim(100, nftId)).to.be.revertedWithCustomError(ErrorsLibrary, "BONUS_DOES_NOT_EXIST");
    });
    it("Should not update the bonus when the accumulatedAmount is equal to the claimedAmount", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      const newCurrentIncome = BigNumber.from(currentIncome).add(100);
      await mockBucket.mock.getNormalizedVariableDebt.returns(newCurrentIncome);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newCurrentIncome,
      );

      const { accumulatedAmount } = await FeeDecreaser.getBonus(deployer.address, nftId);
      // first claim
      await FeeDecreaser.claim(accumulatedAmount, nftId);
      const { claimedAmount } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(accumulatedAmount).to.be.equal(claimedAmount);
      const bonusBeforeSecondWithdraw = await FeeDecreaser.getBonus(deployer.address, nftId);
      // second claim
      await FeeDecreaser.claim("100", nftId);
      // no changes
      expect(bonusBeforeSecondWithdraw).to.deep.equal(await FeeDecreaser.getBonus(deployer.address, nftId));
    });
    it("Should claim and delete the bonus when the deadline is equal to the magic number and claimedAmount is equal to accumulatedAmount", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      let txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp + 1000]);
      await network.provider.send("evm_mine");

      const currentDebt = calculateCompoundInterest(BAR, txBlockTimestamp, (await provider.getBlock("latest")).timestamp)
        .dp(0, 1)
        .toString();
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentDebt,
      );
      txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline + 1]);
      await network.provider.send("evm_mine");

      // upd via the searchApproxIndex
      const currentDebt2 = calculateCompoundInterest(BAR, txBlockTimestamp, (await provider.getBlock("latest")).timestamp)
        .dp(0, 1)
        .toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentDebt2);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentDebt2,
      );
      const { accumulatedAmount } = await FeeDecreaser.getBonus(deployer.address, nftId);
      await FeeDecreaser.claim(accumulatedAmount, nftId);
      const { bucket } = await FeeDecreaser.getBonus(deployer.address, nftId);
      // the bonus has been deleted
      expect(bucket).to.be.equal(AddressZero);
    });
    it("Should claim and update the bonus when the deadline is less than the current timestamp", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      // activate
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline, lastUpdatedIndex: lastUpdatedIndex1 } = await FeeDecreaser.getBonus(deployer.address, nftId);

      let txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp + 1000]);

      const currentIndex1 = calculateCompoundInterest(BAR, txBlockTimestamp, txBlockTimestamp + 1000)
        .dp(0, 1)
        .toString();
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIndex1,
      );
      const multiplierForIncrementCalc = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAfterUpdate = rayMul(multiplierForIncrementCalc, BN(currentIndex1.toString()).minus(lastUpdatedIndex1.toString()));

      // deadline < current timestamp
      txBlockTimestamp = (await provider.getBlock("latest")).timestamp;
      await provider.send("evm_increaseTime", [deadline + 100]);
      await network.provider.send("evm_mine");

      const secondCurrentDebt = calculateCompoundInterest(BAR, txBlockTimestamp, (await provider.getBlock("latest")).timestamp)
        .dp(0, 1)
        .toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(secondCurrentDebt);
      const lowestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 0);
      const higherTS = (await provider.getBlock("latest")).timestamp + 100;

      let currentIndex2 = getApproxValue(
        activatedDeadline,
        lowestTS,
        BigNumber.from(higherTS),
        lastUpdatedIndex1,
        BigNumber.from(secondCurrentDebt),
      );
      const { lastUpdatedIndex: lastUpdatedIndex2 } = await FeeDecreaser.getBonus(deployer.address, nftId);

      await mockBucket.mock.getNormalizedVariableDebt.returns(secondCurrentDebt);
      if (currentIndex2.lte(lastUpdatedIndex2)) {
        currentIndex2 = lastUpdatedIndex2; // bonus.accumulatedAmount will not change in this case because bonusIncrement will be zero
      }

      const accumulatedAfterWithdraw = rayMul(
        multiplierForIncrementCalc,
        BN(currentIndex2.toString()).minus(lastUpdatedIndex2.toString()),
      ).toString();
      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await FeeDecreaser.claim(1, nftId);

      expect(await FeeDecreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(
        accumulatedAfterUpdate.plus(accumulatedAfterWithdraw),
      );
    });
    it("Should claim and not update the bonus when the deadline is less than the current timestamp and the approx index < lastUpdatedIndex", async function () {
      const balance = parseEther("1");
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      // activate
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline, lastUpdatedIndex: lastUpdatedIndex1 } = await FeeDecreaser.getBonus(deployer.address, nftId);

      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);

      const currentIndex1 = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        currentIndex1,
      );
      const multiplierForIncrementCalc = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAfterUpdate = rayMul(multiplierForIncrementCalc, BN(currentIndex1.toString()).minus(lastUpdatedIndex1.toString()));

      // deadline < current timestamp
      await provider.send("evm_increaseTime", [deadline + 100]);
      const secondCurrentIncome = BigNumber.from(currentIndex1).add(parseEther("10")).add("300");
      await mockBucket.mock.getNormalizedVariableDebt.returns(secondCurrentIncome);
      const lowestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 0);
      const higherTS = (await provider.getBlock("latest")).timestamp + 100;

      const approxIndex = getApproxValue(activatedDeadline, lowestTS, BigNumber.from(higherTS), lastUpdatedIndex1, secondCurrentIncome);

      // make sure that approxIndex < bonus.lastUpdatedIndex
      expect(approxIndex.lte(currentIndex1)).to.equal(true);

      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await FeeDecreaser.claim(1, nftId);

      expect(await FeeDecreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAfterUpdate);
    });
    it("Should claim and update the bonus", async function () {
      const claimAmount = "1000";
      await mockDebtToken.mock.transferFrom.returns(true);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentIncome);
      await FeeDecreaser.claim(claimAmount, nftId);
      const { lastUpdatedIndex, claimedAmount } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(lastUpdatedIndex).to.be.equal(currentIncome);
      expect(claimedAmount).to.be.equal(claimAmount);
    });
    it("Should claim and delete the bonus when maxAmount is equal to the claimedAmount", async function () {
      const maxAmount = BigNumber.from("1000"); // wei

      tier = 2;
      await mockDebtToken.mock.transferFrom.returns(true);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      for (let i = 0; i < 10; i++) {
        await provider.send("evm_mine");
      }
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentDebt = calculateCompoundInterest(BAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(currentDebt);
      await FeeDecreaser.claim(maxAmount.add("10"), nftId);
      const { bucket } = await FeeDecreaser.getBonus(deployer.address, nftId);
      expect(bucket).to.be.equal(AddressZero);
    });
    it("Should getAvailableAmount return 0 when bucket is equal to zero", async function () {
      expect(await FeeDecreaser.getAvailableAmount(user.address, nftId)).to.be.equal(0);
    });
    it("Should getAvailableAmount return correct accumulatedAmount when the deadline is less than current timestamp", async function () {
      const balance = parseEther("1");

      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      const newNormolizeDebt = BigNumber.from(normalizedDebt).add(parseEther("3"));
      await mockBucket.mock.getNormalizedVariableDebt.returns(newNormolizeDebt);

      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await FeeDecreaser.getBonus(deployer.address, nftId);
      await mockBucket.mock.getNormalizedVariableDebt.returns(newNormolizeDebt);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        newNormolizeDebt,
      );
      // deadline < current timestamp
      const lowestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 0);
      const lowestIndex = await FeeDecreaser.indexes(mockBucket.address, lowestTS);
      const higherTS = (await provider.getBlock("latest")).timestamp + deadline + 2;
      const approx = getApproxValue(
        activatedDeadline,
        lowestTS,
        BigNumber.from(higherTS),
        lowestIndex,
        BigNumber.from(newNormolizeDebt).add(parseEther("5")),
      );
      const multiplier = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAmount = rayMul(multiplier, BN(approx.toString()).minus(lowestIndex.toString())).toString();
      await mockBucket.mock.getNormalizedVariableDebt.returns(BigNumber.from(newNormolizeDebt).add(parseEther("5")));
      await network.provider.send("evm_setNextBlockTimestamp", [higherTS]);
      await network.provider.send("evm_mine");
      expect(await FeeDecreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAmount);
    });
    it("Should getAvailableAmount return correct accumulatedAmount when the deadline is equal to the max of uint256", async function () {
      const balance = parseEther("1");

      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      const firstNormalizedDebt = BigNumber.from(normalizedDebt).add(parseEther("3"));
      await mockBucket.mock.getNormalizedVariableDebt.returns(firstNormalizedDebt);

      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const { deadline: activatedDeadline } = await FeeDecreaser.getBonus(deployer.address, nftId);
      await mockBucket.mock.getNormalizedVariableDebt.returns(firstNormalizedDebt);
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        firstNormalizedDebt,
      );
      // deadline < current timestamp
      const secondNormalizedDebt = firstNormalizedDebt.add(parseEther("2"));
      const lowestTS = await FeeDecreaser.updatedTimestamps(mockBucket.address, 0);
      const lowestIndex = await FeeDecreaser.indexes(mockBucket.address, lowestTS);
      await provider.send("evm_increaseTime", [deadline]);
      const highestTimestamp = BigNumber.from((await provider.getBlock("latest")).timestamp + deadline + 1);
      const approx = getApproxValue(activatedDeadline, lowestTS, highestTimestamp.add(1), lowestIndex, secondNormalizedDebt);
      const multiplier = wadMul(percent.toString(), balance.toString()).toString();
      const accumulatedAmount = rayMul(multiplier, BN(approx.toString()).minus(lowestIndex.toString())).toString();
      await provider.send("evm_setNextBlockTimestamp", [highestTimestamp.toNumber()]);
      await mockBucket.mock.getNormalizedVariableDebt.returns(secondNormalizedDebt);
      // last update
      await FeeDecreaser.connect(debtTokenSigner)["updateBonus(address,uint256,address,uint256)"](
        deployer.address,
        balance,
        mockBucket.address,
        secondNormalizedDebt,
      );
      const thirdNormalizedDebt = secondNormalizedDebt.add(parseEther("2"));
      await mockBucket.mock.getNormalizedIncome.returns(thirdNormalizedDebt);
      // the index has been change but accumulated amount remains the same
      expect(await FeeDecreaser.getAccumulatedAmount(deployer.address, nftId)).to.equal(accumulatedAmount);
    });
    it("Should getAvailableAmount return correct amount", async function () {
      const claimAmount = "1000";
      await mockDebtToken.mock.transferFrom.returns(true);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(parseEther("1"));
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      await mockBucket.mock.getNormalizedVariableDebt.returns(BigNumber.from(normalizedDebt).add(parseEther("3")));
      await FeeDecreaser.claim(claimAmount, nftId);
      const accumulatedAmount = await FeeDecreaser.getAccumulatedAmount(deployer.address, nftId);
      expect(await FeeDecreaser.getAvailableAmount(deployer.address, nftId)).to.be.equal(accumulatedAmount.sub(claimAmount));
    });
    it("Should set max bonuses count for bucket", async function () {
      const maxCount = 5;
      await FeeDecreaser.setMaxBonusCount(mockBucket.address, maxCount);
      const bonusCount = await FeeDecreaser.bucketBonusCount(mockBucket.address);
      expect(bonusCount.maxCount).to.be.equal(maxCount);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaxBonusCount", async function () {
      const maxCount = 5;
      await expect(FeeDecreaser.connect(user2).setMaxBonusCount(mockBucket.address, maxCount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert when max bonuses count exceeded", async function () {
      const maxCount = 1;
      await FeeDecreaser.setMaxBonusCount(mockBucket.address, maxCount);
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await mockBonusNft.mock.ownerOf.withArgs(1).returns(user.address);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(0, tier, mockBucket.address, deployer.address);
      await expect(
        FeeDecreaser.connect(bonusNftSigner).activateBonus(1, tier, mockBucket.address, user.address),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "MAX_BONUS_COUNT_EXCEEDED");
    });
    it("Should reduce counter when bonus is claimed", async function () {
      const balance = parseEther("1");
      await mockPToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(balance);
      await mockBonusNft.mock.ownerOf.withArgs(nftId).returns(deployer.address);
      await InterestIncreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      const bonusCountBefore = await InterestIncreaser.bucketBonusCount(mockBucket.address);
      const txBlockTimestamp = (await provider.getBlock("latest")).timestamp + 1000;
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp]);
      const currentIncome = calculateLinearInterest(LAR, lastUpdatedTimestamp, txBlockTimestamp).dp(0, 1).toString();
      await mockBucket.mock.getNormalizedIncome.returns(BigNumber.from(currentIncome).add(100));
      await provider.send("evm_increaseTime", [deadline + 1]);
      const { accumulatedAmount } = await InterestIncreaser.getBonus(deployer.address, nftId);
      await InterestIncreaser.claim(accumulatedAmount, nftId);
      const bonusCountAfter = await InterestIncreaser.bucketBonusCount(mockBucket.address);
      expect(bonusCountAfter.count).to.equal(bonusCountBefore.count - 1);
    });
    it("Should revert deactivateBonus when caller is not the NFT contract", async function () {
      await expect(FeeDecreaser.deactivateBonus(deployer.address, mockBucket.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_NFT",
      );
    });
    it("Should deactivateBonus", async function () {
      await mockBonusNft.mock.ownerOf.withArgs(0).returns(deployer.address);
      await mockDebtToken.mock.scaledBalanceOf.withArgs(deployer.address).returns(0);
      await FeeDecreaser.connect(bonusNftSigner).activateBonus(nftId, tier, mockBucket.address, deployer.address);
      expect((await FeeDecreaser.getBonus(deployer.address, nftId)).bucket).to.be.equal(mockBucket.address);
      await FeeDecreaser.connect(bonusNftSigner).deactivateBonus(deployer.address, mockBucket.address);
      expect((await FeeDecreaser.getBonus(deployer.address, nftId)).bucket).to.be.equal(AddressZero);
    });

    it("Should revert the if not EMERGENCY_ADMIN call pause", async function () {
      await expect(FeeDecreaser.connect(user).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert the if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(FeeDecreaser.connect(user4).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
