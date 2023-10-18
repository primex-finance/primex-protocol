// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");
const {
  ethers: {
    getContract,
    getNamedSigners,
    utils: { parseEther, defaultAbiCoder },
  },
  deployments: { fixture },
} = require("hardhat");

const { NATIVE_CURRENCY, BAR_CALC_PARAMS_DECODE } = require("../utils/constants");
const { barCalcParams } = require("../utils/defaultBarCalcParams");

const {
  deployMockPriceOracle,
  deployMockAccessControl,
  deployMockTraderBalanceVault,
  deployMockPMXToken,
  deployMockTreasury,
  deployMockPrimexDNS,
  deployMockWhiteBlackList,
  deployMockPositionManager,
  deployMockSwapManager,
  deployMockKeeperRewardDistributor,
  deployBonusNft,
  deployMockInterestRateStrategy,
  deployLMRewardDistributor,
  deployMockERC20,
  deployMockReserve,
} = require("../utils/waffleMocks");

process.env.TEST = true;

describe("ProxyContracts", function () {
  let deployer;
  let mockRegistry,
    mockPriceOracle,
    mockPMX,
    mockTraderBalanceVault,
    mockTreasury,
    mockPrimexDNS,
    mockWhiteBlackList,
    mockPositionManager,
    mockSwapManager,
    mockKeeperRD,
    mockNft,
    mockInterestRateStrategy,
    mockLMrd,
    mockErc20,
    mockReserve;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer } = await getNamedSigners());
    mockRegistry = await deployMockAccessControl(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
    mockPMX = await deployMockPMXToken(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    mockTreasury = await deployMockTreasury(deployer);
    mockPrimexDNS = await deployMockPrimexDNS(deployer);
    mockWhiteBlackList = await deployMockWhiteBlackList(deployer);
    mockPositionManager = await deployMockPositionManager(deployer);
    mockSwapManager = await deployMockSwapManager(deployer);
    mockKeeperRD = await deployMockKeeperRewardDistributor(deployer);
    mockNft = await deployBonusNft(deployer);
    mockInterestRateStrategy = await deployMockInterestRateStrategy(deployer);
    mockLMrd = await deployLMRewardDistributor(deployer);
    mockErc20 = await deployMockERC20(deployer);
    mockReserve = await deployMockReserve(deployer);
  });

  describe("SpotTradingRewardDistributor", function () {
    it("Should not initialize again from proxy", async function () {
      const spotTradingRewardDistributorProxy = await getContract("SpotTradingRewardDistributor");

      await expect(
        spotTradingRewardDistributorProxy.initialize(
          mockRegistry.address,
          1,
          mockPriceOracle.address,
          mockPMX.address,
          mockTraderBalanceVault.address,
          mockTreasury.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const spotTradingRewardDistributorImpl = await getContract("SpotTradingRewardDistributor_Implementation");

      await expect(
        spotTradingRewardDistributorImpl.initialize(
          mockRegistry.address,
          1,
          mockPriceOracle.address,
          mockPMX.address,
          mockTraderBalanceVault.address,
          mockTreasury.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("Reserve", function () {
    it("Should not initialize again from proxy", async function () {
      const reserveProxy = await getContract("Reserve");

      await expect(reserveProxy.initialize(mockPrimexDNS.address, mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const reserveImpl = await getContract("Reserve_Implementation");

      await expect(reserveImpl.initialize(mockPrimexDNS.address, mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("ActivityRewardDistributor", function () {
    it("Should not initialize again from proxy", async function () {
      const activityRDProxy = await getContract("ActivityRewardDistributor");

      await expect(
        activityRDProxy.initialize(
          mockPMX.address,
          mockPrimexDNS.address,
          mockRegistry.address,
          mockTreasury.address,
          mockTraderBalanceVault.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const activityRDImpl = await getContract("ActivityRewardDistributor_Implementation");

      await expect(
        activityRDImpl.initialize(
          mockPMX.address,
          mockPrimexDNS.address,
          mockRegistry.address,
          mockTreasury.address,
          mockTraderBalanceVault.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("KeeperRewardDistributor", function () {
    it("Should not initialize again from proxy", async function () {
      const initParams = {
        pmx: mockPriceOracle.address,
        pmxPartInReward: 1,
        nativePartInReward: 1,
        positionSizeCoefficientA: 1,
        positionSizeCoefficientB: 1,
        additionalGas: 1,
        oracleGasPriceTolerance: 1,
        defaultMaxGasPrice: 1,
        registry: mockRegistry.address,
        priceOracle: mockPriceOracle.address,
        treasury: mockTreasury.address,
        whiteBlackList: mockWhiteBlackList.address,
        maxGasPerPositionParams: [],
        decreasingGasByReasonParams: [],
        paymentModel: 0,
      };
      const keeperRDProxy = await getContract("KeeperRewardDistributor");
      await expect(keeperRDProxy.initialize(initParams)).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const initParams = {
        pmx: mockPriceOracle.address,
        pmxPartInReward: 1,
        nativePartInReward: 1,
        positionSizeCoefficientA: 1,
        positionSizeCoefficientB: 1,
        additionalGas: 1,
        oracleGasPriceTolerance: 1,
        defaultMaxGasPrice: 1,
        registry: mockRegistry.address,
        priceOracle: mockPriceOracle.address,
        treasury: mockTreasury.address,
        whiteBlackList: mockWhiteBlackList.address,
        maxGasPerPositionParams: [],
        decreasingGasByReasonParams: [],
        paymentModel: 0,
      };
      const keeperRDImpl = await getContract("KeeperRewardDistributor_Implementation");
      await expect(keeperRDImpl.initialize(initParams)).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("LimitOrderManager", function () {
    it("Should not initialize again from proxy", async function () {
      const lomProxy = await getContract("LimitOrderManager");

      await expect(
        lomProxy.initialize(
          mockRegistry.address,
          mockPrimexDNS.address,
          mockPositionManager.address,
          mockTraderBalanceVault.address,
          mockSwapManager.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const lomImpl = await getContract("LimitOrderManager_Implementation");

      await expect(
        lomImpl.initialize(
          mockRegistry.address,
          mockPrimexDNS.address,
          mockPositionManager.address,
          mockTraderBalanceVault.address,
          mockSwapManager.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("LiquidityMiningRewardDistributor", function () {
    it("Should not initialize again from proxy", async function () {
      const liquidityMiningRDProxy = await getContract("LiquidityMiningRewardDistributor");

      await expect(
        liquidityMiningRDProxy.initialize(
          mockPrimexDNS.address,
          mockPMX.address,
          mockTraderBalanceVault.address,
          mockRegistry.address,
          mockTreasury.address,
          1,
          1,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const liquidityMiningRDImpl = await getContract("LiquidityMiningRewardDistributor_Implementation");

      await expect(
        liquidityMiningRDImpl.initialize(
          mockPrimexDNS.address,
          mockPMX.address,
          mockTraderBalanceVault.address,
          mockRegistry.address,
          mockTreasury.address,
          1,
          1,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("PositionManager", function () {
    it("Should not initialize again from proxy", async function () {
      const pmProxy = await getContract("PositionManager");

      await expect(
        pmProxy.initialize(
          mockRegistry.address,
          mockPrimexDNS.address,
          mockTraderBalanceVault.address,
          mockPriceOracle.address,
          mockKeeperRD.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const pmImpl = await getContract("PositionManager_Implementation");

      await expect(
        pmImpl.initialize(
          mockRegistry.address,
          mockPrimexDNS.address,
          mockTraderBalanceVault.address,
          mockPriceOracle.address,
          mockKeeperRD.address,
          mockWhiteBlackList.address,
        ),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("PriceOracle", function () {
    it("Should not initialize again from proxy", async function () {
      const oracleProxy = await getContract("PriceOracle");

      await expect(oracleProxy.initialize(mockRegistry.address, NATIVE_CURRENCY)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const oracleImpl = await getContract("PriceOracle_Implementation");

      await expect(oracleImpl.initialize(mockRegistry.address, NATIVE_CURRENCY)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("PrimexDNS", function () {
    let rates;
    before(async function () {
      rates = [
        {
          orderType: 0,
          feeToken: mockPMX.address,
          rate: parseEther("0.0024"),
        },
        {
          orderType: 0,
          feeToken: NATIVE_CURRENCY,
          rate: parseEther("0.003"),
        },
      ];
    });
    it("Should not initialize again from proxy", async function () {
      const dnsProxy = await getContract("PrimexDNS");

      await expect(dnsProxy.initialize(mockRegistry.address, mockPMX.address, mockTreasury.address, 1, 1, rates)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const dnsImpl = await getContract("PrimexDNS_Implementation");

      await expect(dnsImpl.initialize(mockRegistry.address, mockPMX.address, mockTreasury.address, 1, 1, rates)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("ReferralProgram", function () {
    it("Should not initialize again from proxy", async function () {
      const referralProgramProxy = await getContract("ReferralProgram");

      await expect(referralProgramProxy.initialize(mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const referralProgramImpl = await getContract("ReferralProgram_Implementation");

      await expect(referralProgramImpl.initialize(mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("WhiteBlackList", function () {
    it("Should not initialize again from proxy", async function () {
      const whiteBlackListProxy = await getContract("WhiteBlackList");

      await expect(whiteBlackListProxy.initialize(mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const whiteBlackListImpl = await getContract("WhiteBlackList_Implementation");

      await expect(whiteBlackListImpl.initialize(mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("TraderBalanceVault", function () {
    it("Should not initialize again from proxy", async function () {
      const vaultProxy = await getContract("TraderBalanceVault");

      await expect(vaultProxy.initialize(mockRegistry.address, mockWhiteBlackList.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const vaultImpl = await getContract("TraderBalanceVault_Implementation");

      await expect(vaultImpl.initialize(mockRegistry.address, mockWhiteBlackList.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("Treasury", function () {
    it("Should not initialize again from proxy", async function () {
      const treasuryProxy = await getContract("Treasury");

      await expect(treasuryProxy.initialize(mockRegistry.address)).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const treasuryImpl = await getContract("Treasury_Implementation");

      await expect(treasuryImpl.initialize(mockRegistry.address)).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("FeeDecreaser", function () {
    it("Should not initialize again from proxy", async function () {
      const feeDecreaserProxy = await getContract("FeeDecreaser");

      await expect(
        feeDecreaserProxy.initialize(mockNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const feeDecreaserImpl = await getContract("FeeDecreaser_Implementation");

      await expect(
        feeDecreaserImpl.initialize(mockNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("InterestIncreaser", function () {
    it("Should not initialize again from proxy", async function () {
      const interestIncreaserProxy = await getContract("InterestIncreaser");

      await expect(
        interestIncreaserProxy.initialize(mockNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });

    it("Should not initialize again from implementation", async function () {
      const interestIncreaserImpl = await getContract("InterestIncreaser_Implementation");

      await expect(
        interestIncreaserImpl.initialize(mockNft.address, mockRegistry.address, mockPrimexDNS.address, mockWhiteBlackList.address),
      ).to.be.revertedWith("Initializable: contract is already initialized");
    });
  });

  describe("PMXBonusNFT", function () {
    it("Should not initialize again from proxy", async function () {
      const pmxBonusNftProxy = await getContract("PMXBonusNFT");

      await expect(pmxBonusNftProxy.initialize(mockPrimexDNS.address, mockRegistry.address, mockWhiteBlackList.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again from implementation", async function () {
      const pmxBonusNftImpl = await getContract("PMXBonusNFT_Implementation");

      await expect(pmxBonusNftImpl.initialize(mockPrimexDNS.address, mockRegistry.address, mockWhiteBlackList.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });

  describe("BeaconProxies", function () {
    it("Should not initialize again Bucket", async function () {
      const bucketInitParams = {
        name: "name",
        pToken: mockErc20.address,
        debtToken: mockErc20.address,
        reserve: mockReserve.address,
        positionManager: mockPositionManager.address,
        priceOracle: mockPriceOracle.address,
        dns: mockPrimexDNS.address,
        whiteBlackList: mockWhiteBlackList.address,
        assets: [mockErc20.address],
        borrowedAsset: mockErc20.address,
        feeBuffer: 1,
        withdrawalFeeRate: 1,
        reserveRate: 1,
        liquidityMiningRewardDistributor: mockLMrd.address,
        liquidityMiningAmount: 1,
        liquidityMiningDeadline: 1,
        stabilizationDuration: 1,
        interestRateStrategy: mockInterestRateStrategy.address,
        maxAmountPerUser: 1,
        isReinvestToAaveEnabled: false,
        estimatedBar: 1,
        estimatedLar: 1,
        barCalcParams: defaultAbiCoder.encode(BAR_CALC_PARAMS_DECODE, [Object.values(barCalcParams)]),
        maxTotalDeposit: 1,
      };
      const bucket = await getContract("Bucket");

      await expect(bucket.initialize(bucketInitParams, mockRegistry.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again DebtToken", async function () {
      const debtToken = await getContract("DebtToken");
      await expect(debtToken.initialize("newName", "newSymbol", 6, mockErc20.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });

    it("Should not initialize again PToken", async function () {
      const pToken = await getContract("PToken");
      await expect(pToken.initialize("newName", "newSymbol", 6, mockErc20.address)).to.be.revertedWith(
        "Initializable: contract is already initialized",
      );
    });
  });
});
