// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const { parseUnits } = require("ethers/lib/utils");
const {
  network,
  ethers: {
    provider,
    BigNumber,
    getContract,
    utils: { getAddress, parseEther, defaultAbiCoder },
    constants: { AddressZero, MaxUint256, NegativeOne },
    getNamedSigners,
    getSigners,
    getContractFactory,
  },
  upgrades,
  deployments: { fixture },
} = require("hardhat");

const {
  deployMockReserve,
  deployMockBucket,
  deployMockDexAdapter,
  deployMockTreasury,
  deployMockConditionalManager,
  deployMockWhiteBlackList,
} = require("./utils/waffleMocks");
const { barCalcParams } = require("./utils/defaultBarCalcParams");
const { getAdminSigners } = require("./utils/hardhatUtils");
const { FeeRateType, TradingOrderType, BAR_CALC_PARAMS_DECODE } = require("./utils/constants");

process.env.TEST = true;

const { getConfigByName } = require("../config/configUtils");
const {
  PrimexDNSconfig: {
    delistingDelayInDays,
    adminWithdrawalDelayInDays,
    protocolFeeCoefficient,
    liquidationGasAmount,
    pmxDiscountMultiplier,
    gasPriceBuffer,
    additionalGasSpent,
    feeRates,
    averageGasPerAction,
  },
} = getConfigByName("generalConfig.json");

const feeBuffer = "1000200000000000000"; // 1.0002
const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
const reserveRate = "100000000000000000"; // 0.1 - 10%
const delistingDelay = BigNumber.from(delistingDelayInDays).mul(24).mul(3600);
const adminWithdrawalDelay = BigNumber.from(adminWithdrawalDelayInDays).mul(24).mul(3600);
const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
const estimatedLar = "70000000000000000000000000"; // 0.07 in ray

