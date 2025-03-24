// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  network,
  upgrades,
  ethers: {
    BigNumber,
    getNamedSigners,
    getContractFactory,
    getContract,
    utils: { parseUnits, parseEther },
    constants: { Zero },
  },

  deployments: { fixture },
} = require("hardhat");
const { getDecodedEvents } = require("../utils/eventValidation");

process.env.TEST = true;

const {
  deployMockAccessControl,
  deployMockPriceOracle,
  deployMockERC20,
  deployMockTreasury,
  deployMockWhiteBlackList,
  deployMockPMXToken,
} = require("../utils/waffleMocks");
const { MEDIUM_TIMELOCK_ADMIN, SMALL_TIMELOCK_ADMIN, EMERGENCY_ADMIN, PM_ROLE, LOM_ROLE, BATCH_MANAGER_ROLE } = require("../../Constants");
const { KeeperActionType, DecreasingReason, KeeperCallingMethod } = require("../utils/constants.js");
const { wadMul, WAD } = require("../utils/bnMath.js");

describe("KeeperRewardDistributor_unit", function () {
  let snapshotId;
  let ErrorsLibrary;
  let deployer, liquidator, user;
  let keeperRewardDistributor, keeperRewardDistributorFactory;
  let initParams;
  let dataLengthRestrictions;
  let mockRegistry, mockPmx, mockPostiontoken, mockPriceOracle, mockTreasury, mockWhiteBlackList;
  let positionAssetDecimals, positionUsdExchangeRate;

  before(async function () {
    await fixture(["Test"]);
    // to hide OZ warnings: You are using the "unsafeAllow.external-library-linking" flag to include external libraries.
    await upgrades.silenceWarnings();

    ({ deployer, liquidator, user } = await getNamedSigners());
    ErrorsLibrary = await getContract("Errors");
    const primexPricingLibrary = await getContract("PrimexPricingLibrary");

    keeperRewardDistributorFactory = await getContractFactory("KeeperRewardDistributor", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });

    positionAssetDecimals = 18;
    positionUsdExchangeRate = parseUnits("2", "18");
    mockRegistry = await deployMockAccessControl(deployer);
    await mockRegistry.mock.hasRole.withArgs(MEDIUM_TIMELOCK_ADMIN, user.address).returns(false);
    await mockRegistry.mock.hasRole.withArgs(SMALL_TIMELOCK_ADMIN, user.address).returns(false);
    await mockRegistry.mock.hasRole.withArgs(EMERGENCY_ADMIN, user.address).returns(false);

    mockPmx = await deployMockPMXToken(deployer);
    mockPostiontoken = await deployMockERC20(deployer, positionAssetDecimals);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
    mockTreasury = await deployMockTreasury(deployer);

    await mockPmx.mock.transfer.returns(true);
    await mockPmx.mock.transferFrom.returns(true);
    await mockPriceOracle.mock.getExchangeRate.returns(positionUsdExchangeRate);
    await mockPriceOracle.mock.getGasPrice.returns("10000");

    const MaxGasPerPositionParams = [
      {
        actionType: KeeperActionType.Liquidation,
        config: {
          baseMaxGas1: "1000000",
          baseMaxGas2: "0",
          multiplier1: "1000000",
          multiplier2: "0",
          inflectionPoint: "0",
        },
      },
      {
        actionType: KeeperActionType.TakeProfit,
        config: {
          baseMaxGas1: "1000000",
          baseMaxGas2: "0",
          multiplier1: "2000000",
          multiplier2: "0",
          inflectionPoint: "0",
        },
      },
      {
        actionType: KeeperActionType.StopLoss,
        config: {
          baseMaxGas1: "1000000",
          baseMaxGas2: "1050000",
          multiplier1: "3000000",
          multiplier2: "3050000",
          inflectionPoint: "25",
        },
      },
      {
        actionType: KeeperActionType.OpenByOrder,
        config: {
          baseMaxGas1: "1000000",
          baseMaxGas2: "0",
          multiplier1: "4000000",
          multiplier2: "0",
          inflectionPoint: "0",
        },
      },
      {
        actionType: KeeperActionType.BucketDelisted,
        config: {
          baseMaxGas1: "1000000",
          baseMaxGas2: "0",
          multiplier1: "1000000",
          multiplier2: "0",
          inflectionPoint: "0",
        },
      },
    ];
    const DecreasingGasByReasonParams = [
      {
        reason: DecreasingReason.NonExistentIdForLiquidation,
        amount: "18755",
      },
      {
        reason: DecreasingReason.NonExistentIdForSLOrTP,
        amount: "6522",
      },
      {
        reason: DecreasingReason.IncorrectConditionForLiquidation,
        amount: "18845",
      },
      {
        reason: DecreasingReason.IncorrectConditionForSL,
        amount: "21480",
      },
      {
        reason: DecreasingReason.ClosePostionInTheSameBlock,
        amount: "203798",
      },
    ];
    dataLengthRestrictions = [
      {
        callingMethod: KeeperCallingMethod.ClosePositionByCondition,
        maxRoutesLength: "1600",
        baseLength: "196",
      },
      {
        callingMethod: KeeperCallingMethod.OpenPositionByOrder,
        maxRoutesLength: "3200",
        baseLength: "164",
      },
      {
        callingMethod: KeeperCallingMethod.CloseBatchPositions,
        maxRoutesLength: "1600",
        baseLength: "260",
      },
    ];

    initParams = {
      pmx: mockPmx.address,
      pmxPartInReward: parseUnits("0.2", "18"),
      nativePartInReward: parseUnits("0.8", "18"),
      positionSizeCoefficient: parseUnits("0.05", "18"),
      additionalGas: "10000",
      oracleGasPriceTolerance: parseUnits("1", 17),
      paymentModel: 0,
      defaultMaxGasPrice: parseUnits("1000", 9),
      registry: mockRegistry.address,
      priceOracle: mockPriceOracle.address,
      treasury: mockTreasury.address,
      whiteBlackList: mockWhiteBlackList.address,
      maxGasPerPositionParams: MaxGasPerPositionParams,
      decreasingGasByReasonParams: DecreasingGasByReasonParams,
    };
    keeperRewardDistributor = await upgrades.deployProxy(keeperRewardDistributorFactory, [initParams], {
      unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
    });
  });

  describe("initialize", function () {
    let mockInitParams;
    beforeEach(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
      mockInitParams = { ...initParams };
    });
    afterEach(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    it("Should revert if registry does not support IAccessControl interface", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(keeperRewardDistributorFactory, [mockInitParams], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if price oracle does not support IPriceOracle interface", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(keeperRewardDistributorFactory, [mockInitParams], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if treasury does not support ITreasury interface", async function () {
      await mockTreasury.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(keeperRewardDistributorFactory, [mockInitParams], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if the PMX token does not support its interface", async function () {
      await mockPmx.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(keeperRewardDistributorFactory, [mockInitParams], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert if the WhiteBlackList does not support its interface", async function () {
      await mockWhiteBlackList.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(keeperRewardDistributorFactory, [mockInitParams], {
          unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
        }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should correct initilize MaxGasPerPositionParams and DecreasingGasByReasonParams", async function () {
      for (let i = 0; i < initParams.maxGasPerPositionParams; i++) {
        const expectValue = await keeperRewardDistributor.maxGasPerPosition(initParams.maxGasPerPositionParams[i].actionType);
        expect(expectValue).to.be.equal(initParams.maxGasPerPositionParams[i].amount);
      }
      for (let i = 0; i < initParams.decreasingGasByReasonParams; i++) {
        const expectValue = await keeperRewardDistributor.maxGasPerPosition(initParams.decreasingGasByReason[i].reason);
        expect(expectValue).to.be.equal(initParams.maxGasPerPositionParams[i].amount);
      }
    });
  });
  describe("set functions", function () {
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
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setOptimisticGasCoefficient", async function () {
      const newOptimisticGasCoefficient = WAD;
      await expect(
        keeperRewardDistributor.connect(user).setOptimisticGasCoefficient(newOptimisticGasCoefficient),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert setOptimisticGasCoefficient if coefficient = 0", async function () {
      const newOptimisticGasCoefficient = 0;
      await expect(keeperRewardDistributor.setOptimisticGasCoefficient(newOptimisticGasCoefficient)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_OPTIMISM_GAS_COEFFICIENT",
      );
    });
    it("Should set optimisticGasCoefficient", async function () {
      const newOptimisticGasCoefficient = WAD;
      await keeperRewardDistributor.setOptimisticGasCoefficient(newOptimisticGasCoefficient);
      expect(await keeperRewardDistributor.optimisticGasCoefficient()).to.be.equal(newOptimisticGasCoefficient);
    });
    it("Should emit OptimisticGasCoefficientChanged when setOptimisticGasCoefficient is successful", async function () {
      const newOptimisticGasCoefficient = WAD;
      await expect(keeperRewardDistributor.setOptimisticGasCoefficient(newOptimisticGasCoefficient))
        .to.emit(keeperRewardDistributor, "OptimisticGasCoefficientChanged")
        .withArgs(newOptimisticGasCoefficient);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaxGasPrice", async function () {
      const defaultMaxGasPrice = 10;
      await expect(keeperRewardDistributor.connect(user).setDefaultMaxGasPrice(defaultMaxGasPrice)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set defaultMaxGasPrice", async function () {
      const defaultMaxGasPrice = 1000;
      await keeperRewardDistributor.setDefaultMaxGasPrice(defaultMaxGasPrice);
      expect(await keeperRewardDistributor.defaultMaxGasPrice()).to.be.equal(defaultMaxGasPrice);
    });

    it("Should emit DefaultMaxGasPriceChanged when setDefaultMaxGasPrice is successful", async function () {
      const defaultMaxGasPrice = 1000;
      await expect(keeperRewardDistributor.setDefaultMaxGasPrice(defaultMaxGasPrice))
        .to.emit(keeperRewardDistributor, "DefaultMaxGasPriceChanged")
        .withArgs(defaultMaxGasPrice);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setDecreasingGasByReason", async function () {
      await expect(
        keeperRewardDistributor.connect(user).setDecreasingGasByReason(DecreasingReason.ClosePostionInTheSameBlock, "1"),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should set setDecreasingGasByReason", async function () {
      const reason = DecreasingReason.ClosePostionInTheSameBlock;
      const amount = "0";
      await keeperRewardDistributor.setDecreasingGasByReason(reason, amount);
      expect(await keeperRewardDistributor.decreasingGasByReason(DecreasingReason.ClosePostionInTheSameBlock)).to.be.equal(amount);
    });

    it("Should emit DecreasingGasByReasonChanged when setDecreasingGasByReason is successful", async function () {
      const reason = DecreasingReason.ClosePostionInTheSameBlock;
      const amount = "0";
      await expect(keeperRewardDistributor.setDecreasingGasByReason(reason, amount))
        .to.emit(keeperRewardDistributor, "DecreasingGasByReasonChanged")
        .withArgs(reason, amount);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaxGasPerPosition", async function () {
      const actionType = KeeperActionType.Liquidation;
      const config = {
        baseMaxGas1: "1000000",
        baseMaxGas2: "0",
        multiplier1: "1000000",
        multiplier2: "0",
        inflectionPoint: "0",
      };
      await expect(keeperRewardDistributor.connect(user).setMaxGasPerPosition(actionType, config)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMinPositionSizeAddend", async function () {
      const minPositionSizeAddend = WAD;
      await expect(keeperRewardDistributor.connect(user).setMinPositionSizeAddend(minPositionSizeAddend)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set minPositionSizeAddend", async function () {
      const minPositionSizeAddend = WAD;
      await keeperRewardDistributor.setMinPositionSizeAddend(minPositionSizeAddend);
      expect(await keeperRewardDistributor.minPositionSizeAddend()).to.be.equal(minPositionSizeAddend);
    });
    it("Should emit MinPositionSizeAddendChanged when set minPositionSizeAddend is successful", async function () {
      const minPositionSizeAddend = WAD;
      await expect(keeperRewardDistributor.setMinPositionSizeAddend(minPositionSizeAddend))
        .to.emit(keeperRewardDistributor, "MinPositionSizeAddendChanged")
        .withArgs(minPositionSizeAddend);
    });
    it("Should set setMaxGasPerPosition", async function () {
      const actionType = KeeperActionType.Liquidation;
      const config = {
        baseMaxGas1: "1000000",
        baseMaxGas2: "0",
        multiplier1: "1",
        multiplier2: "1",
        inflectionPoint: "1",
      };
      await keeperRewardDistributor.setMaxGasPerPosition(actionType, config);
      const actualConfig = await keeperRewardDistributor.maxGasPerPosition(actionType);
      expect(actualConfig.multiplier1).to.be.equal(config.multiplier1);
      expect(actualConfig.multiplier2).to.be.equal(config.multiplier2);
      expect(actualConfig.baseMaxGas1).to.be.equal(config.baseMaxGas1);
      expect(actualConfig.baseMaxGas2).to.be.equal(config.baseMaxGas2);
      expect(actualConfig.inflectionPoint).to.be.equal(config.inflectionPoint);
    });

    it("Should emit MaxGasPerPositionChanged when setMaxGasPerPosition is successful", async function () {
      const actionType = KeeperActionType.Liquidation;
      const config = {
        baseMaxGas1: "1000000",
        baseMaxGas2: "0",
        multiplier1: "1000000",
        multiplier2: "0",
        inflectionPoint: "0",
      };
      const tx = await keeperRewardDistributor.setMaxGasPerPosition(actionType, config);
      const events = getDecodedEvents("MaxGasPerPositionChanged", await tx.wait(), keeperRewardDistributor);
      const { actionType: actionTypeFromEvent, config: configFromEvent } = events[0].args;
      expect(actionTypeFromEvent).to.be.equal(actionType);
      expect(configFromEvent.multiplier1).to.be.equal(config.multiplier1);
      expect(configFromEvent.multiplier2).to.be.equal(config.multiplier2);
      expect(configFromEvent.baseMaxGas1).to.be.equal(config.baseMaxGas1);
      expect(configFromEvent.baseMaxGas2).to.be.equal(config.baseMaxGas2);
      expect(configFromEvent.inflectionPoint).to.be.equal(config.inflectionPoint);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setDataLengthRestrictions", async function () {
      await expect(
        keeperRewardDistributor
          .connect(user)
          .setDataLengthRestrictions(
            dataLengthRestrictions[0].callingMethod,
            dataLengthRestrictions[0].maxRoutesLength,
            dataLengthRestrictions[0].baseLength,
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should set setDataLengthRestrictions", async function () {
      const callingMethod = KeeperCallingMethod.ClosePositionByCondition;
      await keeperRewardDistributor.setDataLengthRestrictions(
        dataLengthRestrictions[0].callingMethod,
        dataLengthRestrictions[0].maxRoutesLength,
        dataLengthRestrictions[0].baseLength,
      );
      const actualDataLengthRestrictions = await keeperRewardDistributor.dataLengthRestrictions(callingMethod);
      expect(actualDataLengthRestrictions.maxRoutesLength).to.be.equal(dataLengthRestrictions[0].maxRoutesLength);
      expect(actualDataLengthRestrictions.baseLength).to.be.equal(dataLengthRestrictions[0].baseLength);
    });

    it("Should emit DataLengthRestrictionsChanged when setDataLengthRestrictions is successful", async function () {
      for (let i = 0; i < dataLengthRestrictions.length; i++) {
        await expect(
          keeperRewardDistributor.setDataLengthRestrictions(
            dataLengthRestrictions[i].callingMethod,
            dataLengthRestrictions[i].maxRoutesLength,
            dataLengthRestrictions[i].baseLength,
          ),
        )
          .to.emit(keeperRewardDistributor, "DataLengthRestrictionsChanged")
          .withArgs(
            dataLengthRestrictions[i].callingMethod,
            dataLengthRestrictions[i].maxRoutesLength,
            dataLengthRestrictions[i].baseLength,
          );
      }
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setAdditionalGas", async function () {
      const additionalGas = 1000000;
      await expect(keeperRewardDistributor.connect(user).setAdditionalGas(additionalGas)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set additionalGas", async function () {
      const additionalGas = 1000000;
      await keeperRewardDistributor.setAdditionalGas(additionalGas);
      expect(await keeperRewardDistributor.additionalGas()).to.be.equal(additionalGas);
    });

    it("Should emit AdditionalGasChanged when set is successful", async function () {
      const additionalGas = 1000000;
      await expect(keeperRewardDistributor.setAdditionalGas(additionalGas))
        .to.emit(keeperRewardDistributor, "AdditionalGasChanged")
        .withArgs(additionalGas);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setOracleGasPriceTolerance", async function () {
      const oracleGasPriceTolerance = 1000000;
      await expect(keeperRewardDistributor.connect(user).setOracleGasPriceTolerance(oracleGasPriceTolerance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set oracleGasPriceTolerance", async function () {
      const oracleGasPriceTolerance = 1000000;
      await keeperRewardDistributor.setOracleGasPriceTolerance(oracleGasPriceTolerance);
      expect(await keeperRewardDistributor.oracleGasPriceTolerance()).to.be.equal(oracleGasPriceTolerance);
    });

    it("Should emit OracleGasPriceToleranceChanged when setOracleGasPriceTolerance is successful", async function () {
      const oracleGasPriceTolerance = 1000000;
      await expect(keeperRewardDistributor.setOracleGasPriceTolerance(oracleGasPriceTolerance))
        .to.emit(keeperRewardDistributor, "OracleGasPriceToleranceChanged")
        .withArgs(oracleGasPriceTolerance);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setPmxPartInReward", async function () {
      const pmxPartInReward = parseUnits("0.1", "18");
      await expect(keeperRewardDistributor.connect(user).setPmxPartInReward(pmxPartInReward)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if the pmxPartInReward is incorrect", async function () {
      const pmxPartInReward = parseUnits("10", "18").add("1");
      await expect(keeperRewardDistributor.setPmxPartInReward(pmxPartInReward)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PART_IN_REWARD",
      );
    });
    it("Should set pmxPartInReward", async function () {
      const pmxPartInReward = parseUnits("0.1", "18");
      await keeperRewardDistributor.setPmxPartInReward(pmxPartInReward);
      expect(await keeperRewardDistributor.pmxPartInReward()).to.be.equal(pmxPartInReward);
    });

    it("Should emit PmxPartInRewardChanged when setPmxPartInReward is successful", async function () {
      const pmxPartInReward = parseUnits("0.1", "18");
      await expect(keeperRewardDistributor.setPmxPartInReward(pmxPartInReward))
        .to.emit(keeperRewardDistributor, "PmxPartInRewardChanged")
        .withArgs(pmxPartInReward);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setNativePartInReward", async function () {
      const nativePartInReward = parseUnits("0.9", "18");
      await expect(keeperRewardDistributor.connect(user).setNativePartInReward(nativePartInReward)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should revert if the nativePartInReward is incorrect", async function () {
      const nativePartInReward = parseUnits("10", "18").add("1");
      await expect(keeperRewardDistributor.setNativePartInReward(nativePartInReward)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_PART_IN_REWARD",
      );
    });
    it("Should set nativePartInReward", async function () {
      const nativePartInReward = parseUnits("0.9", "18");
      await keeperRewardDistributor.setNativePartInReward(nativePartInReward);
      expect(await keeperRewardDistributor.nativePartInReward()).to.be.equal(nativePartInReward);
    });

    it("Should emit NativePartInRewardChanged when setNativePartInReward is successful", async function () {
      const nativePartInReward = parseUnits("0.9", "18");
      await expect(keeperRewardDistributor.setNativePartInReward(nativePartInReward))
        .to.emit(keeperRewardDistributor, "NativePartInRewardChanged")
        .withArgs(nativePartInReward);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setPositionSizeCoefficient", async function () {
      const positionSizeCoefficient = parseUnits("2", "18");
      await expect(keeperRewardDistributor.connect(user).setPositionSizeCoefficient(positionSizeCoefficient)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
    it("Should set Position Size Coefficient", async function () {
      const positionSizeCoefficient = parseUnits("2", "18");
      await keeperRewardDistributor.setPositionSizeCoefficient(positionSizeCoefficient);
      expect(await keeperRewardDistributor.positionSizeCoefficient()).to.be.equal(positionSizeCoefficient);
    });

    it("Should emit when setPositionSizeCoefficient is successful", async function () {
      const positionSizeCoefficient = parseUnits("2", "18");
      await expect(keeperRewardDistributor.setPositionSizeCoefficient(positionSizeCoefficient))
        .to.emit(keeperRewardDistributor, "PositionSizeCoefficientChanged")
        .withArgs(positionSizeCoefficient);
    });
  });

  describe("updateReward", function () {
    let updateRewardParams;

    async function pureGasSpent(totalGasSpent, decreasingCounter = []) {
      if (decreasingCounter.length === 0) return totalGasSpent;
      let decreaseAmount = Zero;
      for (let i = 0; i < decreasingCounter.length; i++) {
        if (Number(decreasingCounter[i]) > 0) {
          decreaseAmount = decreaseAmount.add((await keeperRewardDistributor.decreasingGasByReason(i)).mul(decreasingCounter[i]));
        }
      }
      return totalGasSpent.gt(decreaseAmount) ? totalGasSpent.sub(decreaseAmount) : Zero;
    }

    async function getMaxGasAmount(actionType, numberOfActions) {
      if (actionType === KeeperActionType.OpenByOrder) return await keeperRewardDistributor.maxGasPerPosition(actionType);
      const config = await keeperRewardDistributor.maxGasPerPosition(actionType);
      if (config.inflectionPoint.eq(Zero) || config.inflectionPoint.gt(numberOfActions)) {
        return BigNumber.from(config.baseMaxGas1).add(config.multiplier1.mul(numberOfActions));
      }
      return BigNumber.from(config.baseMaxGas2).add(config.multiplier2.mul(numberOfActions));
    }

    async function calculateRewards(positionSize, pureGas, maxGasAmount, txGasPrice, minPositionSizeAddend = Zero) {
      const oracleAmountsOut = wadMul(positionSize, positionUsdExchangeRate);
      let positionSizeAddend = wadMul(oracleAmountsOut, initParams.positionSizeCoefficient);
      if (positionSizeAddend.lt(minPositionSizeAddend)) {
        positionSizeAddend = minPositionSizeAddend;
      }
      let gasAmount = BigNumber.from(initParams.additionalGas).add(pureGas);
      if (gasAmount.gt(maxGasAmount)) {
        gasAmount = maxGasAmount;
      }

      let gasPrice = txGasPrice;
      const oracleGasPrice = await mockPriceOracle.getGasPrice();
      const maxGasPriceForReward = oracleGasPrice.gt(0)
        ? wadMul(oracleGasPrice, WAD.add(initParams.oracleGasPriceTolerance))
        : initParams.defaultMaxGasPrice;
      if (gasPrice.gt(maxGasPriceForReward)) {
        gasPrice = maxGasPriceForReward;
      }
      const reward = gasAmount.mul(gasPrice).add(positionSizeAddend);
      const rewardInNativeCurrency = wadMul(reward, initParams.nativePartInReward);
      const rewardInPmx = wadMul(wadMul(reward, positionUsdExchangeRate), initParams.pmxPartInReward);
      return { rewardInNativeCurrency, rewardInPmx };
    }

    beforeEach(async function () {
      updateRewardParams = {
        keeper: liquidator.address,
        positionAsset: mockPostiontoken.address,
        positionSize: parseEther("1"),
        action: KeeperActionType.Liquidation,
        numberOfActions: 1,
        gasSpent: BigNumber.from("100000000"),
        decreasingCounter: Array(Object.keys(DecreasingReason).length).fill(0),
        routesLength: 0,
        nativePmxOracleData: 0,
        positionNativeAssetOracleData: 0,
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
    it("Should correct calculate rewards", async function () {
      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = await pureGasSpent(updateRewardParams.gasSpent, updateRewardParams.decreasingCounter);
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);
      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correct calculate rewards when positionSizeAddend < minPositionSizeAddend ", async function () {
      const minPositionSizeAddend = WAD.mul("2");
      await keeperRewardDistributor.setMinPositionSizeAddend(minPositionSizeAddend);

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = await pureGasSpent(updateRewardParams.gasSpent, updateRewardParams.decreasingCounter);
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);

      const oracleAmountsOut = wadMul(updateRewardParams.positionSize, positionUsdExchangeRate);
      const positionSizeAddend = wadMul(oracleAmountsOut, initParams.positionSizeCoefficient);

      expect(positionSizeAddend).to.be.lt(minPositionSizeAddend);
      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
        minPositionSizeAddend,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });

    it("Should updateReward and emit event KeeperRewardUpdated", async function () {
      const updateRewardTx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const { pmxBalance: rewardInPmx, nativeBalance: rewardInNativeCurrency } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      await expect(updateRewardTx)
        .to.emit(keeperRewardDistributor, "KeeperRewardUpdated")
        .withArgs(liquidator.address, rewardInPmx, rewardInNativeCurrency);
    });

    it("Should correctly calculate the rewards when the decreasingCounter is empty array", async function () {
      updateRewardParams.decreasingCounter = [];
      updateRewardParams.gasSpent = "1000";

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = updateRewardParams.gasSpent;
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);
      // to make sure it's pureGas that counts.
      expect(maxGasAmount.gt(pureGas)).to.be.equal(true);

      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correctly calculate the rewards when the decrease amount is greater than totalGasSpent", async function () {
      updateRewardParams.decreasingCounter[DecreasingReason.NonExistentIdForLiquidation] = 1000;
      updateRewardParams.gasSpent = "10000";

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = Zero;
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);
      // to make sure it's pureGas that counts.
      expect(maxGasAmount.gt(pureGas)).to.be.equal(true);

      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correctly calculate when a decrease amount is greater than gasSpent", async function () {
      updateRewardParams.gasSpent = "1000";
      updateRewardParams.decreasingCounter[DecreasingReason.IncorrectConditionForLiquidation] = 1;
      updateRewardParams.decreasingCounter[DecreasingReason.NonExistentIdForLiquidation] = 3;

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = Zero;
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);
      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correctly calculate the rewards when there are some decreasing reasons", async function () {
      updateRewardParams.decreasingCounter[DecreasingReason.IncorrectConditionForLiquidation] = 1;
      updateRewardParams.decreasingCounter[DecreasingReason.NonExistentIdForLiquidation] = 3;
      updateRewardParams.gasSpent = BigNumber.from("100000");

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      const pureGas = await pureGasSpent(updateRewardParams.gasSpent, updateRewardParams.decreasingCounter);
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);

      expect(maxGasAmount.gt(pureGas)).to.be.equal(true);

      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correctly calculate the rewards when numberOfActions is greater than the inflectionPoint", async function () {
      updateRewardParams.action = KeeperActionType.StopLoss;
      updateRewardParams.numberOfActions = (await keeperRewardDistributor.maxGasPerPosition(KeeperActionType.StopLoss)).inflectionPoint.add(
        "3",
      );

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      // to make pureGas > than maxGasAmount;
      const pureGas = parseEther("10");
      const maxGasAmount = await getMaxGasAmount(updateRewardParams.action, updateRewardParams.numberOfActions);
      expect(pureGas.gt(maxGasAmount)).to.be.equal(true);
      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should correctly calculate the rewards when actionType is OpenByOrder and it does not depends numberOfActions", async function () {
      updateRewardParams.action = KeeperActionType.OpenByOrder;
      updateRewardParams.numberOfActions = 10;

      const tx = await keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams);
      const receipt = await tx.wait();
      const { pmxBalance: pmxRewardAfter, nativeBalance: nativeRewardAfter } = await keeperRewardDistributor.keeperBalance(
        liquidator.address,
      );
      // to make pureGas > than maxGasAmount;
      const pureGas = parseEther("10");
      const maxGasAmount = (await keeperRewardDistributor.maxGasPerPosition(KeeperActionType.OpenByOrder)).multiplier1;
      expect(pureGas.gt(maxGasAmount)).to.be.equal(true);

      const { rewardInNativeCurrency, rewardInPmx } = await calculateRewards(
        updateRewardParams.positionSize,
        pureGas,
        maxGasAmount,
        receipt.effectiveGasPrice,
      );
      expect(pmxRewardAfter).to.be.equal(rewardInPmx);
      expect(nativeRewardAfter).to.be.equal(rewardInNativeCurrency);
    });
    it("Should revert when the caller is not LOM or PM", async function () {
      await mockRegistry.mock.hasRole.withArgs(PM_ROLE, liquidator.address).returns(false);
      await mockRegistry.mock.hasRole.withArgs(LOM_ROLE, liquidator.address).returns(false);
      await mockRegistry.mock.hasRole.withArgs(BATCH_MANAGER_ROLE, liquidator.address).returns(false);

      await expect(keeperRewardDistributor.connect(liquidator).updateReward(updateRewardParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });

  describe("claim", function () {
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
    it("Should not transfer tokens when user has zero balance of reward", async function () {
      await expect(() => keeperRewardDistributor.connect(liquidator).claim(10, 10)).to.changeEtherBalance(liquidator.address, 0);
    });
    it("Should revert when contract is paused", async function () {
      await keeperRewardDistributor.pause();
      await expect(keeperRewardDistributor.connect(liquidator).claim(0, 0)).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert when the msg.sender is on the blacklist", async function () {
      await mockWhiteBlackList.mock.isBlackListed.returns(true);
      await expect(keeperRewardDistributor.connect(liquidator).claim(0, 0)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });
  });
  describe("pause & unpause", function () {
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
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(keeperRewardDistributor.connect(user).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(keeperRewardDistributor.connect(user).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