describe("PrimexDNS", function () {
  let PrimexDNS, deployer, caller, BucketsFactory, positionManager, priceOracle, dexAdapter, interestRateStrategy;
  let mockReserve, mockBucket, mockDexAdapter, mockTreasury, PMXToken;
  let tokenTransfersLibrary;
  let ErrorsLibrary;
  let snapshotId;
  let BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin, EmergencyAdmin;
  before(async function () {
    ({ deployer, caller } = await getNamedSigners());
    await fixture(["Test"]);
    ({ BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin, EmergencyAdmin } = await getAdminSigners());

    PrimexDNS = await getContract("PrimexDNS");
    BucketsFactory = await getContract("BucketsFactoryV2");
    ErrorsLibrary = await getContract("Errors");
    PMXToken = await getContract("EPMXToken");

    dexAdapter = await getContract("DexAdapter");
    positionManager = await getContract("PositionManager");
    priceOracle = await getContract("PriceOracle");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    interestRateStrategy = await getContract("InterestRateStrategy");

    mockReserve = await deployMockReserve(deployer);
    mockBucket = await deployMockBucket(deployer);
    mockDexAdapter = await deployMockDexAdapter(deployer);
    mockTreasury = await deployMockTreasury(deployer);
  });

  // eslint-disable-next-line mocha/no-hooks-for-single-case
  beforeEach(async function () {
    snapshotId = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  // eslint-disable-next-line mocha/no-hooks-for-single-case
  afterEach(async function () {
    await network.provider.request({
      method: "evm_revert",
      params: [snapshotId],
    });
  });

  describe("Initialization", function () {
    let primexDNSFactory, registry, args;
    before(async function () {
      registry = await getContract("Registry");

      primexDNSFactory = await getContractFactory("PrimexDNS");
    });
    beforeEach(async function () {
      const maxProtocolFee = MaxUint256;
      args = [
        {
          registry: registry.address,
          pmx: PMXToken.address,
          treasury: mockTreasury.address,
          delistingDelay: delistingDelay,
          adminWithdrawalDelay: adminWithdrawalDelay,
          feeRateParams: [
            {
              feeRateType: FeeRateType.SpotPositionClosedByTrader,
              feeRate: parseEther(feeRates.SpotPositionClosedByTrader),
            },
            {
              feeRateType: FeeRateType.MarginPositionClosedByTrader,
              feeRate: parseEther(feeRates.MarginPositionClosedByTrader),
            },
          ],
          averageGasPerActionParams: [
            {
              tradingOrderType: TradingOrderType.SpotMarketOrder,
              averageGasPerAction: parseEther(averageGasPerAction.SpotMarketOrder),
            },
            {
              tradingOrderType: TradingOrderType.MarginMarketOrder,
              averageGasPerAction: parseEther(averageGasPerAction.MarginMarketOrder),
            },
          ],
          maxProtocolFee: maxProtocolFee,
          liquidationGasAmount: parseEther(liquidationGasAmount),
          protocolFeeCoefficient: parseEther(protocolFeeCoefficient),
          additionalGasSpent: parseEther(additionalGasSpent),
          pmxDiscountMultiplier: parseEther(pmxDiscountMultiplier),
          gasPriceBuffer: parseEther(gasPriceBuffer),
          leverageTolerance: 0,
        },
      ];
    });

    it("Should initialize primexDNS", async function () {
      expect(await upgrades.deployProxy(primexDNSFactory, args, { unsafeAllow: ["constructor", "delegatecall"] }));
    });

    it("Should revert when registry address not supported", async function () {
      args[0].registry = positionManager.address;
      await expect(
        upgrades.deployProxy(primexDNSFactory, args, { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when PMXToken address not supported", async function () {
      args[0].pmx = positionManager.address;
      await expect(
        upgrades.deployProxy(primexDNSFactory, args, { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert when treasury address not supported", async function () {
      await mockTreasury.mock.supportsInterface.returns(false);
      await expect(
        upgrades.deployProxy(primexDNSFactory, args, { unsafeAllow: ["constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setPMX", function () {
    it("should change pmx token address if by BIG_TIMELOCK_ADMIN role", async function () {
      // i don't use the "PMXToken" var because it's EPMX now
      const pmxToken = await getContract("PMXToken");
      await PrimexDNS.connect(BigTimelockAdmin).setPMX(pmxToken.address);
      expect(await PrimexDNS.pmx()).to.equal(pmxToken.address);
    });

    it("Should emit PMXchanged when set is successful", async function () {
      const pmxToken = await getContract("PMXToken");
      await expect(PrimexDNS.connect(BigTimelockAdmin).setPMX(pmxToken.address))
        .to.emit(PrimexDNS, "PMXchanged")
        .withArgs(pmxToken.address);
    });

    it("should revert if not BIG_TIMELOCK_ADMIN call setPMX", async function () {
      await expect(PrimexDNS.connect(caller).setPMX(PMXToken.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("should revert if new address null address", async function () {
      await expect(PrimexDNS.setPMX(AddressZero)).to.be.reverted;
    });
    it("should revert if new address is not supported", async function () {
      await expect(PrimexDNS.setPMX(dexAdapter.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setDexAdapter", function () {
    it("setDexAdapter if called BIG_TIMELOCK_ADMIN", async function () {
      await PrimexDNS.connect(BigTimelockAdmin).setDexAdapter(dexAdapter.address);
      expect(await PrimexDNS.dexAdapter()).to.equal(dexAdapter.address);
    });

    it("should revert if not BIG_TIMELOCK_ADMIN call setDexAdapter", async function () {
      await expect(PrimexDNS.connect(caller).setDexAdapter(deployer.address)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("should revert if new address null address", async function () {
      await expect(PrimexDNS.setDexAdapter(AddressZero)).to.be.reverted;
    });
    it("should revert if new DexAdapter address is not supported", async function () {
      await mockDexAdapter.mock.supportsInterface.returns(false);
      await expect(PrimexDNS.setDexAdapter(mockDexAdapter.address)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("setConditionalManager", function () {
    let mockConditionalManager;
    before(async function () {
      mockConditionalManager = await deployMockConditionalManager(deployer);
    });

    it("Should setConditionalManager if called by BIG_TIMELOCK_ADMIN", async function () {
      const newConditionalManager = mockConditionalManager.address;
      const testCmType = MaxUint256.sub(1);
      expect(await PrimexDNS.cmTypeToAddress(testCmType)).to.equal(AddressZero);

      await PrimexDNS.connect(BigTimelockAdmin).setConditionalManager(testCmType, newConditionalManager);
      expect(await PrimexDNS.cmTypeToAddress(testCmType)).to.equal(newConditionalManager);
    });

    it("Should emit ConditionalManagerChanged when set is successful", async function () {
      const newConditionalManager = mockConditionalManager.address;
      const testCmType = MaxUint256.sub(1);

      await expect(PrimexDNS.connect(BigTimelockAdmin).setConditionalManager(testCmType, newConditionalManager))
        .to.emit(PrimexDNS, "ConditionalManagerChanged")
        .withArgs(testCmType, newConditionalManager);
    });

    it("Should revert if the new ConditionalManager address is not supported or is zero address", async function () {
      const testCmType = MaxUint256.sub(1);
      await mockConditionalManager.mock.supportsInterface.returns(false);
      await expect(PrimexDNS.setConditionalManager(testCmType, mockConditionalManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "ADDRESS_NOT_SUPPORTED",
      );

      await expect(PrimexDNS.setConditionalManager(testCmType, AddressZero)).to.be.reverted;
    });

    it("Should revert if nit BIG_TIMELOCK_ADMIN call setConditionalManager", async function () {
      await expect(PrimexDNS.connect(caller).setConditionalManager("1", mockConditionalManager.address)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setLeverageTolerance", function () {
    it("Should setLeverageTolerance if called by MEDIUM_TIMELOCK_ADMIN", async function () {
      const leverageTolerance = parseEther("0.1");
      await PrimexDNS.connect(MediumTimelockAdmin).setLeverageTolerance(leverageTolerance);
      expect(await PrimexDNS.leverageTolerance()).to.equal(leverageTolerance);
    });

    it("Should emit ChangeLeverageTolerance when set is successful", async function () {
      const leverageTolerance = parseEther("0.1");

      await expect(PrimexDNS.connect(MediumTimelockAdmin).setLeverageTolerance(leverageTolerance))
        .to.emit(PrimexDNS, "ChangeLeverageTolerance")
        .withArgs(leverageTolerance);
    });

    it("Should revert if the leverage tolerance is greater than 0.2 WAD", async function () {
      const leverageTolerance = parseEther("0.2").add("1");
      await expect(PrimexDNS.connect(MediumTimelockAdmin).setLeverageTolerance(leverageTolerance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "LEVERAGE_TOLERANCE_IS_NOT_CORRECT",
      );
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setConditionalManager", async function () {
      const leverageTolerance = parseEther("0.2").add("1");
      await expect(PrimexDNS.connect(SmallTimelockAdmin).setLeverageTolerance(leverageTolerance)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });

  describe("setAavePool", function () {
    let newAavePool;
    before(async function () {
      newAavePool = PrimexDNS.address;
    });
    it("setAavePool if called by BIG_TIMELOCK_ADMIN", async function () {
      await PrimexDNS.connect(BigTimelockAdmin).setAavePool(newAavePool);
      expect(await PrimexDNS.aavePool()).to.equal(newAavePool);
    });

    it("Should emit AavePoolChanged if set is successful", async function () {
      await expect(PrimexDNS.connect(BigTimelockAdmin).setAavePool(newAavePool))
        .to.emit(PrimexDNS, "AavePoolChanged")
        .withArgs(newAavePool);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setAavePool", async function () {
      await expect(PrimexDNS.connect(caller).setAavePool(newAavePool)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });

  describe("setMaxProtocolFee", function () {
    let maxProtocolFee;
    before(async function () {
      maxProtocolFee = parseEther("2");
    });
    it("change maxProtocolFee if called by BIG_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(BigTimelockAdmin).setMaxProtocolFee(maxProtocolFee))
        .to.emit(PrimexDNS, "ChangeMaxProtocolFee")
        .withArgs(maxProtocolFee);
      expect(await PrimexDNS.maxProtocolFee()).to.equal(maxProtocolFee);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setMaxProtocolFee", async function () {
      await expect(PrimexDNS.connect(caller).setMaxProtocolFee(maxProtocolFee)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
  describe("setLiquidationGasAmount", function () {
    let liquidationGasAmount;
    before(async function () {
      liquidationGasAmount = parseEther("0.5");
    });
    it("change liquidationGasAmount if called by MEDIUM_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(BigTimelockAdmin).setLiquidationGasAmount(liquidationGasAmount))
        .to.emit(PrimexDNS, "ChangeLiquidationGasAmount")
        .withArgs(liquidationGasAmount);
      expect(await PrimexDNS.liquidationGasAmount()).to.equal(liquidationGasAmount);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setLiquidationGasAmount", async function () {
      await expect(PrimexDNS.connect(caller).setLiquidationGasAmount(liquidationGasAmount)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setProtocolFeeCoefficient", function () {
    let protocolFeeCoefficient;
    before(async function () {
      protocolFeeCoefficient = parseEther("0.5");
    });
    it("change protocolFeeCoefficient if called by BIG_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(BigTimelockAdmin).setProtocolFeeCoefficient(protocolFeeCoefficient))
        .to.emit(PrimexDNS, "ChangeProtocolFeeCoefficient")
        .withArgs(protocolFeeCoefficient);
      expect(await PrimexDNS.protocolFeeCoefficient()).to.equal(protocolFeeCoefficient);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setProtocolFeeCoefficient", async function () {
      await expect(PrimexDNS.connect(caller).setProtocolFeeCoefficient(protocolFeeCoefficient)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setProtocolFeeRate", function () {
    let feeRateType, feeRate;
    before(async function () {
      feeRateType = FeeRateType.SpotPositionClosedByTrader;
      feeRate = parseEther("0.01");
    });
    it("change protocolFeeRate if called by BIG_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(BigTimelockAdmin).setProtocolFeeRate([feeRateType, feeRate]))
        .to.emit(PrimexDNS, "ChangeProtocolFeeRate")
        .withArgs(feeRateType, feeRate);
      expect(await PrimexDNS.protocolFeeRates(feeRateType)).to.equal(feeRate);
    });

    it("Should revert if not BIG_TIMELOCK_ADMIN call setProtocolFeeRate", async function () {
      await expect(PrimexDNS.connect(caller).setProtocolFeeRate([feeRateType, feeRate])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setAverageGasPerAction", function () {
    let tradingOrderType, averageGasPerAction;
    before(async function () {
      tradingOrderType = TradingOrderType.SpotMarketOrder;
      averageGasPerAction = parseEther("0.01");
    });
    it("change averageGasPerAction if called by MEDIUM_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(MediumTimelockAdmin).setAverageGasPerAction([tradingOrderType, averageGasPerAction]))
        .to.emit(PrimexDNS, "ChangeAverageGasPerAction")
        .withArgs(tradingOrderType, averageGasPerAction);
      expect(await PrimexDNS.averageGasPerAction(tradingOrderType)).to.equal(averageGasPerAction);
    });
    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setAverageGasPerAction", async function () {
      await expect(PrimexDNS.connect(caller).setAverageGasPerAction([tradingOrderType, averageGasPerAction])).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setAdditionalGasSpent", function () {
    let additionalGasSpent;
    before(async function () {
      additionalGasSpent = parseEther("0.5");
    });
    it("change additionalGasSpent if called by MEDIUM_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(MediumTimelockAdmin).setAdditionalGasSpent(additionalGasSpent))
        .to.emit(PrimexDNS, "ChangeAdditionalGasSpent")
        .withArgs(additionalGasSpent);
      expect(await PrimexDNS.additionalGasSpent()).to.equal(additionalGasSpent);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setAdditionalGasSpent", async function () {
      await expect(PrimexDNS.connect(caller).setAdditionalGasSpent(additionalGasSpent)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setPmxDiscountMultiplier", function () {
    let pmxDiscountMultiplier;
    before(async function () {
      pmxDiscountMultiplier = parseEther("0.95");
    });
    it("change pmxDiscountMultiplier if called by SMALL_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(SmallTimelockAdmin).setPmxDiscountMultiplier(pmxDiscountMultiplier))
        .to.emit(PrimexDNS, "ChangePmxDiscountMultiplier")
        .withArgs(pmxDiscountMultiplier);
      expect(await PrimexDNS.pmxDiscountMultiplier()).to.equal(pmxDiscountMultiplier);
    });

    it("Should revert if not SMALL_TIMELOCK_ADMIN call setPmxDiscountMultiplier", async function () {
      await expect(PrimexDNS.connect(caller).setPmxDiscountMultiplier(pmxDiscountMultiplier)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });
  });
  describe("setGasPriceBuffer", function () {
    let gasPriceBuffer;
    before(async function () {
      gasPriceBuffer = parseEther("0.5");
    });
    it("change gasPriceBuffergasPriceBuffer if called by MEDIUM_TIMELOCK_ADMIN and throw event", async function () {
      await expect(PrimexDNS.connect(MediumTimelockAdmin).setGasPriceBuffer(gasPriceBuffer))
        .to.emit(PrimexDNS, "ChangeGasPriceBuffer")
        .withArgs(gasPriceBuffer);
      expect(await PrimexDNS.gasPriceBuffer()).to.equal(gasPriceBuffer);
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setGasPriceBuffer", async function () {
      await expect(PrimexDNS.connect(caller).setGasPriceBuffer(gasPriceBuffer)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });

  it("getDnsBucketAddress revert if bucket not added", async function () {
    await expect(PrimexDNS.getBucketAddress("notAddedBucket")).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_NOT_ADDED");
  });

  it("dnsBucket return correct bucketData ", async function () {
    expect((await PrimexDNS.buckets("notAddedBucket")).bucketAddress).to.equal(AddressZero);
    expect((await PrimexDNS.buckets("notAddedBucket")).currentStatus).to.equal(0);
    expect((await PrimexDNS.buckets("notAddedBucket")).delistingDeadline).to.equal(0);
    expect((await PrimexDNS.buckets("notAddedBucket")).adminDeadline).to.equal(0);
  });

  it("should return correct values when calling getParamsForMinPositionSize", async function () {
    const expectedBaseLength = await PrimexDNS.getL1BaseLengthForTradingOrderType(TradingOrderType.MarginMarketOrder);
    const expectedAverageGasPerAction = await PrimexDNS.averageGasPerAction(TradingOrderType.MarginMarketOrder);
    const expectedProtocolFeeCoefficient = await PrimexDNS.protocolFeeCoefficient();
    const expectedGasPriceBuffer = await PrimexDNS.gasPriceBuffer();
    const params = await PrimexDNS.getParamsForMinPositionSize(TradingOrderType.MarginMarketOrder);

    expect(params).to.deep.equal([expectedBaseLength, expectedAverageGasPerAction, expectedProtocolFeeCoefficient, expectedGasPriceBuffer]);
  });

  it("dnsDex return correct dexData", async function () {
    expect((await PrimexDNS.dexes("notAddedBucket")).routerAddress).to.equal(AddressZero);
    expect((await PrimexDNS.dexes("notAddedBucket")).isActive).to.equal(false);
  });
  it("should revert if not SMALL_TIMELOCK_ADMIN call addBucket", async function () {
    await expect(PrimexDNS.connect(caller).addBucket(AddressZero, 0)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
  });

  it("Should revert if not MEDIUM_TIMELOCK_ADMIN call addDEX", async function () {
    await expect(PrimexDNS.connect(caller).addDEX("name", AddressZero)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
  });

  it("addDEX should revert if address values are null address", async function () {
    await expect(PrimexDNS.addDEX("name", AddressZero)).to.be.revertedWithCustomError(ErrorsLibrary, "CAN_NOT_ADD_WITH_ZERO_ADDRESS");
  });

  describe("addBucket", function () {
    let name2, newBucketAddress, txAddBucket, mockWhiteBlackList;

    beforeEach(async function () {
      // create bucket params
      name2 = "bucket2";
      const assets = [];
      const risksThresholds = [];
      const underlyingAsset = (await getContract("TestTokenA")).address;
      mockWhiteBlackList = await deployMockWhiteBlackList(deployer);

      const txCreateBucket = await BucketsFactory.createBucket({
        nameBucket: name2,
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        reserve: mockReserve.address,
        dns: PrimexDNS.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: assets,
        pairPriceDrops: risksThresholds,
        underlyingAsset: underlyingAsset,
        feeBuffer: feeBuffer,
        whiteBlackList: mockWhiteBlackList.address,
        withdrawalFeeRate: withdrawalFeeRate,
        reserveRate: reserveRate,
        liquidityMiningAmount: 0,
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningDeadline: 0,
        stabilizationDuration: 0,
        pmxRewardAmount: 0,
        interestRateStrategy: interestRateStrategy.address,
        maxAmountPerUser: 0,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]),
        maxTotalDeposit: MaxUint256,
      });
      const txCreateBucketReceipt = await txCreateBucket.wait();

      for (let i = 0; i < txCreateBucketReceipt.events.length; i++) {
        if (txCreateBucketReceipt.events[i].event === "BucketCreated") {
          newBucketAddress = getAddress("0x" + txCreateBucketReceipt.events[i].data.slice(26));
        }
      }

      txAddBucket = await PrimexDNS.connect(SmallTimelockAdmin).addBucket(newBucketAddress, 0);
    });

    it("dnsBucket return correct bucketData", async function () {
      expect((await PrimexDNS.buckets(name2)).bucketAddress).to.equal(newBucketAddress);
      expect((await PrimexDNS.buckets(name2)).currentStatus).to.equal(1);
      expect((await PrimexDNS.buckets(name2)).delistingDeadline).to.equal(0);
      expect((await PrimexDNS.buckets(name2)).adminDeadline).to.equal(0);
    });

    it("addBucket with liquidityMining shoulld transfer pmx to LiquidityMiningRewardDistributor", async function () {
      const pmx = await getContract("EPMXToken");
      const LiquidityMiningRewardDistributor = await getContract("LiquidityMiningRewardDistributor");
      const pmxRewardAmount = parseUnits("100", await pmx.decimals());
      const txCreateBucket = await BucketsFactory.createBucket({
        nameBucket: "bucket3",
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: [],
        dns: PrimexDNS.address,
        pairPriceDrops: [],
        underlyingAsset: (await getContract("TestTokenA")).address,
        feeBuffer: feeBuffer,
        whiteBlackList: mockWhiteBlackList.address,
        withdrawalFeeRate: withdrawalFeeRate,
        reserveRate: reserveRate,
        liquidityMiningRewardDistributor: LiquidityMiningRewardDistributor.address,
        liquidityMiningAmount: "1",
        liquidityMiningDeadline: MaxUint256.div(2).toString(),
        stabilizationDuration: "1",
        pmxRewardAmount: pmxRewardAmount.toString(),
        interestRateStrategy: interestRateStrategy.address,
        maxAmountPerUser: MaxUint256,
        estimatedBar: estimatedBar,
        estimatedLar: estimatedLar,
        barCalcParams: defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]),
        maxTotalDeposit: MaxUint256,
      });
      const txCreateBucketReceipt = await txCreateBucket.wait();

      let newBucketAddress;
      for (let i = 0; i < txCreateBucketReceipt.events.length; i++) {
        if (txCreateBucketReceipt.events[i].event === "BucketCreated") {
          newBucketAddress = getAddress("0x" + txCreateBucketReceipt.events[i].data.slice(26));
        }
      }
      await pmx.approve(PrimexDNS.address, pmxRewardAmount);
      await expect(() => PrimexDNS.addBucket(newBucketAddress, pmxRewardAmount)).to.changeTokenBalances(
        pmx,
        [deployer, LiquidityMiningRewardDistributor],
        [pmxRewardAmount.mul(NegativeOne), pmxRewardAmount],
      );
    });

    it("getDnsBucketAddress returns the correct bucket address", async function () {
      expect(await PrimexDNS.getBucketAddress(name2)).to.equal(newBucketAddress);
    });

    it("function addBucket creates an event with bucket parameters", async function () {
      await expect(txAddBucket).to.emit(PrimexDNS, "AddNewBucket").withArgs([newBucketAddress]);
    });

    it("addBucket should revert if exist bucket with this name", async function () {
      await expect(PrimexDNS.addBucket(newBucketAddress, 0)).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_ALREADY_ADDED");
    });

    it("Should revert 'addBucket()' when bucket address not supported", async function () {
      await mockBucket.mock.supportsInterface.returns(false);
      await expect(PrimexDNS.addBucket(mockBucket.address, 0)).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("should revert if not EMERGENCY_ADMIN call freezeBucket ", async function () {
      await expect(PrimexDNS.connect(caller).freezeBucket(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    describe("Emitting events", function () {
      it("Should emit BucketActivated when activateBucket is successful", async function () {
        await PrimexDNS.connect(EmergencyAdmin).freezeBucket(name2, { gasLimit: 2000000 });
        await expect(PrimexDNS.connect(SmallTimelockAdmin).activateBucket(name2))
          .to.emit(PrimexDNS, "BucketActivated")
          .withArgs(newBucketAddress);
      });

      it("Should emit BucketFrozen when freezeBucket is successful", async function () {
        await expect(PrimexDNS.connect(EmergencyAdmin).freezeBucket(name2, { gasLimit: 2000000 }))
          .to.emit(PrimexDNS, "BucketFrozen")
          .withArgs(newBucketAddress);
      });

      it("Should emit DexAdapterChanged when setDexAdapter is successful", async function () {
        await expect(PrimexDNS.connect(BigTimelockAdmin).setDexAdapter(dexAdapter.address))
          .to.emit(PrimexDNS, "DexAdapterChanged")
          .withArgs(dexAdapter.address);
      });
    });

    describe("deprecateBucket", function () {
      it("Should revert if not BIG_TIMELOCK_ADMIN call deprecateBucket", async function () {
        await expect(PrimexDNS.connect(caller).deprecateBucket(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      });
      it("Should revert when the bucket is not active", async function () {
        await PrimexDNS.deprecateBucket(name2);
        await expect(PrimexDNS.connect(deployer).deprecateBucket(name2)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "BUCKET_IS_ALREADY_DEPRECATED",
        );
      });
      it("Should deprecateBucket", async function () {
        await PrimexDNS.connect(BigTimelockAdmin).deprecateBucket(name2);
        const lastTimestamp = (await provider.getBlock("latest")).timestamp;
        const delistingDeadline = BigNumber.from(delistingDelay).add(lastTimestamp);
        expect((await PrimexDNS.buckets(name2)).currentStatus).to.be.equal(2);
        expect((await PrimexDNS.buckets(name2)).delistingDeadline).to.be.equal(delistingDeadline);
        expect((await PrimexDNS.buckets(name2)).adminDeadline).to.be.equal(delistingDeadline.add(adminWithdrawalDelay));
      });
      it("Should deprecateBucket and emit BucketDeprecated event", async function () {
        await expect(PrimexDNS.connect(BigTimelockAdmin).deprecateBucket(name2))
          .to.emit(PrimexDNS, "BucketDeprecated")
          .withArgs(newBucketAddress, (await PrimexDNS.buckets(name2)).delistingDeadline);
      });
    });
    describe("freezeBucket", function () {
      beforeEach(async function () {
        await PrimexDNS.connect(EmergencyAdmin).freezeBucket(name2, { gasLimit: 2000000 });
      });

      it("dnsBucket return correct bucketData ", async function () {
        expect((await PrimexDNS.buckets(name2)).bucketAddress).to.equal(newBucketAddress);
        expect((await PrimexDNS.buckets(name2)).currentStatus).to.equal(0);
      });

      it("getDnsBucketAddress revert if bucket not active", async function () {
        await expect(PrimexDNS.getBucketAddress(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_INACTIVE");
      });

      it("freezeBucket should revert if bucket already frozen", async function () {
        await expect(PrimexDNS.freezeBucket(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_ALREADY_FROZEN");
      });

      it("Should revert if not SMALL_TIMELOCK_ADMIN call activateBucket", async function () {
        await expect(PrimexDNS.connect(caller).activateBucket(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      });

      describe("activateBucket", function () {
        beforeEach(async function () {
          await PrimexDNS.connect(SmallTimelockAdmin).activateBucket(name2, { gasLimit: 2000000 });
        });

        it("dnsBucket return correct bucketData ", async function () {
          expect((await PrimexDNS.buckets(name2)).bucketAddress).to.equal(newBucketAddress);
          expect((await PrimexDNS.buckets(name2)).currentStatus).to.equal(1);
        });

        it("getDnsBucketAddress returns the correct bucket address", async function () {
          expect(await PrimexDNS.getBucketAddress(name2)).to.equal(newBucketAddress);
        });

        it("activateBucket should revert if bucket already activated", async function () {
          await expect(PrimexDNS.activateBucket(name2)).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_ALREADY_ACTIVATED");
        });

        it("activateBucket should revert if bucket is not added", async function () {
          const newName = "non-existing-bucket";
          await expect(PrimexDNS.activateBucket(newName)).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_NOT_ADDED");
        });
      });
    });
  });

  describe("addDEX", function () {
    let dexName, routerAddress, txAddDex;
    beforeEach(async function () {
      dexName = "dex2";
      const signers = await getSigners();
      routerAddress = signers[9].address;
      txAddDex = await PrimexDNS.connect(MediumTimelockAdmin).addDEX(dexName, routerAddress);
    });

    it("getDnsDex return correct routerAddress", async function () {
      expect(await PrimexDNS.getDexAddress(dexName)).to.equal(routerAddress);
    });

    it("dnsDex return correct dexData", async function () {
      expect((await PrimexDNS.dexes(dexName)).routerAddress).to.equal(routerAddress);
      expect((await PrimexDNS.dexes(dexName)).isActive).to.equal(true);
    });

    it("function addDEX creates an event with dex parameters", async function () {
      await expect(txAddDex).to.emit(PrimexDNS, "AddNewDex").withArgs([routerAddress, true]);
    });

    it("addDEX should revert if exist dex with this name", async function () {
      await expect(PrimexDNS.addDEX(dexName, routerAddress)).to.be.revertedWithCustomError(ErrorsLibrary, "DEX_IS_ALREADY_ADDED");
    });

    it("Should revert if not MEDIUM_TIMELOCK_ADMIN call freezeDEX", async function () {
      await expect(PrimexDNS.connect(caller).freezeDEX(dexName)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });

    it("Should emit DexActivated when activateDEX is successful", async function () {
      await PrimexDNS.connect(MediumTimelockAdmin).freezeDEX(dexName);
      await expect(PrimexDNS.connect(MediumTimelockAdmin).activateDEX(dexName)).to.emit(PrimexDNS, "DexActivated").withArgs(routerAddress);
    });

    it("Should emit DexFrozen when freezeDEX is successful", async function () {
      await expect(PrimexDNS.connect(MediumTimelockAdmin).freezeDEX(dexName)).to.emit(PrimexDNS, "DexFrozen").withArgs(routerAddress);
    });

    describe("freezeDEX", function () {
      beforeEach(async function () {
        await PrimexDNS.connect(MediumTimelockAdmin).freezeDEX(dexName);
      });

      it("dnsDex return correct dexData", async function () {
        expect((await PrimexDNS.dexes(dexName)).routerAddress).to.equal(routerAddress);
        expect((await PrimexDNS.dexes(dexName)).isActive).to.equal(false);
      });

      it("freezeDEX should revert if dex already frozen", async function () {
        await expect(PrimexDNS.freezeDEX(dexName)).to.be.revertedWithCustomError(ErrorsLibrary, "DEX_IS_ALREADY_FROZEN");
      });

      it("Should revert if not MEDIUM_TIMELOCK_ADMIN call activateDEX", async function () {
        await expect(PrimexDNS.connect(caller).activateDEX(dexName)).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      });

      describe("activateDEX", function () {
        beforeEach(async function () {
          await PrimexDNS.connect(MediumTimelockAdmin).activateDEX(dexName);
        });

        it("getDnsDex correct routerAddress and adapterAddress", async function () {
          expect(await PrimexDNS.getDexAddress(dexName)).to.equal(routerAddress);
        });

        it("dnsDex return correct dexData", async function () {
          expect((await PrimexDNS.dexes(dexName)).routerAddress).to.equal(routerAddress);
          expect((await PrimexDNS.dexes(dexName)).isActive).to.equal(true);
        });

        it("activateDex should revert if bucket already activated", async function () {
          await expect(PrimexDNS.activateDEX(dexName)).to.be.revertedWithCustomError(ErrorsLibrary, "DEX_IS_ALREADY_ACTIVATED");
        });
      });
    });
  });
});
