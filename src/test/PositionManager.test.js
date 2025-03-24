// SPDX-License-Identifier: BUSL-1.1
const { expect } = require("chai");

const {
  run,
  network,
  upgrades,
  ethers: {
    provider,
    getContract,
    getContractAt,
    getContractFactory,
    getNamedSigners,
    utils: { parseEther, parseUnits, getAddress, defaultAbiCoder },
    constants: { MaxUint256, NegativeOne, AddressZero },
    BigNumber,
  },
  deployments: { fixture, getArtifact },
} = require("hardhat");

const {
  WAD,
  MAX_TOKEN_DECIMALITY,
  CloseReason,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  LIMIT_PRICE_CM_TYPE,
  FeeRateType,
  BAR_CALC_PARAMS_DECODE,
  USD_DECIMALS,
  USD_MULTIPLIER,
  PaymentModel,
  KeeperActionType,
  TradingOrderType,
  ArbGasInfo,
  NATIVE_CURRENCY,
  UpdatePullOracle,
} = require("./utils/constants");
const { TRUSTED_TOLERABLE_LIMIT_ROLE } = require("../Constants");
const { wadDiv, wadMul, rayMul, rayDiv, calculateCompoundInterest } = require("./utils/math");
const { increaseBlocksBy, getAdminSigners, getImpersonateSigner } = require("./utils/hardhatUtils");
const {
  setupUsdOraclesForToken,
  setOraclePrice,
  setupUsdOraclesForTokens,
  getEncodedChainlinkRouteViaUsd,
  getEncodedChainlinkRouteToUsd,
  setBadOraclePrice,
  reversePrice,
  fivePercent,
  getExchangeRateByRoutes,
} = require("./utils/oracleUtils");
const { calculateFeeInPaymentAsset, calculateMinPositionSize, calculateFeeAmountInPmx } = require("./utils/protocolUtils");

const {
  getAmountsOut,
  addLiquidity,
  getPair,
  swapExactTokensForTokens,
  checkIsDexSupported,
  getAncillaryDexData,
  getSingleMegaRoute,
  getMegaRoutes,
  getGas,
} = require("./utils/dexOperations");
const { eventValidation, parseArguments, getDecodedEvents } = require("./utils/eventValidation");
const { encodeFunctionData } = require("../tasks/utils/encodeFunctionData");
const {
  deployMockReserve,
  deployMockAccessControl,
  deployMockPrimexDNS,
  deployMockTraderBalanceVault,
  deployMockPriceOracle,
  deployMockERC20,
  deployMockKeeperRewardDistributor,
  deployMockSpotTradingRewardDistributor,
} = require("./utils/waffleMocks");
const {
  getTakeProfitStopLossParams,
  getTakeProfitStopLossAdditionalParams,
  getCondition,
  decodeStopLossTakeProfit,
} = require("./utils/conditionParams");
const { barCalcParams } = require("./utils/defaultBarCalcParams");

process.env.TEST = true;

describe("PositionManager", function () {
  let dex,
    dex2,
    positionManager,
    traderBalanceVault,
    testTokenA,
    testTokenB,
    bucket,
    debtTokenA,
    testTokenX,
    PrimexDNS,
    whiteBlackList,
    positionManagerExtension,
    bucketAddress,
    newBucketAddress,
    bestDexLens,
    primexPricingLibrary,
    positionLibrary,
    ancillaryDexData,
    ancillaryDexData2,
    firstAssetMegaRoutes,
    megaRoutesForClose,
    interestRateStrategy;
  let pair;
  let priceOracle;
  let deployer, trader, lender, liquidator, caller;
  let snapshotIdBase;
  let mockReserve,
    mockRegistry,
    mockPrimexDns,
    mockTraderBalanceVault,
    mockPriceOracle,
    mockKeeperRewardDistributor,
    mockSpotTradingRewardDistributor,
    mockContract;
  let increaseBy;
  let decimalsA, decimalsB, decimalsX;
  let multiplierA, multiplierB, multiplierX;
  let tokenTransfersLibrary;
  let OpenPositionParams;
  let positionAmount, price, depositAmount, borrowedAmount, swapSize, ttaPriceInPMX, ttaPriceInETH;
  let PMXToken, Treasury;
  let KeeperRewardDistributor;
  let ErrorsLibrary;
  let BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin;
  let TiersManager;
  const firstNotDefaultTier = 1;
  let firstNotDefaultThreshold;
  before(async function () {
    await fixture(["Test"]);
    ({ deployer, trader, lender, liquidator, caller } = await getNamedSigners());
    ({ BigTimelockAdmin, MediumTimelockAdmin, SmallTimelockAdmin } = await getAdminSigners());

    traderBalanceVault = await getContract("TraderBalanceVault");
    testTokenA = await getContract("TestTokenA");
    decimalsA = await testTokenA.decimals();
    await testTokenA.mint(trader.address, parseUnits("100", decimalsA));
    testTokenB = await getContract("TestTokenB");
    decimalsB = await testTokenB.decimals();
    PrimexDNS = await getContract("PrimexDNS");
    PMXToken = await getContract("EPMXToken");
    Treasury = await getContract("Treasury");
    whiteBlackList = await getContract("WhiteBlackList");
    positionManagerExtension = await getContract("PositionManagerExtension");
    KeeperRewardDistributor = await getContract("KeeperRewardDistributor");
    TiersManager = await getContract("TiersManager");
    firstNotDefaultThreshold = parseEther("10"); // 10 EPMX
    await TiersManager.addTiers([firstNotDefaultTier], [firstNotDefaultThreshold], false);
    bestDexLens = await getContract("BestDexLens");
    positionManager = await getContract("PositionManager");
    mockContract = await deployMockERC20(deployer);
    mockContract = await getImpersonateSigner(mockContract);
    bucketAddress = (await PrimexDNS.buckets("bucket1")).bucketAddress;
    bucket = await getContractAt("Bucket", bucketAddress);
    const debtTokenAddress = await bucket.debtToken();
    debtTokenA = await getContractAt("DebtToken", debtTokenAddress);
    primexPricingLibrary = await getContract("PrimexPricingLibrary");
    positionLibrary = await getContract("PositionLibrary");
    tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
    ErrorsLibrary = await getContract("Errors");
    interestRateStrategy = await getContract("InterestRateStrategy");

    const { payload: payload1 } = await encodeFunctionData(
      "setMaxPositionSize",
      [testTokenA.address, testTokenB.address, 0, MaxUint256],
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload1);

    if (process.env.DEX && process.env.DEX !== "uniswap") {
      dex = process.env.DEX;
      dex2 = "uniswap";
    } else {
      dex = "uniswap";
      dex2 = "sushiswap";
    }
    ancillaryDexData = await getAncillaryDexData({ dex });
    ancillaryDexData2 = await getAncillaryDexData({ dex: dex2 });
    checkIsDexSupported(dex);
    firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex);
    megaRoutesForClose = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);

    const data = await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenB });
    await addLiquidity({ dex: dex2, from: "lender", tokenA: testTokenA, tokenB: testTokenB });

    const pairAddress = await getPair(dex, testTokenA.address, testTokenB.address, data);
    pair = await getContractAt("@openzeppelin/contracts/token/ERC20/IERC20.sol:IERC20", pairAddress);
    await run("deploy:ERC20Mock", {
      name: "TestTokenX",
      symbol: "TTX",
      decimals: "18",
      initialAccounts: JSON.stringify([trader.address]),
      initialBalances: JSON.stringify([parseEther("100").toString()]),
    });
    testTokenX = await getContract("TestTokenX");
    // const tokenUSD = await getContract("USD Coin");
    decimalsX = await testTokenX.decimals();
    priceOracle = await getContract("PriceOracle");

    ttaPriceInPMX = parseUnits("0.2", USD_DECIMALS); // 1 tta=0.2 pmx
    ttaPriceInETH = parseUnits("0.3", USD_DECIMALS); // 1 tta=0.3 ETH

    await setupUsdOraclesForTokens(testTokenA, PMXToken, ttaPriceInPMX);
    await setupUsdOraclesForTokens(testTokenA, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForTokens(testTokenX, await priceOracle.eth(), ttaPriceInETH);
    await setupUsdOraclesForToken(testTokenB, parseUnits("1", USD_DECIMALS));

    const { payload: payload2 } = await encodeFunctionData(
      "setSecurityBuffer",
      [parseEther("0.1")], // 0.1
      "PositionManagerExtension",
    );
    await positionManager.setProtocolParamsByAdmin(payload2);

    // need to calculate minFee and maxFee from native to PMX
    // 1 tta=0.2 pmx; 1 tta=0.3 eth -> 1 eth = 0.2/0.3 pmx
    await setupUsdOraclesForTokens(await priceOracle.eth(), PMXToken, parseUnits("0.666", USD_DECIMALS));

    mockReserve = await deployMockReserve(deployer);
    mockRegistry = await deployMockAccessControl(deployer);
    mockPrimexDns = await deployMockPrimexDNS(deployer);
    mockTraderBalanceVault = await deployMockTraderBalanceVault(deployer);
    [mockPriceOracle] = await deployMockPriceOracle(deployer);
    mockKeeperRewardDistributor = await deployMockKeeperRewardDistributor(deployer);
    mockSpotTradingRewardDistributor = await deployMockSpotTradingRewardDistributor(deployer);

    multiplierA = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsA));
    multiplierB = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsB));
    multiplierX = BigNumber.from("10").pow(MAX_TOKEN_DECIMALITY.sub(decimalsX));

    increaseBy = 2628000; // calculated for a year from average 7200 blocks per day on Ethereum

    depositAmount = parseUnits("25", decimalsA);
    borrowedAmount = parseUnits("25", decimalsA);
    swapSize = depositAmount.add(borrowedAmount);

    const lenderAmount = parseUnits("50", decimalsA);
    await testTokenA.connect(lender).approve(bucket.address, MaxUint256);
    await bucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, lenderAmount, true);
    await testTokenA.connect(trader).approve(positionManager.address, depositAmount.mul(2));
    const deadline = new Date().getTime() + 600;

    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetMegaRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      closeConditions: [],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    };

    const swap = swapSize.mul(multiplierA);
    positionAmount = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
    const amountB = positionAmount.mul(multiplierB);
    const price0 = wadDiv(amountB.toString(), swap.toString()).toString();
    price = BigNumber.from(price0).div(USD_MULTIPLIER);
    await setupUsdOraclesForTokens(testTokenA, testTokenB, price);

    snapshotIdBase = await network.provider.request({
      method: "evm_snapshot",
      params: [],
    });
  });
  afterEach(async function () {
    const deadline = new Date().getTime() + 600;
    firstAssetMegaRoutes[0].shares = 1;
    OpenPositionParams = {
      marginParams: {
        bucket: "bucket1",
        borrowedAmount: borrowedAmount,
        depositInThirdAssetMegaRoutes: [],
      },
      firstAssetMegaRoutes: firstAssetMegaRoutes.concat(),
      depositAsset: testTokenA.address,
      depositAmount: depositAmount,
      isProtocolFeeInPmx: false,
      positionAsset: testTokenB.address,
      amountOutMin: 0,
      deadline: deadline,
      takeDepositFromWallet: true,
      closeConditions: [],
      firstAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      thirdAssetOracleData: [],
      depositSoldAssetOracleData: [],
      positionUsdOracleData: getEncodedChainlinkRouteToUsd(),
      nativePositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      pmxPositionAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenB),
      nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
      pullOracleData: [],
      pullOracleTypes: [],
    };
  });
  it("Should initialize with correct values", async function () {
    expect(await positionManager.primexDNS()).to.equal(PrimexDNS.address);
  });

  describe("initialize", function () {
    let snapshotId, registry, PMFactory, args;
    before(async function () {
      // to hide OZ warnings
      await upgrades.silenceWarnings();
      registry = await getContract("Registry");
      PMFactory = await getContractFactory("PositionManager", {
        libraries: {
          PositionLibrary: positionLibrary.address,
          TokenTransfersLibrary: tokenTransfersLibrary.address,
        },
      });
    });

    beforeEach(async function () {
      args = [
        registry.address,
        PrimexDNS.address,
        traderBalanceVault.address,
        priceOracle.address,
        KeeperRewardDistributor.address,
        whiteBlackList.address,
        positionManagerExtension.address,
      ];
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

    it("Should deploy", async function () {
      expect(
        await upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      );
    });

    it("Should revert deploy when registry address not supported", async function () {
      await mockRegistry.mock.supportsInterface.returns(false);
      args[0] = mockRegistry.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when dns address not supported", async function () {
      await mockPrimexDns.mock.supportsInterface.returns(false);
      args[1] = mockPrimexDns.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when traderBalanceVault address not supported", async function () {
      await mockTraderBalanceVault.mock.supportsInterface.returns(false);
      args[2] = mockTraderBalanceVault.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should revert deploy when priceOracle address not supported", async function () {
      await mockPriceOracle.mock.supportsInterface.returns(false);
      args[3] = mockPriceOracle.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy when keeperRewardDistributor address not supported", async function () {
      await mockKeeperRewardDistributor.mock.supportsInterface.returns(false);
      args[4] = mockKeeperRewardDistributor.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
    it("Should revert deploy when spotTradingRewardDistributor address not supported", async function () {
      await mockSpotTradingRewardDistributor.mock.supportsInterface.returns(false);
      args[5] = mockSpotTradingRewardDistributor.address;
      await expect(
        upgrades.deployProxy(PMFactory, [...args], { unsafeAllow: ["external-library-linking", "constructor", "delegatecall"] }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });
  });

  describe("sets", function () {
    let snapshotId;
    before(async function () {
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotId],
      });
    });
    describe("SetPositionManagerExtension", function () {
      it("Should set positionManagerExtension and emit event", async function () {
        await expect(positionManager.connect(BigTimelockAdmin).setPositionManagerExtension(positionManagerExtension.address))
          .to.emit(positionManager, "ChangePositionManagerExtension")
          .withArgs(positionManagerExtension.address);
      });

      it("Should revert if not BIG_TIMELOCK_ADMIN call setPositionManagerExtension", async function () {
        await expect(
          positionManager.connect(MediumTimelockAdmin).setPositionManagerExtension(positionManagerExtension.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
      });

      it("Should revert when PositionManagerExtension address not supported", async function () {
        await expect(
          positionManager.connect(BigTimelockAdmin).setPositionManagerExtension(whiteBlackList.address),
        ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
      });
    });

    describe("setMaxPositionSize", function () {
      let token0, token1, amount0, amount1;
      before(async function () {
        token0 = deployer.address;
        token1 = trader.address;
        amount0 = 100;
        amount1 = 200;
      });

      it("Should set maxPositionSize and emit event", async function () {
        const { payload } = await encodeFunctionData("setMaxPositionSize", [token0, token1, amount0, amount1], "PositionManagerExtension");
        await expect(positionManager.connect(SmallTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SetMaxPositionSize")
          .withArgs(token0, token1, amount0, amount1);
        expect(await positionManager.maxPositionSize(token0, token1)).to.equal(amount1);
        expect(await positionManager.maxPositionSize(token1, token0)).to.equal(amount0);
      });

      it("Should revert when addres one of tokens is zero address", async function () {
        const { payload: payload1 } = await encodeFunctionData(
          "setMaxPositionSize",
          [AddressZero, token1, amount0, amount1],
          "PositionManagerExtension",
        );
        const { payload: payload2 } = await encodeFunctionData(
          "setMaxPositionSize",
          [token0, AddressZero, amount0, amount1],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "TOKEN_ADDRESS_IS_ZERO",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload2)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "TOKEN_ADDRESS_IS_ZERO",
        );
      });
      it("Should revert when token addreses are the same", async function () {
        const { payload } = await encodeFunctionData("setMaxPositionSize", [token1, token1, amount0, amount1], "PositionManagerExtension");
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "IDENTICAL_ASSET_ADDRESSES",
        );
      });

      it("Should revert if not SMALL_TIMELOCK_ADMIN call setMaxPositionSize", async function () {
        const { payload } = await encodeFunctionData("setMaxPositionSize", [token0, token1, amount0, amount1], "PositionManagerExtension");
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });
    describe("setMaxPositionSizes", function () {
      let maxPositionSizeParams;
      before(async function () {
        maxPositionSizeParams = {
          token0: deployer.address,
          token1: trader.address,
          amountInToken0: 100,
          amountInToken1: 200,
        };
      });

      it("Should set maxPositionSize and emit event", async function () {
        const { payload } = await encodeFunctionData("setMaxPositionSizes", [[maxPositionSizeParams]], "PositionManagerExtension");
        await expect(positionManager.connect(SmallTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SetMaxPositionSize")
          .withArgs(
            maxPositionSizeParams.token0,
            maxPositionSizeParams.token1,
            maxPositionSizeParams.amountInToken0,
            maxPositionSizeParams.amountInToken1,
          );
        expect(await positionManager.maxPositionSize(maxPositionSizeParams.token0, maxPositionSizeParams.token1)).to.equal(
          maxPositionSizeParams.amountInToken1,
        );
        expect(await positionManager.maxPositionSize(maxPositionSizeParams.token1, maxPositionSizeParams.token0)).to.equal(
          maxPositionSizeParams.amountInToken0,
        );
      });

      it("Should revert when addres one of tokens is zero address", async function () {
        const { payload: payload1 } = await encodeFunctionData(
          "setMaxPositionSizes",
          [[{ ...maxPositionSizeParams, token0: AddressZero }]],
          "PositionManagerExtension",
        );
        const { payload: payload2 } = await encodeFunctionData(
          "setMaxPositionSizes",
          [[{ ...maxPositionSizeParams, token1: AddressZero }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "TOKEN_ADDRESS_IS_ZERO",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload2)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "TOKEN_ADDRESS_IS_ZERO",
        );
      });
      it("Should revert when token addreses are the same", async function () {
        const { payload } = await encodeFunctionData(
          "setMaxPositionSizes",
          [[{ ...maxPositionSizeParams, token0: testTokenA.address, token1: testTokenA.address }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "IDENTICAL_ASSET_ADDRESSES",
        );
      });

      it("Should revert if not SMALL_TIMELOCK_ADMIN call setMaxPositionSizes", async function () {
        const { payload } = await encodeFunctionData("setMaxPositionSizes", [[maxPositionSizeParams]], "PositionManagerExtension");
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });

    describe("setDefaultOracleTolerableLimit", function () {
      it("Should set DefaultOracleTolerableLimit", async function () {
        const { payload } = await encodeFunctionData("setDefaultOracleTolerableLimit", [0], "PositionManagerExtension");
        await expect(positionManager.connect(MediumTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SetDefaultOracleTolerableLimit")
          .withArgs(0);
        expect(await positionManager.defaultOracleTolerableLimit()).to.equal(0);
      });

      it("Should revert when the precent of the price difference is more WAD", async function () {
        const { payload } = await encodeFunctionData(
          "setDefaultOracleTolerableLimit",
          [BigNumber.from(WAD).add(1)],
          "PositionManagerExtension",
        );
        await expect(positionManager.setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_PERCENT_NUMBER",
        );
      });

      it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setDefaultOracleTolerableLimit", async function () {
        const { payload } = await encodeFunctionData("setDefaultOracleTolerableLimit", [0], "PositionManagerExtension");
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });

    describe("setSecurityBuffer", function () {
      it("Should set securityBuffer", async function () {
        const newSecurityBuffer = parseEther("0.2");
        expect(await positionManager.securityBuffer()).to.equal(parseEther("0.1"));

        const { payload } = await encodeFunctionData("setSecurityBuffer", [newSecurityBuffer], "PositionManagerExtension");
        await expect(positionManager.connect(MediumTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SecurityBufferChanged")
          .withArgs(newSecurityBuffer);
      });

      it("Should revert when newSecurityBucket is more WAD", async function () {
        const newSecurityBuffer = parseEther("1.1");
        const { payload } = await encodeFunctionData("setSecurityBuffer", [newSecurityBuffer], "PositionManagerExtension");
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_SECURITY_BUFFER",
        );
      });

      it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setSecurityBuffer", async function () {
        const { payload } = await encodeFunctionData("setSecurityBuffer", [0], "PositionManagerExtension");
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });

    describe("setMaintenanceBuffer", function () {
      it("Should set maintenanceBuffer", async function () {
        const newMaintenanceBuffer = parseEther("0.2");
        expect(await positionManager.maintenanceBuffer()).to.equal(parseEther("0.1"));
        const { payload } = await encodeFunctionData("setMaintenanceBuffer", [newMaintenanceBuffer], "PositionManagerExtension");
        await expect(positionManager.connect(MediumTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "MaintenanceBufferChanged")
          .withArgs(newMaintenanceBuffer);
      });

      it("Should revert when newMaintenanceBuffer is more WAD", async function () {
        const newMaintenanceBuffer = parseEther("1.1");
        const { payload } = await encodeFunctionData("setMaintenanceBuffer", [newMaintenanceBuffer], "PositionManagerExtension");
        await expect(positionManager.setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_MAINTENANCE_BUFFER",
        );
      });

      it("Should revert when newMaintenanceBuffer is zero", async function () {
        const { payload } = await encodeFunctionData("setMaintenanceBuffer", [0], "PositionManagerExtension");
        await expect(positionManager.setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_MAINTENANCE_BUFFER",
        );
      });

      it("Should revert if not MEDIUM_TIMELOCK_ADMIN call setMaintenanceBuffer", async function () {
        const { payload } = await encodeFunctionData("setMaintenanceBuffer", [0], "PositionManagerExtension");
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });
    describe("setOracleTolerableLimits", function () {
      it("Should set setOracleTolerableLimits", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: testTokenB.address, percent: WAD.toString() }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(SmallTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SetOracleTolerableLimit")
          .withArgs(testTokenA.address, testTokenB.address, WAD.toString());
        expect(await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address)).to.equal(WAD.toString());
        expect(await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address)).to.equal(WAD.toString());
      });

      it("Should revert when the precent of the price difference is more WAD", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: testTokenB.address, percent: BigNumber.from(WAD).add("1") }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_PERCENT_NUMBER",
        );
      });
      it("Should revert when the percent is equal to zero", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: testTokenB.address, percent: 0 }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_PERCENT_NUMBER",
        );
      });
      it("Should revert when one of the assets is equal to zero", async function () {
        const { payload: payload1 } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: AddressZero, assetB: testTokenB.address, percent: WAD.toString() }]],
          "PositionManagerExtension",
        );
        const { payload: payload2 } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: AddressZero, percent: WAD.toString() }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ASSET_ADDRESS_NOT_SUPPORTED",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload2)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ASSET_ADDRESS_NOT_SUPPORTED",
        );
      });
      it("Should revert when the asset addresses are identical", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: testTokenA.address, percent: WAD.toString() }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "IDENTICAL_ASSET_ADDRESSES",
        );
      });
      it("Should revert if not SMALL_TIMELOCK_ADMIN call setOracleTolerableLimits", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimits",
          [[{ assetA: testTokenA.address, assetB: testTokenB.address, percent: WAD.toString() }]],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });
    describe("setOracleTolerableLimit", function () {
      it("Should set OracleTolerableLimit", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, WAD.toString()],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(SmallTimelockAdmin).setProtocolParamsByAdmin(payload))
          .to.emit(positionManager, "SetOracleTolerableLimit")
          .withArgs(testTokenA.address, testTokenB.address, WAD.toString());
        expect(await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address)).to.equal(WAD.toString());
        expect(await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address)).to.equal(WAD.toString());
      });

      it("Should revert when the precent of the price difference is more WAD", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, BigNumber.from(WAD).add(1)],
          "PositionManagerExtension",
        );
        await expect(positionManager.setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_PERCENT_NUMBER",
        );
      });
      it("Should revert when the percent is equal to zero", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, 0],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "INVALID_PERCENT_NUMBER",
        );
      });
      it("Should revert when one of the assets is equal to zero", async function () {
        const { payload: payload1 } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [AddressZero, testTokenB.address, WAD.toString()],
          "PositionManagerExtension",
        );
        const { payload: payload2 } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenB.address, AddressZero, WAD.toString()],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload1)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ASSET_ADDRESS_NOT_SUPPORTED",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload2)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "ASSET_ADDRESS_NOT_SUPPORTED",
        );
      });
      it("Should revert when the asset addresses are identical", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenA.address, WAD.toString()],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(deployer).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "IDENTICAL_ASSET_ADDRESSES",
        );
      });
      it("Should revert if not SMALL_TIMELOCK_ADMIN call setOracleTolerableLimit", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, WAD.toString()],
          "PositionManagerExtension",
        );
        await expect(positionManager.connect(caller).setProtocolParamsByAdmin(payload)).to.be.revertedWithCustomError(
          ErrorsLibrary,
          "FORBIDDEN",
        );
      });
    });
    describe("getOracleTolerableLimit", function () {
      it("Should return the correct OracleTolerableLimit", async function () {
        const { payload } = await encodeFunctionData(
          "setOracleTolerableLimit",
          [testTokenA.address, testTokenB.address, 1],
          "PositionManagerExtension",
        );
        await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
        expect(await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenB.address)).to.equal(1);
        expect(await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address)).to.equal(1);
      });
      it("Should return the default value", async function () {
        expect(await positionManager.getOracleTolerableLimit(testTokenA.address, testTokenX.address)).to.equal(
          await positionManager.defaultOracleTolerableLimit(),
        );
      });
    });
  });

  describe("openPosition", function () {
    let snapshotId, amountB;
    before(async function () {
      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    beforeEach(async function () {
      OpenPositionParams.takeDepositFromWallet = false;

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
    it("Should revert open position when the msg.sender is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(positionManager.connect(mockContract).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });
    it("Should revert open position when the positionManager is paused", async function () {
      await positionManager.pause();
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWith("Pausable: paused");
    });
    it("Should be reverted when the ancillary data is incorrect", async function () {
      if (dex !== "uniswapv3") this.skip();
      OpenPositionParams.firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, 1, ["9000"]);
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "REVERTED_WITHOUT_A_STRING_TRY_TO_CHECK_THE_ANCILLARY_DATA",
      );
    });

    it("Should revert open position when token (testTokenX) not allowed", async function () {
      OpenPositionParams.positionAsset = testTokenX.address;
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "TOKEN_NOT_SUPPORTED",
      );
    });

    it("Should revert open position when the bucket is inactive", async function () {
      await PrimexDNS.deprecateBucket("bucket1");
      OpenPositionParams.positionAsset = testTokenX.address;
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "BUCKET_IS_INACTIVE",
      );
    });

    it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%", async function () {
      await setBadOraclePrice(testTokenA, testTokenB);
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should be revert when the dex price is less than the oracle price by OracleTolerableLimit + 5%", async function () {
      const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, differentPrice],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      await setBadOraclePrice(testTokenA, testTokenB, fivePercent, differentPrice);

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should revert openPosition when firstAssetMegaRoutes is empty list", async function () {
      OpenPositionParams.firstAssetMegaRoutes = [];
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });
    it("Should revert openPosition when depositInThirdAssetMegaRoutes is not empty list and depositAsset is borrowedAsset", async function () {
      OpenPositionParams.marginParams.depositInThirdAssetMegaRoutes = firstAssetMegaRoutes;

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DEPOSIT_IN_THIRD_ASSET_ROUTES_LENGTH_SHOULD_BE_0",
      );
    });

    it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
      const amount0Out = await getAmountsOut(dex, borrowedAmount.add(depositAmount), [testTokenA.address, testTokenB.address]);
      const amountOutMin = amount0Out.add(1);
      OpenPositionParams.amountOutMin = amountOutMin;
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SLIPPAGE_TOLERANCE_EXCEEDED",
      );
    });

    it("Should revert when firstAssetMegaRoutes summ of shares is 0", async function () {
      OpenPositionParams.firstAssetMegaRoutes[0].shares = 0;

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });

    it("Should revert when closingManagerAddresses has duplicates", async function () {
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, 0)),
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, 0)),
      ];

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SHOULD_NOT_HAVE_DUPLICATES",
      );
    });

    it("Should revert when closingManagerAddresses does not have CCM role", async function () {
      OpenPositionParams.closeConditions = [getCondition(LIMIT_PRICE_CM_TYPE, getTakeProfitStopLossParams(0, 0))];

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SHOULD_BE_CCM",
      );
    });

    it("Should revert when trader balance in traderBalanceVault is smaller then depositAmount", async function () {
      OpenPositionParams.depositAmount = OpenPositionParams.depositAmount.add(parseUnits("1", decimalsA));
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_FREE_ASSETS",
      );
    });

    it("Should revert openPosition is POSITION_SIZE_EXCEEDED", async function () {
      const { payload } = await encodeFunctionData(
        "setMaxPositionSize",
        [testTokenA.address, testTokenB.address, 0, 0],
        "PositionManagerExtension",
      );
      await positionManager.setProtocolParamsByAdmin(payload);

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_SIZE_EXCEEDED",
      );
    });

    it("Should revert position creation if deposit asset is the native token", async function () {
      // const value = parseEther("30");
      // await traderBalanceVault.connect(trader).deposit(NATIVE_CURRENCY, 0, {
      //   value: value,
      // });
      // OpenPositionParams.depositAsset = await priceOracle.eth();
      // OpenPositionParams.depositAmount = value.div(2);
      // tracer.enabled = true;
      // // const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      // //   libraries: {
      // //     PrimexPricingLibrary: primexPricingLibrary.address,
      // //   },
      // // });
      // // const primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
      // // await primexPricingLibraryMock.deployed();
      // // const v = await primexPricingLibraryMock.callStatic.getOracleAmountsOut(
      // //   "0x99ec76235f8a5A52611b0DA5F0C6B09e1dCD2C9e",
      // //   "0xeF31027350Be2c7439C1b0BE022d49421488b72C",
      // //   '15000000000000000000',
      // //   "0x922D6956C99E12DFeB3224DEA977D0939758A1Fe",
      // //   getEncodedChainlinkRouteViaUsd(testTokenA)
      // //   )
      // // return;
      // await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.revertedWithCustomError(
      //   ErrorsLibrary,
      //   "NATIVE_CURRENCY_CANNOT_BE_ASSET",
      // );
    });

    it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      OpenPositionParams.marginParams.borrowedAmount = OpenPositionParams.marginParams.borrowedAmount.div(2);
      OpenPositionParams.depositAmount = OpenPositionParams.depositAmount.div(2);

      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      const swap = swapSize.mul(multiplierA);
      let amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);

      let limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      OpenPositionParams.amountOutMin = amount0Out;

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      OpenPositionParams.amountOutMin = amount0Out.sub(1);
      limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });

    it("Should create 'Position' and transfer testTokenA from 'Bucket' to 'Pair'", async function () {
      await expect(() => positionManager.connect(trader).openPosition(OpenPositionParams)).to.changeTokenBalances(
        testTokenA,
        [bucket, pair],
        [borrowedAmount.mul(NegativeOne), borrowedAmount.add(depositAmount)],
      );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should create position and increase traders count, and add traderPositions", async function () {
      const amount0Out = await getAmountsOut(dex, borrowedAmount.add(depositAmount), [testTokenA.address, testTokenB.address]);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      const borrowIndex = await bucket.variableBorrowIndex();
      const scaledDebtAmount = rayDiv(borrowedAmount.toString(), borrowIndex.toString()).toString();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      const position = await positionManager.getPosition(0);
      expect(position.scaledDebtAmount).to.equal(scaledDebtAmount);
      expect(position.depositAmountInSoldAsset).to.equal(depositAmount);
      expect(position.bucket).to.equal(bucket.address);
      expect(position.positionAsset).to.equal(testTokenB.address);
      expect(position.positionAmount).to.equal(amount0Out);
      expect(position.trader).to.equal(trader.address);
      expect(position.openBorrowIndex).to.equal(borrowIndex);
    });

    it("Should create three position with different time intervals between and add correct borrowIndex in position. Success close positions", async function () {
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("5", decimalsA);
      OpenPositionParams.depositAmount = parseUnits("5", decimalsA);

      const borrowedAmount = OpenPositionParams.marginParams.borrowedAmount;
      const depositAmount = OpenPositionParams.depositAmount;

      const swapSize = depositAmount.add(borrowedAmount);
      const swap = swapSize.mul(multiplierA);
      let amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      const price0 = wadDiv(amountB.toString(), swap.toString()).toString();
      const limitPrice0 = BigNumber.from(price0).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, limitPrice0);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      let borrowIndex = await bucket.variableBorrowIndex();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      let position = await positionManager.getPosition(0);
      expect(position.openBorrowIndex).to.equal(borrowIndex);

      amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      const price1 = wadDiv(amountB.toString(), swap.toString()).toString();
      const limitPrice1 = BigNumber.from(price1).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, limitPrice1);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      borrowIndex = await bucket.variableBorrowIndex();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(2);
      position = await positionManager.getPosition(1);
      expect(position.openBorrowIndex).to.equal(borrowIndex);

      for (let i = 0; i < 10; i++) {
        await network.provider.send("evm_mine");
      }

      amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      const price2 = wadDiv(amountB.toString(), swap.toString()).toString();
      const limitPrice2 = BigNumber.from(price2).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, limitPrice2);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      borrowIndex = await bucket.variableBorrowIndex();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(3);
      position = await positionManager.getPosition(2);
      expect(position.openBorrowIndex).to.equal(borrowIndex);

      expect(
        await positionManager
          .connect(trader)
          .closePosition(
            2,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      );
      await setOraclePrice(testTokenA, testTokenB, limitPrice1);
      expect(
        await positionManager
          .connect(trader)
          .closePosition(
            1,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      );
      await setOraclePrice(testTokenA, testTokenB, limitPrice0);
      expect(
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      );
    });

    it("Should open position and throw event", async function () {
      const positionId = 0;
      const txOpenPosition = await positionManager.connect(trader).openPosition(OpenPositionParams);

      const leverage = wadDiv(borrowedAmount.add(depositAmount).toString(), depositAmount.toString()).toString();

      const position = await positionManager.getPosition(0);

      let entryPrice = wadDiv(
        borrowedAmount.add(depositAmount).mul(multiplierA).toString(),
        position.positionAmount.mul(multiplierB).toString(),
      ).toString();
      entryPrice = BigNumber.from(entryPrice).div(multiplierA);

      const expectedArguments = {
        positionId: positionId,
        trader: trader.address,
        openedBy: trader.address,
        position: position,
        entryPrice: entryPrice,
        leverage: leverage,
        closeConditions: [],
      };

      eventValidation("OpenPosition", await txOpenPosition.wait(), expectedArguments);
    });

    it("Should open position with stopLoss price > liquidation price", async function () {
      const amountOut = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const liquidationPrice = await primexPricingLibrary.getLiquidationPrice(
        bucketAddress,
        testTokenB.address,
        amountOut,
        borrowedAmount,
        PrimexDNS.address,
      );
      const liquidationPriceInWad = liquidationPrice.mul(multiplierA);
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(0, liquidationPriceInWad.add(1))),
      ];

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("positions", function () {
    let snapshotId;
    before(async function () {
      const traderAmount = parseUnits("15", decimalsA);

      await testTokenA.connect(trader).approve(traderBalanceVault.address, traderAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, traderAmount);
      await testTokenA.connect(lender).approve(traderBalanceVault.address, traderAmount);
      await traderBalanceVault.connect(lender).deposit(testTokenA.address, traderAmount);

      const bucketName2 = "bucket2";
      const assets = [testTokenB.address];
      const underlyingAsset = testTokenA.address;
      const feeBuffer = "1000200000000000000"; // 1.0002
      const withdrawalFeeRate = "5000000000000000"; // 0.005 - 0.5%
      const reserveRate = "100000000000000000"; // 0.1 - 10%
      const estimatedBar = "100000000000000000000000000"; // 0.1 in ray
      const estimatedLar = "70000000000000000000000000"; // 0.07 in ray
      const BucketsFactory = await getContract("BucketsFactoryV2");

      const txCreateBucket = await BucketsFactory.createBucket({
        nameBucket: bucketName2,
        positionManager: positionManager.address,
        priceOracle: priceOracle.address,
        dns: PrimexDNS.address,
        reserve: mockReserve.address,
        tokenTransfersLibrary: tokenTransfersLibrary.address,
        assets: assets,
        underlyingAsset: underlyingAsset,
        feeBuffer: feeBuffer,
        whiteBlackList: whiteBlackList.address,
        withdrawalFeeRate: withdrawalFeeRate,
        reserveRate: reserveRate,
        liquidityMiningRewardDistributor: AddressZero,
        liquidityMiningAmount: 0,
        liquidityMiningDeadline: 0,
        stabilizationDuration: 0,
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
      await PrimexDNS.addBucket(newBucketAddress, 0);

      const newBucket = await getContractAt("Bucket", newBucketAddress);
      await testTokenA.connect(lender).approve(newBucketAddress, MaxUint256);
      await newBucket.connect(lender)["deposit(address,uint256,bool)"](lender.address, parseUnits("50", decimalsA), true);

      const borrowedAmount = parseUnits("0.008", decimalsA);
      const depositAmount = parseUnits("0.006", decimalsA);
      const swapSize = depositAmount.add(borrowedAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      OpenPositionParams.depositAmount = depositAmount;
      OpenPositionParams.takeDepositFromWallet = false;

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      OpenPositionParams.marginParams.bucket = "bucket2";

      await positionManager.connect(lender).openPosition(OpenPositionParams);

      await positionManager.connect(lender).openPosition(OpenPositionParams);

      await positionManager.connect(lender).openPosition(OpenPositionParams);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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

    it("should revert if position does not exist", async function () {
      const positionId = 10;
      await expect(positionManager.getPosition(positionId)).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });

    it("Should have correct position count for different traders", async function () {
      let firstTraderPositions = await positionManager.getTraderPositionsLength(trader.address);
      expect(firstTraderPositions).to.equal(3);
      let secondTraderPositions = await positionManager.getTraderPositionsLength(lender.address);
      expect(secondTraderPositions).to.equal(3);

      await positionManager
        .connect(lender)
        .closePosition(
          3,
          lender.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      firstTraderPositions = await positionManager.getTraderPositionsLength(trader.address);
      expect(firstTraderPositions).to.equal(3);
      secondTraderPositions = await positionManager.getTraderPositionsLength(lender.address);
      expect(secondTraderPositions).to.equal(2);
    });

    it("Should have correct position count for different buckets", async function () {
      await positionManager
        .connect(lender)
        .closePosition(
          4,
          lender.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await positionManager.getBucketPositionsLength(bucketAddress)).to.equal(1);
      expect(await positionManager.getBucketPositionsLength(newBucketAddress)).to.equal(3);
    });

    it("Should have correct position indexes", async function () {
      // it's temporary solution because the positionIndexes function has become internal
      this.skip();
      expect(await positionManager.positionIndexes(5)).to.equal(5);

      await positionManager
        .connect(trader)
        .closePosition(
          1,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await positionManager.getAllPositionsLength()).to.equal(5);
      expect(await positionManager.positionIndexes(5)).to.equal(1);
    });

    it("Should have correct position indexes for trader", async function () {
      // it's temporary solution because the traderPositionIds function has become internal
      this.skip();
      expect(await positionManager.traderPositionIds(trader.address, 2)).to.equal(5);
      expect(await positionManager.traderPositionIds(trader.address, 1)).to.equal(1);
      expect(await positionManager.traderPositionIds(trader.address, 0)).to.equal(0);
      expect(await positionManager.traderPositionIndexes(5)).to.equal(2);
      expect(await positionManager.traderPositionIndexes(1)).to.equal(1);
      expect(await positionManager.traderPositionIndexes(0)).to.equal(0);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(2);
      expect(await positionManager.traderPositionIds(trader.address, 1)).to.equal(1);
      expect(await positionManager.traderPositionIds(trader.address, 0)).to.equal(5);
      expect(await positionManager.traderPositionIndexes(5)).to.equal(0);
      expect(await positionManager.traderPositionIndexes(1)).to.equal(1);
    });

    it("Should have correct position indexes for buckets", async function () {
      // it's temporary solution because the bucketPositionIds function has become internal
      this.skip();
      expect(await positionManager.bucketPositionIds(newBucketAddress, 3)).to.equal(5);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 2)).to.equal(4);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 1)).to.equal(3);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 0)).to.equal(2);
      expect(await positionManager.bucketPositionIndexes(5)).to.equal(3);
      expect(await positionManager.bucketPositionIndexes(4)).to.equal(2);
      expect(await positionManager.bucketPositionIndexes(3)).to.equal(1);
      expect(await positionManager.bucketPositionIndexes(2)).to.equal(0);

      await positionManager
        .connect(lender)
        .closePosition(
          3,
          lender.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await positionManager.getBucketPositionsLength(newBucketAddress)).to.equal(3);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 2)).to.equal(4);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 1)).to.equal(5);
      expect(await positionManager.bucketPositionIds(newBucketAddress, 0)).to.equal(2);
      expect(await positionManager.bucketPositionIndexes(5)).to.equal(1);
      expect(await positionManager.bucketPositionIndexes(4)).to.equal(2);
      expect(await positionManager.bucketPositionIndexes(2)).to.equal(0);
    });
  });

  describe("openPosition with deposit", function () {
    let snapshotId, amountB;

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    beforeEach(async function () {
      OpenPositionParams.takeDepositFromWallet = true;

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
    it("Should revert open position when the amount of tokens received is smaller amountOutMin", async function () {
      OpenPositionParams.amountOutMin = positionAmount.add(1);
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SLIPPAGE_TOLERANCE_EXCEEDED",
      );
    });

    it("Should revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit +5%", async function () {
      await setBadOraclePrice(testTokenA, testTokenB);

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit +5%", async function () {
      const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, differentPrice],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      await setBadOraclePrice(testTokenA, testTokenB, fivePercent, differentPrice);

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });
    it("Should open position when the amount of tokens received is equal or more amountOutMin", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      OpenPositionParams.marginParams.borrowedAmount = OpenPositionParams.marginParams.borrowedAmount.div(2);
      OpenPositionParams.depositAmount = OpenPositionParams.depositAmount.div(2);
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      const swap = swapSize.mul(multiplierA);
      let amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      OpenPositionParams.amountOutMin = amount0Out;

      let limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      let price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);

      amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      amountB = amount0Out.mul(multiplierB);
      OpenPositionParams.amountOutMin = amount0Out;

      limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });
    it("Should transfer tokens to traderBalanceVault, as collateral for deal", async function () {
      const { availableBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableBalance).to.equal(0);

      await expect(() => positionManager.connect(trader).openPosition(OpenPositionParams)).to.changeTokenBalance(
        testTokenA,
        trader,
        OpenPositionParams.depositAmount.mul(NegativeOne),
      );

      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableAfter).to.equal(0);
    });

    it("Should revert when deposit Amount insufficient for deal", async function () {
      OpenPositionParams.depositAmount = parseUnits("1", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = parseUnits("30", decimalsA);

      const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableBalance).to.equal(0);
      expect(lockedBalance).to.equal(0);

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_DEPOSIT",
      );

      const { availableBalance: availableAfter, lockedBalance: lockedAfter } = await traderBalanceVault.balances(
        trader.address,
        testTokenA.address,
      );
      expect(availableAfter).to.equal(0);
      expect(lockedAfter).to.equal(0);
    });
  });

  describe("openPosition with minPositionSize", function () {
    let snapshotId, tokenWETH;
    before(async function () {
      await run("deploy:ERC20Mock", {
        name: "Wrapped Ether",
        symbol: "WETH",
        decimals: "18",
      });
      tokenWETH = await getContract("Wrapped Ether");

      await setupUsdOraclesForTokens(testTokenA, tokenWETH, parseUnits("1", USD_DECIMALS));
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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

    it("Should revert when position size < minPositionSize", async function () {
      const depositAmount = parseUnits("0.01", decimalsA);
      const borrowedAmount = parseUnits("0.02", decimalsA);
      const swapSize = depositAmount.add(borrowedAmount);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const limitPrice = wadDiv(amount0Out.toString(), swapSize.toString()).toString();
      await setOraclePrice(testTokenA, testTokenB, BigNumber.from(limitPrice).div(USD_MULTIPLIER));

      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      OpenPositionParams.depositAmount = depositAmount;
      const gasPrice = parseUnits("1000", "gwei");
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams, { gasPrice: gasPrice })).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_POSITION_SIZE",
      );
    });

    it("Should revert when position size < minPositionSize and correctrly calculate minPositionSize", async function () {
      await PrimexDNS.setProtocolFeeCoefficient(parseUnits("10", "gwei"));
      const minPositionSize = await calculateMinPositionSize(
        TradingOrderType.MarginMarketOrder,
        testTokenA.address,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const depositAmount = minPositionSize.div(2).sub(10);
      const borrowedAmount = minPositionSize.div(2);
      const swapSize = depositAmount.add(borrowedAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);

      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      OpenPositionParams.depositAmount = depositAmount;
      await setOraclePrice(testTokenA, testTokenB, price);
      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INSUFFICIENT_POSITION_SIZE",
      );
    });

    it("Should open position when position size >= minPositionSize", async function () {
      const depositAmount = parseUnits("1.5", decimalsA);
      const borrowedAmount = parseUnits("2", decimalsA);
      const swapSize = depositAmount.add(borrowedAmount);
      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      OpenPositionParams.depositAmount = depositAmount;

      await expect(positionManager.connect(trader).openPosition(OpenPositionParams)).to.emit(positionManager, "OpenPosition");
    });
  });

  describe("closePositionByCondition", function () {
    let params;
    before(async function () {
      // open position without close conditions;
      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });
    beforeEach(async function () {
      params = {
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: 0,
        ccmAdditionalParams: [],
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      };
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    it("Should revert if the msg.sender is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      params.ccmAdditionalParams = getTakeProfitStopLossAdditionalParams(
        megaRoutesForClose,
        await getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      await expect(positionManager.connect(mockContract).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SENDER_IS_BLACKLISTED",
      );
    });

    it("Should revert if CloseReason == CLOSE_BY_TRADER", async function () {
      params.ccmAdditionalParams = getTakeProfitStopLossAdditionalParams(
        megaRoutesForClose,
        await getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      params.closeReason = CloseReason.CLOSE_BY_TRADER;
      await expect(positionManager.connect(mockContract).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "FORBIDDEN",
      );
    });

    it("Should revert if conditional manager is AddressZero", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      params.ccmAdditionalParams = getTakeProfitStopLossAdditionalParams(
        megaRoutesForClose,
        await getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "INCORRECT_CM_TYPE",
      );
    });
  });

  describe("closePosition", function () {
    let snapshotId, registry;
    let positionSoldAssetOracleData, pmxSoldAssetOracleData, nativeSoldAssetOracleData;
    before(async function () {
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      registry = await getContract("Registry");
      positionSoldAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenA);
      pmxSoldAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenA);
      nativeSoldAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenA);
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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

    it("Should revert when summ of shares is 0", async function () {
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, [], 0),
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Shouldn't close position and throw revert if called by the NON-owner", async function () {
      await expect(
        positionManager
          .connect(lender)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.reverted;
    });
    it("Shouldn't close position and throw revert if the msg.sender is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        positionManager
          .connect(mockContract)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert if SHARESONDEX_LENGTH_IS_0", async function () {
      await expect(
        positionManager
          .connect(trader)
          .closePosition(0, trader.address, [], 0, positionSoldAssetOracleData, pmxSoldAssetOracleData, nativeSoldAssetOracleData, [], []),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
      await expect(
        positionManager
          .connect(trader)
          .closePosition(0, trader.address, [], 0, positionSoldAssetOracleData, pmxSoldAssetOracleData, nativeSoldAssetOracleData, [], []),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Should revert if deposit receiver is zero address", async function () {
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            AddressZero,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "ADDRESS_NOT_SUPPORTED");
    });

    it("Should close position and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      await expect(() =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenB, [positionManager, pair], [positionAmount.mul(NegativeOne), positionAmount]);
    });

    it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%", async function () {
      await setBadOraclePrice(testTokenB, testTokenA);
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("Should not revert if called by a trustedAddress when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%", async function () {
      await registry.grantRole(TRUSTED_TOLERABLE_LIMIT_ROLE, trader.address);
      expect(await registry.hasRole(TRUSTED_TOLERABLE_LIMIT_ROLE, trader.address)).to.equal(true);
      expect(
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      );
    });

    it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
      const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, differentPrice],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);
      await setBadOraclePrice(testTokenB, testTokenA, fivePercent, differentPrice);
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DIFFERENT_PRICE_DEX_AND_ORACLE");
    });

    it("Should close position and transfer testTokenA from 'Pair'", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);

      if (dex === "quickswapv3") {
        const balanceBefore = await testTokenA.balanceOf(pair.address);
        await positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          );
        const balanceAfter = await testTokenA.balanceOf(pair.address);
        // 1%
        const delta = wadMul(amount0Out.toString(), parseEther("0.01").toString()).toString();
        expect(balanceAfter).to.be.closeTo(balanceBefore.sub(amount0Out), delta);
      } else {
        await expect(() =>
          positionManager
            .connect(trader)
            .closePosition(
              0,
              trader.address,
              megaRoutesForClose,
              0,
              positionSoldAssetOracleData,
              pmxSoldAssetOracleData,
              nativeSoldAssetOracleData,
              [],
              [],
            ),
        ).to.changeTokenBalance(testTokenA, pair, amount0Out.mul(NegativeOne));
      }
    });

    it("Should update pyth oracle via closePosition function", async function () {
      const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
      const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
      const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
      const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
      const pyth = await getContract("MockPyth");

      await priceOracle.updatePythPairId(
        [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
        [tokenAID, tokenBID, nativeID, PMXID],
      );
      // price in 10**8
      const expo = -8;
      const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

      const timeStamp = (await provider.getBlock("latest")).timestamp;
      const updateDataTokenA = await pyth.createPriceFeedUpdateData(
        tokenAID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataTokenB = await pyth.createPriceFeedUpdateData(
        tokenBID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataNative = await pyth.createPriceFeedUpdateData(
        nativeID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataPmx = await pyth.createPriceFeedUpdateData(
        PMXID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]],
          [UpdatePullOracle.Pyth],
          { value: 4 },
        );

      const priceTokenA = await pyth.getPrice(tokenAID);
      const priceTokenB = await pyth.getPrice(tokenBID);
      const priceNative = await pyth.getPrice(nativeID);
      const pricePmx = await pyth.getPrice(PMXID);
      expect(priceTokenA.publishTime)
        .to.be.equal(priceTokenB.publishTime)
        .to.be.equal(priceNative.publishTime)
        .to.be.equal(pricePmx.publishTime)
        .to.be.equal(timeStamp);
      expect(priceTokenA.price)
        .to.be.equal(priceTokenB.price)
        .to.be.equal(priceNative.price)
        .to.be.equal(pricePmx.price)
        .to.be.equal(price);
    });

    it("Should close position and delete trader position from traderPositions list", async function () {
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should close position and fully repay traders debt", async function () {
      const borrowedAmount = OpenPositionParams.marginParams.borrowedAmount;
      expect(await debtTokenA.balanceOf(trader.address)).to.equal(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should close position and fully repay traders debt after n block past", async function () {
      const borrowedAmount = OpenPositionParams.marginParams.borrowedAmount;
      await increaseBlocksBy(increaseBy);
      expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should close position 1 block past and transfer increased full amount (principal + fees) of testTokenA to 'Bucket'", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      await expect(() =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toFixed());
    });

    it("Should close position 1 block past and transfer trader profit from PositionManager to TraderBalanceVault when deal is profit", async function () {
      await network.provider.send("evm_mine");

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("3.5", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const depositAfterDeal = amount0Out.sub(BigNumber.from(positionDebt.toString())).sub(feeInPaymentAsset);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      await expect(() =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, depositAfterDeal);

      const { availableBalance, lockedBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(depositAfterDeal).to.equal(availableBalance);
      expect(0).to.equal(lockedBalance);

      expect(await testTokenA.balanceOf(positionManager.address)).to.equal(0);
      expect(await testTokenB.balanceOf(positionManager.address)).to.equal(0);
    });

    it("Should close position 1 block past and repay to bucket when deal is profit", async function () {
      await network.provider.send("evm_mine");
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("3.5", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      await expect(() =>
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, bucket, positionDebt.toString());
    });

    it("Should close position 1 block past and unlock trader's tokens in deposit Vault", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const { availableBalance: availableABefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );

      const { availableBalance: availableAAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);

      expect(availableABefore).to.equal(0);

      const depositAfterDeal = amount0Out.sub(BigNumber.from(positionDebt.toFixed())).sub(feeInPaymentAsset);
      expect(availableAAfter).to.equal(depositAfterDeal);
    });

    it("Should close position and throw event", async function () {
      await network.provider.send("evm_mine");

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount, depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const tx = await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );
      const expectedClosePosition = {
        positionId: 0,
        trader: trader.address,
        closedBy: trader.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.CLOSE_BY_TRADER,
      };
      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByTrader,
        feeInPaymentAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };

      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });

    it("Should close position if the position asset is removed and return deposit to the trader", async function () {
      await network.provider.send("evm_mine");
      await bucket.removeAsset(testTokenB.address);
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const { positionAmount, depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);

      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const tx = await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );
      const expectedClosePosition = {
        positionI: 0,
        trader: trader.address,
        closedBy: trader.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.CLOSE_BY_TRADER,
      };
      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      expect(availableBefore).to.equal(0);
      const { availableBalance: availableAAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      const depositAfterClosingPosition = amount0Out.sub(BigNumber.from(positionDebt.toFixed())).sub(feeInPaymentAsset);
      expect(availableAAfter).to.equal(depositAfterClosingPosition);
    });

    it("Should close position with amountOutMin less than amountOut", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      // the slippage tolerance is 1%
      const amountOutMin = wadMul(amount0Out.toString(), parseEther("0.99").toString()).toString();

      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            amountOutMin,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.emit(positionLibrary.attach(positionManager.address), "ClosePosition");
    });

    it("Should close position with amountOutMin equal to amountOut", async function () {
      // Since the quickswapv3 has a dynamic fee system the amount0Out from the Quoter may differ from the actual amountOut in swap in separate transactions
      if (dex === "quickswapv3") this.skip();
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);

      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            amount0Out,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.emit(positionLibrary.attach(positionManager.address), "ClosePosition");
    });

    it("Should revert when amountOutMin greater than amountOut", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountOutMin = amount0Out.add(1);

      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            amountOutMin,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
    });

    it("Should close position with amountOutMin less or equal to amountOut on another dex", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out2 = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out2.mul(multiplierA);
      let amountOutMin = amount0Out2.add(1);

      const limitPrice = wadDiv(amountA.toString(), amountB.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, price);

      const assetRoutes2 = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex2);
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            assetRoutes2,
            amountOutMin,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.be.reverted;

      amountOutMin = amount0Out2;
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          assetRoutes2,
          amountOutMin,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );
    });

    it("Should close position and the treasury receive fee amount in payment asset", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, Treasury, feeInPaymentAsset);
    });
    it("Should close position and the treasury receive fee amount in payment asset when the trader has a non-default tier", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);

      await PMXToken.transfer(trader.address, firstNotDefaultThreshold);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, firstNotDefaultThreshold);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, firstNotDefaultThreshold);

      expect(await TiersManager.getTraderTierForAddress(trader.address)).to.be.equal(firstNotDefaultTier);

      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        undefined,
        firstNotDefaultTier,
      );
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, Treasury, feeInPaymentAsset);
    });
    it("Should close position and the treasury receive fee amount in PMX when isProtocolFeeInPmx = true", async function () {
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );
      const params = { ...OpenPositionParams, isProtocolFeeInPmx: true };
      await positionManager.connect(trader).openPosition(params);

      const { positionAmount } = await positionManager.getPosition(1);

      await PMXToken.transfer(trader.address, parseEther("1"));
      await PMXToken.connect(trader).approve(traderBalanceVault.address, parseEther("1"));
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, parseEther("1"));

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
      const feeInPaymentAssetWithDiscount = wadMul(feeInPaymentAsset.toString(), pmxDiscountMultiplier.toString()).toString();
      const feeAmountInPmx = await calculateFeeAmountInPmx(
        testTokenA.address,
        PMXToken.address,
        feeInPaymentAssetWithDiscount,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      );
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            1,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(PMXToken, Treasury, feeAmountInPmx.sub(1));
    });
    it("Closes position, transfers fee to treasury in PMX and paymentAsset when isProtocolFeeInPmx = true, but trader lacks PMX balance in vault", async function () {
      await positionManager
        .connect(trader)
        .closePosition(
          0,
          trader.address,
          megaRoutesForClose,
          0,
          positionSoldAssetOracleData,
          pmxSoldAssetOracleData,
          nativeSoldAssetOracleData,
          [],
          [],
        );

      const params = { ...OpenPositionParams, isProtocolFeeInPmx: true };
      await positionManager.connect(trader).openPosition(params);

      const { positionAmount } = await positionManager.getPosition(1);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const pmxDiscountMultiplier = await PrimexDNS.pmxDiscountMultiplier();
      const feeInPositonAssetWithDiscount = wadMul(feeInPaymentAsset.toString(), pmxDiscountMultiplier.toString()).toString();
      const feeAmountInPmx = await calculateFeeAmountInPmx(
        testTokenA.address,
        PMXToken.address,
        feeInPositonAssetWithDiscount,
        getEncodedChainlinkRouteViaUsd(PMXToken),
      );

      await PMXToken.transfer(trader.address, feeAmountInPmx.div(2));
      await PMXToken.connect(trader).approve(traderBalanceVault.address, feeAmountInPmx.div(2));
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, feeAmountInPmx.div(2));
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            1,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      )
        .to.changeTokenBalance(PMXToken, Treasury, feeAmountInPmx.div(2))
        .to.changeTokenBalance(testTokenA, Treasury, feeInPaymentAsset.div(2));
    });

    it("Should close position and correct calculate fee amount in payment asset when feeInPaymentAsset > maxProtocolFee", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const maxProtocolFee = feeInPaymentAsset.sub(10);

      const rate = await getExchangeRateByRoutes(testTokenA, await getEncodedChainlinkRouteViaUsd(await priceOracle.eth()));
      const maxfee = wadMul(maxProtocolFee.toString(), rate.toString()).toString();
      await PrimexDNS.setMaxProtocolFee(maxfee);
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            megaRoutesForClose,
            0,
            positionSoldAssetOracleData,
            pmxSoldAssetOracleData,
            nativeSoldAssetOracleData,
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, Treasury, maxProtocolFee);
    });
  });

  describe("liquidatePosition by SL/TP", function () {
    let snapshotId, stopLossPrice, takeProfitPrice, additionalParams, conditionIndex, params;
    before(async function () {
      conditionIndex = 0;

      stopLossPrice = BigNumber.from(price).sub("1").toString();
      takeProfitPrice = BigNumber.from(price).add("1").toString();

      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
      ];
      await positionManager.connect(trader).openPosition(OpenPositionParams);

      additionalParams = getTakeProfitStopLossAdditionalParams(megaRoutesForClose, await getEncodedChainlinkRouteViaUsd(testTokenA));
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    beforeEach(async function () {
      params = {
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: additionalParams,
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
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

    it("Should revert if SHARESONDEX_LENGTH_IS_0", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      params.megaRoutes = [];

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO",
      );
    });

    it("Should be revert when the dex price is less than the oracle price by DefaultOracleTolerableLimit + 5%", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      await setBadOraclePrice(testTokenB, testTokenA, fivePercent);
      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should be revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      const differentPrice = BigNumber.from(WAD.toString()).div("100"); // 0.01 WAD
      const { payload } = await encodeFunctionData(
        "setOracleTolerableLimit",
        [testTokenA.address, testTokenB.address, differentPrice],
        "PositionManagerExtension",
      );
      await positionManager.connect(deployer).setProtocolParamsByAdmin(payload);

      await setBadOraclePrice(testTokenB, testTokenA, fivePercent, differentPrice);
      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });

    it("Should revert when _sharesOnDex summ of shares is 0", async function () {
      await expect(
        positionManager
          .connect(trader)
          .closePosition(
            0,
            trader.address,
            await getSingleMegaRoute([testTokenA.address, testTokenB.address], dex, [], 0),
            0,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SUM_OF_SHARES_SHOULD_BE_GREATER_THAN_ZERO");
    });

    it("Should revert when conditionIndex is out of bounds", async function () {
      const outOfBoundsIndex = 10;
      await expect(
        positionManager.connect(liquidator).closePositionByCondition({ ...params, conditionIndex: outOfBoundsIndex }),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INCORRECT_CM_TYPE");
    });

    it("Should close position by limit and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should close position by limit and transfer testTokenA from 'Pair'", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalance(
        testTokenA,
        pair,
        amount0Out.mul(NegativeOne),
      );
    });

    it("Should liquidate when position can be closed and correctly updated balances in the vault", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      const { openBorrowIndex } = await positionManager.getPosition(0);
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());
      const depositAfterDeal = amount0Out.sub(BigNumber.from(positionDebt.toString())).sub(feeInPaymentAsset);
      await positionManager.connect(liquidator).closePositionByCondition(params);
      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(traderBalance).to.be.equal(depositAfterDeal);
    });
    it("Should close when position can be closed and transfer profit from Bucket to TraderBalanceVault", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("4", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(feeInPaymentAsset);

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenA,
        [bucket, traderBalanceVault, Treasury],
        [amount0Out.sub(profit).sub(feeInPaymentAsset), profit, feeInPaymentAsset],
      );
    });

    it("Should liquidate when position can be closed - liquidator is trader and correctly updated balances in the vault", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const { openBorrowIndex } = await positionManager.getPosition(0);
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());
      const depositAfterDeal = amount0Out.sub(positionDebt.toString()).sub(feeInPaymentAsset);
      await positionManager.connect(trader).closePositionByCondition({ ...params, keeper: trader.address });
      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      if (dex === "quickswapv3") {
        // 1% of the amount0Out
        const delta = wadMul(amount0Out.toString(), parseEther("0.01").toString()).toString();
        expect(traderBalance).to.be.closeTo(depositAfterDeal, delta);
      } else {
        expect(traderBalance).to.be.equal(depositAfterDeal);
      }
    });
    it("Should close position by limit and correct calculate fee in paymentAsset when protocoleFeeInPaymentAsset < minProtocolFee", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const protocolFeeCoefficient = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      await PrimexDNS.setProtocolFeeCoefficient(protocolFeeCoefficient);

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should close risky position and throw event", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const { depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);
      const tx = await positionManager.connect(liquidator).closePositionByCondition(params);
      const expectedClosePosition = {
        positionId: 0,
        trader: trader.address,
        closedBy: liquidator.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.LIMIT_CONDITION,
      };
      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByKeeper,
        feeInPaymentAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };
      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });
  });

  describe("ClosePosition by SL/TP_ArbitrumPaymentModel", function () {
    let snapshotId, registry, stopLossPrice, takeProfitPrice, additionalParams, conditionIndex, KeeperRDArbitrum, params;

    before(async function () {
      const l1GasPrice = 30e9;
      const arbGasInfoArtifact = await getArtifact("ArbGasInfoMock");
      await network.provider.send("hardhat_setCode", [ArbGasInfo, arbGasInfoArtifact.deployedBytecode]);
      const arbGasInfo = await getContractAt("ArbGasInfoMock", ArbGasInfo);
      await arbGasInfo.setL1BaseFeeEstimate(l1GasPrice);
      const KeeperRDFactory = await getContractFactory("KeeperRewardDistributor", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      registry = await getContract("Registry");

      const pmxPartInReward = await KeeperRewardDistributor.pmxPartInReward();
      const nativePartInReward = await KeeperRewardDistributor.nativePartInReward();
      const positionSizeCoefficient = await KeeperRewardDistributor.positionSizeCoefficient();
      const additionalGas = await KeeperRewardDistributor.additionalGas();
      const defaultMaxGasPrice = await KeeperRewardDistributor.defaultMaxGasPrice();
      const initParams = {
        pmx: PMXToken.address,
        pmxPartInReward: pmxPartInReward,
        nativePartInReward: nativePartInReward,
        positionSizeCoefficient: positionSizeCoefficient,
        additionalGas: additionalGas,
        oracleGasPriceTolerance: parseUnits("1", 17),
        paymentModel: PaymentModel.ARBITRUM,
        defaultMaxGasPrice: defaultMaxGasPrice,
        registry: registry.address,
        priceOracle: priceOracle.address,
        treasury: Treasury.address,
        whiteBlackList: whiteBlackList.address,
        maxGasPerPositionParams: [
          {
            actionType: KeeperActionType.Liquidation,
            config: {
              baseMaxGas1: "100000000",
              baseMaxGas2: "100000000",
              multiplier1: parseEther("100"),
              multiplier2: "0",
              inflectionPoint: "0",
            },
          },
        ],
        decreasingGasByReasonParams: [],
      };
      KeeperRDArbitrum = await upgrades.deployProxy(KeeperRDFactory, [initParams], {
        unsafeAllow: ["external-library-linking", "constructor", "delegatecall"],
      });
      const { payload } = await encodeFunctionData("setKeeperRewardDistributor", [KeeperRDArbitrum.address], "PositionManagerExtension");
      await positionManager.connect(BigTimelockAdmin).setProtocolParamsByAdmin(payload);
      conditionIndex = 0;
      stopLossPrice = BigNumber.from(price).sub("1").toString();
      takeProfitPrice = BigNumber.from(price).add("1").toString();
      OpenPositionParams.closeConditions = [
        getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice)),
      ];
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      additionalParams = getTakeProfitStopLossAdditionalParams(megaRoutesForClose, await getEncodedChainlinkRouteViaUsd(testTokenA));
      await setupUsdOraclesForToken(NATIVE_CURRENCY, parseUnits("0.3", USD_DECIMALS));
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    beforeEach(async function () {
      params = {
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: conditionIndex,
        ccmAdditionalParams: additionalParams,
        closeReason: CloseReason.LIMIT_CONDITION,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
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

    it("Should close position by limit and transfer testTokenB from 'PositionManager' to 'Pair'", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should close position by limit and transfer testTokenA from 'Pair'", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalance(
        testTokenA,
        pair,
        amount0Out.mul(NegativeOne),
      );
    });

    it("Should close by limit when position can be closed and correctly updated balances in the vault", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const { openBorrowIndex } = await positionManager.getPosition(0);
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        KeeperRDArbitrum.address,
      );
      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());
      const depositAfterDeal = amount0Out.sub(BigNumber.from(positionDebt.toString())).sub(feeInPaymentAsset);
      await positionManager.connect(liquidator).closePositionByCondition(params);
      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(traderBalance).to.be.equal(depositAfterDeal);
    });
    it("Should close by limit when position can be closed and transfer profit from Bucket to TraderBalanceVault", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("4", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        KeeperRDArbitrum.address,
      );

      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const profit = amount0Out.sub(positionDebt.toString());

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenA,
        [bucket, traderBalanceVault],
        [amount0Out.sub(profit), profit.sub(feeInPaymentAsset)],
      );
    });

    it("Should close by limit when position can be closed - liquidator is trader and correctly updated balances in the vault", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const { openBorrowIndex } = await positionManager.getPosition(0);
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        KeeperRDArbitrum.address,
      );
      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());
      const depositAfterDeal = amount0Out.sub(positionDebt.toString()).sub(feeInPaymentAsset);
      params.keeper = trader.address;
      await positionManager.connect(trader).closePositionByCondition(params);
      const { availableBalance: traderBalance } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      if (dex === "quickswapv3") {
        // 1% of the amount0Out
        const delta = wadMul(amount0Out.toString(), parseEther("0.01").toString()).toString();
        expect(traderBalance).to.be.closeTo(depositAfterDeal, delta);
      } else {
        expect(traderBalance).to.be.equal(depositAfterDeal);
      }
    });
    it("Should close position by limit and correct calculate fee in positionAsset when protocoleFeeInPaymentAsset < minProtocolFee", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const protocolFeeCoefficient = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        KeeperRDArbitrum.address,
      );
      await PrimexDNS.setProtocolFeeCoefficient(protocolFeeCoefficient);
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should close by limit risky position and throw event", async function () {
      await setOraclePrice(testTokenB, testTokenA, reversePrice(price.toString()).mul("2"));

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: swapSize,
        path: [testTokenA.address, testTokenB.address],
      });
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        KeeperRDArbitrum.address,
      );
      const { depositAmountInSoldAsset } = await positionManager.getPosition(0);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );
      const profit = amount0Out.sub(positionDebt.toString()).sub(depositAmountInSoldAsset).sub(feeInPaymentAsset);
      const tx = await positionManager.connect(liquidator).closePositionByCondition(params);
      const expectedClosePosition = {
        positionId: 0,
        trader: trader.address,
        closedBy: liquidator.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: profit,
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.LIMIT_CONDITION,
      };
      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentnAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByKeeper,
        feeInPaymentAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };
      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });
  });

  describe("liquidatePosition", function () {
    let snapshotId;
    let positionAmount, openBorrowIndex, borrowedAmount;
    let params;
    before(async function () {
      borrowedAmount = parseUnits("30", decimalsA);
      OpenPositionParams.marginParams.borrowedAmount = borrowedAmount;
      const swapSize = OpenPositionParams.marginParams.borrowedAmount.add(OpenPositionParams.depositAmount);
      await testTokenA.connect(trader).approve(positionManager.address, swapSize);

      const swap = swapSize.mul(multiplierA);
      const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amount0Out.mul(multiplierB);
      const limitPrice = wadDiv(amountB.toString(), swap.toString()).toString();
      const price = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, price);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
      ({ positionAmount, openBorrowIndex } = await positionManager.getPosition(0));
    });
    beforeEach(async function () {
      params = {
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: MaxUint256,
        ccmAdditionalParams: [],
        closeReason: CloseReason.RISKY_POSITION,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      };
      snapshotId = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
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

    it("Should revert when the dex price is less than the oracle price by oracleTolerableLimit + 5%", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("1", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setBadOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "DIFFERENT_PRICE_DEX_AND_ORACLE",
      );
    });
    it("Shouldn't liquidate position until it not risky", async function () {
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON",
      );
    });

    it("Should not liquidate position if it's not risky but positionAsset is removed from allowedAsset of this bucket", async function () {
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON",
      );

      await bucket.removeAsset(testTokenB.address);

      await expect(positionManager.connect(liquidator).closePositionByCondition(params)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "POSITION_CANNOT_BE_CLOSED_FOR_THIS_REASON",
      );
    });

    it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.91wad", async function () {
      const bnWAD = BigNumber.from(WAD.toString());

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.60", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      await setOraclePrice(testTokenB, testTokenA, BigNumber.from(price).div(USD_MULTIPLIER));

      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();

      const positionDebt = await positionManager.getPositionDebt(0);
      let amount0OutOracle = wadMul(amountB.toString(), priceFromOracle.toString()).toString();
      amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();

      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      const numerator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
      const positionState = wadDiv(numerator, denominator).toString();

      expect(BigNumber.from(positionState)).to.be.lt(WAD);
      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is equal to ~ 0.99wad", async function () {
      const bnWAD = BigNumber.from(WAD.toString());

      let amountToSwap;
      if (dex === "curve") {
        amountToSwap = parseUnits("20", decimalsB);
      } else {
        amountToSwap = parseUnits("0.65", decimalsB);
      }

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amountToSwap.toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();

      const positionDebt = await positionManager.getPositionDebt(0);
      let amount0OutOracle = wadMul(amountB.toString(), priceFromOracle.toString()).toString();
      amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      const numerator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
      const positionState = wadDiv(numerator, denominator).toString();
      expect(BigNumber.from(positionState)).to.be.lt(WAD);

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should liquidate risky position and transfer testTokenB from 'PositionManager' to 'Pair' when health position is ~ 1 wad", async function () {
      // This test will only work correctly with 18 decimals of both tokens.
      // With different decimals, it's difficult to create conditions under which the health will be exactly WAD.
      // It's not difficult to calculate, but due to rounding with reverse calculation, not exactly WAD is obtained.
      // If this test works with 18 decimals, then it will work at any conditions when health == WAD
      if (decimalsA !== 18 || decimalsB !== 18) this.skip();
      const bnWAD = BigNumber.from(WAD.toString());

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());
      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());
      const denominator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        positionAmount.toString(),
      ).toString();
      const numerator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();

      const denominatorInWad = BigNumber.from(denominator).mul(multiplierB);
      const numeratorInWad = BigNumber.from(numerator).mul(multiplierA);
      const rate = wadDiv(numeratorInWad.toString(), denominatorInWad.toString()).toString();
      const exchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, exchangeRate);

      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      await network.provider.send("evm_mine");
      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should liquidate risky position and transfer testTokenA from 'Pair'", async function () {
      const bnWAD = BigNumber.from(WAD.toString());

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const priceFromOracle = await getExchangeRateByRoutes(testTokenB, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const pairPriceDrop = await priceOracle.pairPriceDrops(testTokenB.address, testTokenA.address);
      const feeBuffer = await bucket.feeBuffer();

      const positionDebt = await positionManager.getPositionDebt(0);
      let amount0OutOracle = wadMul(amountB.toString(), priceFromOracle.toString()).toString();
      amount0OutOracle = BigNumber.from(amount0OutOracle).div(multiplierA).toString();
      const securityBuffer = await positionManager.securityBuffer();
      const oracleTolerableLimit = await positionManager.getOracleTolerableLimit(testTokenB.address, testTokenA.address);

      const numerator = wadMul(
        wadMul(
          wadMul(bnWAD.sub(securityBuffer).toString(), bnWAD.sub(oracleTolerableLimit).toString()),
          bnWAD.sub(pairPriceDrop).toString(),
        ),
        amount0OutOracle,
      ).toString();
      const denominator = wadMul(feeBuffer.toString(), positionDebt.toString()).toString();
      const positionState = wadDiv(numerator, denominator).toString();
      expect(BigNumber.from(positionState)).to.be.lt(WAD);

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalances(
        testTokenB,
        [positionManager, pair],
        [positionAmount.mul(NegativeOne), positionAmount],
      );
    });

    it("Should liquidate risky position and delete trader position from traderPositions list", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = positionAmount.mul(multiplierB);

      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await positionManager.connect(liquidator).closePositionByCondition(params);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should liquidate risky position and fully repay traders debt after n blocks past", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      await increaseBlocksBy(increaseBy);
      expect(await debtTokenA.balanceOf(trader.address)).to.be.gt(borrowedAmount);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.be.gt(borrowedAmount.div(2));

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await positionManager.connect(liquidator).closePositionByCondition(params);

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should liquidate risky position and fully delete trader's deposit from 'TraderBalanceVault'", async function () {
      let amountToSwap;
      if (dex === "curve") {
        amountToSwap = parseUnits("20", decimalsB);
      } else {
        amountToSwap = parseUnits("1.5", decimalsB);
      }

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amountToSwap.toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await positionManager.connect(liquidator).closePositionByCondition(params);
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(availableBefore).to.equal(availableAfter).to.equal(0);
    });

    it("Should liquidate risky position and throw event", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      for (let i = 0; i < 3; i++) {
        await network.provider.send("evm_mine");
      }

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      const tx = await positionManager.connect(liquidator).closePositionByCondition(params);
      const expectedClosePosition = {
        positionI: 0,
        trader: trader.address,
        closedBy: liquidator.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: depositAmount.mul(NegativeOne),
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.RISKY_POSITION,
      };

      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByKeeper,
        feeInPaymentnAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };

      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });
    it("Should liquidate risky and charge correct token amount when trader's tier is not default", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      for (let i = 0; i < 3; i++) {
        await network.provider.send("evm_mine");
      }

      await PMXToken.transfer(trader.address, firstNotDefaultThreshold);
      await PMXToken.connect(trader).approve(traderBalanceVault.address, firstNotDefaultThreshold);
      await traderBalanceVault.connect(trader).deposit(PMXToken.address, firstNotDefaultThreshold);

      expect(await TiersManager.getTraderTierForAddress(trader.address)).to.be.equal(firstNotDefaultTier);

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);

      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amount0Out,
        FeeRateType.MarginPositionClosedByKeeper,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
        undefined,
        0, // WE don't consider the tier when liquidating
      );

      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      const tx = await positionManager.connect(liquidator).closePositionByCondition(params);
      const expectedClosePosition = {
        positionI: 0,
        trader: trader.address,
        closedBy: liquidator.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: positionAmount,
        profit: depositAmount.mul(NegativeOne),
        positionDebt: positionDebt,
        amountOut: amount0Out.sub(feeInPaymentAsset),
        reason: CloseReason.RISKY_POSITION,
      };

      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByKeeper,
        feeInPaymentnAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };

      eventValidation(
        "ClosePosition",
        await tx.wait(),
        expectedClosePosition,
        await getContractAt("PositionLibrary", positionManager.address),
      );
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });

    it("Should liquidate risky position and transfer rest of trader deposit to treasury", async function () {
      const openScaledAmount = rayDiv(borrowedAmount.toString(), openBorrowIndex.toString());
      // and transfer rest of trader deposit to treasury
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), openScaledAmount.toString());

      const depositAfterDeal = amount0Out.sub(BigNumber.from(positionDebt.toString()));

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalance(
        testTokenA,
        Treasury,
        depositAfterDeal,
      );

      const { availableBalance: balanceOfTrader } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      expect(balanceOfTrader).to.equal(0);

      expect(await debtTokenA.balanceOf(trader.address)).to.equal(0);
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should liquidate risky position 1 block past and transfer positionDebt (principal + fees) of testTokenA to 'Bucket'", async function () {
      await network.provider.send("evm_mine");

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("0.6", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const amountB = positionAmount.mul(multiplierB);
      const amount0Out = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amount0Out.mul(multiplierA);
      const price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const scaledDebtBalance = await debtTokenA.scaledBalanceOf(trader.address);
      const borrowIndexBefore = await bucket.variableBorrowIndex();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);

      const cumulatedVariableBorrowInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const positionDebt = rayMul(
        scaledDebtBalance.toString(),
        rayMul(cumulatedVariableBorrowInterest.toString(), borrowIndexBefore.toString()),
      );

      await expect(() => positionManager.connect(liquidator).closePositionByCondition(params)).to.changeTokenBalance(
        testTokenA,
        bucket,
        positionDebt.toFixed(),
      );
    });
  });

  describe("getBestDexByPosition", function () {
    let snapshotId, dexesWithAncillaryData, dexRoute, dex2Route, dexGasAmount, dex2GasAmount;
    before(async function () {
      dexesWithAncillaryData = [
        {
          dex: dex,
          ancillaryData: ancillaryDexData,
        },
        {
          dex: dex2,
          ancillaryData: ancillaryDexData2,
        },
      ];
      dexRoute = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex);
      dex2Route = await getSingleMegaRoute([testTokenB.address, testTokenA.address], dex2);
      dexGasAmount = await getGas(dex);
      dex2GasAmount = await getGas(dex);

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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
    it("When first dex is best to swap borrowedAmount return correct dexes name", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      const amount0Out1 = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amount0Out2 = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);
      expect(amount0Out1).to.be.gt(amount0Out2);

      const bestShares = await bestDexLens.callStatic["getBestDexByPosition(address,uint256,uint256,(string,bytes32)[])"](
        positionManager.address,
        0,
        1,
        dexesWithAncillaryData,
      );
      const returnParams = {
        returnAmount: amount0Out1,
        estimateGasAmount: dexGasAmount,
        megaRoutes: dexRoute,
      };
      parseArguments(bestShares, returnParams);
    });
    it("When second dex is best to swap borrowedAmount return correct dexes name", async function () {
      const { positionAmount } = await positionManager.getPosition(0);

      await swapExactTokensForTokens({
        dex: dex2,
        amountIn: parseUnits("60", decimalsA).toString(),
        path: [testTokenA.address, testTokenB.address],
      });

      const amount0Out1 = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);

      const amount0Out2 = await getAmountsOut(dex2, positionAmount, [testTokenB.address, testTokenA.address]);

      expect(amount0Out2).to.be.gt(amount0Out1);
      const bestShares = await bestDexLens.callStatic["getBestDexByPosition(address,uint256,uint256,(string,bytes32)[])"](
        positionManager.address,
        0,
        1,
        dexesWithAncillaryData,
      );
      const returnParams = {
        returnAmount: amount0Out2,
        estimateGasAmount: dex2GasAmount,
        megaRoute: dex2Route,
      };
      parseArguments(bestShares, returnParams);
    });

    it("When multiple shares return correct dexes", async function () {
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("10", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });

      const { positionAmount } = await positionManager.getPosition(0);
      // if positionAmount is odd, then 1 wei from the second part of positionAmount will not be swapped
      // because of rounding down during division positionAmount by amount of shares.
      // So, the test will fail while attmept to swap the whole value of positionAmount,
      // for example, using this approach for calculation of positionAmount parts:
      //   positionAmountFirstPartToSwap = positionAmount.div(2);
      //   positionAmountSecondPartToSwap = positionAmount.sub(positionAmountFirstPartToSwap);
      //
      // So, the only positionAmountFirstPartToSwap will be swapped on both dexes
      const amount0Out1 = await getAmountsOut(dex, positionAmount.div(2), [testTokenB.address, testTokenA.address]);
      const amount0Out2 = await getAmountsOut(dex2, positionAmount.div(2), [testTokenB.address, testTokenA.address]);

      const bestShares = await bestDexLens.callStatic["getBestDexByPosition(address,uint256,uint256,(string,bytes32)[])"](
        positionManager.address,
        0,
        2,
        dexesWithAncillaryData,
      );
      const routes = await getMegaRoutes([
        {
          shares: 1,
          routesData: [
            {
              to: testTokenA.address,
              pathData: [
                {
                  dex: dex,
                  path: [testTokenB.address, testTokenA.address],
                  shares: 1,
                },
                {
                  dex: dex2,
                  path: [testTokenB.address, testTokenA.address],
                  shares: 1,
                },
              ],
            },
          ],
        },
      ]);
      const returnParams = {
        returnAmount: amount0Out1.add(amount0Out2),
        estimateGasAmount: dexGasAmount.add(dex2GasAmount),
        megaRoute: routes,
      };
      parseArguments(returnParams, bestShares);
    });

    describe("Add pair testTokenA-testTokenX on first dex", function () {
      it("When the first dex has this swap pair, and the second does not, should returns correct dexes name", async function () {
        await testTokenX.mint(lender.address, parseUnits("10", decimalsX));
        // add pair only on first dex
        await addLiquidity({ dex: dex, from: "lender", tokenA: testTokenA, tokenB: testTokenX });

        const pairPriceDrop = "10000000000000000"; // 0.01 in wad
        await priceOracle.setPairPriceDrop(testTokenX.address, testTokenA.address, pairPriceDrop);

        // await priceOracle.updatePriceFeed(testTokenX.address, USD, priceFeed.address);

        await bucket.addAsset(testTokenX.address);

        const swap = swapSize.mul(multiplierA);
        const amount0Out = await getAmountsOut(dex, swapSize, [testTokenA.address, testTokenX.address]);
        const amountX = amount0Out.mul(multiplierX);

        const price = wadDiv(amountX.toString(), swap.toString()).toString();
        const limitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
        await setupUsdOraclesForTokens(testTokenA, testTokenX, limitPrice);

        const { payload } = await encodeFunctionData(
          "setMaxPositionSize",
          [testTokenA.address, testTokenX.address, 0, MaxUint256],
          "PositionManagerExtension",
        );
        await positionManager.setProtocolParamsByAdmin(payload);
        OpenPositionParams.positionAsset = testTokenX.address;
        OpenPositionParams.firstAssetMegaRoutes = await getSingleMegaRoute([testTokenA.address, testTokenX.address], dex);
        OpenPositionParams.firstAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenX);
        OpenPositionParams.nativePositionAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenX);
        OpenPositionParams.pmxPositionAssetOracleData = getEncodedChainlinkRouteViaUsd(testTokenX);

        await testTokenA.connect(trader).approve(positionManager.address, depositAmount);
        await positionManager.connect(trader).openPosition(OpenPositionParams);

        const { positionAsset, positionAmount } = await positionManager.getPosition(1);
        expect(positionAsset).to.equal(testTokenX.address);
        const bestShares = await bestDexLens.callStatic["getBestDexByPosition(address,uint256,uint256,(string,bytes32)[])"](
          positionManager.address,
          1,
          1,
          dexesWithAncillaryData,
        );

        const amount0Out1 = await getAmountsOut(dex, positionAmount, [testTokenX.address, testTokenA.address]);

        const returnParams = {
          returnAmount: amount0Out1,
          estimateGasAmount: dexGasAmount,
          megaRoute: await getSingleMegaRoute([testTokenX.address, testTokenA.address], dex),
        };

        parseArguments(bestShares, returnParams);
      });
    });
  });

  describe("isDelistedPosition", function () {
    let snapshotId;
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
    it("should revert if there are no any positions", async function () {
      expect(await positionManager.positionsId()).to.be.equal(0);
      await expect(positionManager.isDelistedPosition(0)).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });
    it("should revert if position does not exist", async function () {
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      const positionId = 10;
      await expect(positionManager.isDelistedPosition(positionId)).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });
    it("should return 'false' when the bucket of the position is not delisted", async function () {
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await PrimexDNS.deprecateBucket("bucket1");
      expect(await positionManager.isDelistedPosition(0)).to.be.equal(false);
    });
    it("should return 'true' when the bucket of the position is not active", async function () {
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await PrimexDNS.deprecateBucket("bucket1");
      await network.provider.send("evm_increaseTime", [(await PrimexDNS.delistingDelay()).add("1").toNumber()]);
      await network.provider.send("evm_mine");
      expect(await positionManager.isDelistedPosition(0)).to.be.equal(true);
    });

    it("should liquidate the position and throw the correct event", async function () {
      await positionManager.connect(trader).openPosition(OpenPositionParams);
      await PrimexDNS.deprecateBucket("bucket1");
      await network.provider.send("evm_increaseTime", [(await PrimexDNS.delistingDelay()).add("1").toNumber()]);
      await network.provider.send("evm_mine");

      const additionalParams = getTakeProfitStopLossAdditionalParams(megaRoutesForClose, await getEncodedChainlinkRouteViaUsd(testTokenA));

      const tx = await positionManager.connect(liquidator).closePositionByCondition({
        id: 0,
        keeper: liquidator.address,
        megaRoutes: megaRoutesForClose,
        conditionIndex: 0,
        ccmAdditionalParams: additionalParams,
        closeReason: CloseReason.BUCKET_DELISTED,
        positionSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativePmxOracleData: getEncodedChainlinkRouteViaUsd(PMXToken),
        positionNativeAssetOracleData: getEncodedChainlinkRouteViaUsd({ address: await priceOracle.eth() }),
        pmxSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        nativeSoldAssetOracleData: getEncodedChainlinkRouteViaUsd(testTokenA),
        pullOracleData: [],
        pullOracleTypes: [],
      });
      const txReceipt = await tx.wait();
      const eventClosePosition = getDecodedEvents(
        "ClosePosition",
        txReceipt,
        await getContractAt("PositionLibrary", positionManager.address),
      )[0].args;
      expect(eventClosePosition.reason).to.equal(CloseReason.BUCKET_DELISTED);
    });
  });

  describe("updatePositionConditions", function () {
    let primexPricingLibraryMock, stopLossPrice, takeProfitPrice, liquidationPrice, positionId, snapshotId;
    before(async function () {
      const primexPricingLibrary = await getContract("PrimexPricingLibrary");
      const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
        libraries: {
          PrimexPricingLibrary: primexPricingLibrary.address,
        },
      });
      primexPricingLibraryMock = await PrimexPricingLibraryMockFactory.deploy();
      await primexPricingLibraryMock.deployed();

      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositAmount);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositAmount);
      liquidationPrice = await primexPricingLibraryMock.callStatic.getLiquidationPrice(
        bucketAddress,
        testTokenB.address,
        positionAmount,
        borrowedAmount,
        PrimexDNS.address,
      );
      const liquidationPriceInWadDecimals = liquidationPrice.mul(multiplierA);
      stopLossPrice = liquidationPriceInWadDecimals.add(parseEther("1"));
      takeProfitPrice = stopLossPrice.add(parseEther("1"));

      positionId = await positionManager.positionsId();

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });

    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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
    it("Should revert when caller is on the blacklist", async function () {
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      const closeConditions = [];
      await expect(
        positionManager.connect(mockContract).updatePositionConditions(positionId, closeConditions),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert when caller is not trader", async function () {
      const closeConditions = [];
      await expect(positionManager.connect(lender).updatePositionConditions(positionId, closeConditions)).to.be.revertedWithCustomError(
        ErrorsLibrary,
        "CALLER_IS_NOT_TRADER",
      );
    });
    it("Should change conditions and update updatedConditionsAt", async function () {
      const closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))];

      // sl/tp before updatePositionConditions() should be empty array as it specified in 'before'
      const closeConditionsFromContract = await positionManager.getCloseConditions(positionId);
      expect(closeConditionsFromContract.length).to.equal(0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      const { updatedConditionsAt: updatedConditionsAtBefore } = await positionManager.getPosition(positionId);
      await positionManager.connect(trader).updatePositionConditions(positionId, closeConditions);
      const latestTimeStamp = (await provider.getBlock("latest")).timestamp;

      const { updatedConditionsAt: updatedConditionsAtAfter } = await positionManager.getPosition(positionId);
      expect(updatedConditionsAtBefore).to.not.equal(updatedConditionsAtAfter);
      expect(updatedConditionsAtAfter).to.be.equal(latestTimeStamp);
    });

    it("Should change both stopLossPrice and takeProfitPrice", async function () {
      const closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))];

      // sl/tp before updatePositionConditions() should be empty array as it specified in 'before'
      let closeConditionsFromContract = await positionManager.getCloseConditions(positionId);
      expect(closeConditionsFromContract.length).to.equal(0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      // UPDATE POSITION
      await positionManager.connect(trader).updatePositionConditions(positionId, closeConditions);

      // sl/tp after updatePositionConditions()
      closeConditionsFromContract = await positionManager.getCloseConditions(positionId);
      const { takeProfitPriceDecoded: takeProfitPriceAfter, stopLossPriceDecoded: stopLossPriceAfter } = decodeStopLossTakeProfit(
        closeConditionsFromContract,
        0,
      );

      expect(stopLossPriceAfter).to.be.equal(stopLossPrice);
      expect(takeProfitPriceAfter).to.be.equal(takeProfitPrice);
    });

    it("Should emit event after conditions update", async function () {
      const closeConditions = [getCondition(TAKE_PROFIT_STOP_LOSS_CM_TYPE, getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice))];

      const tx = await positionManager.connect(trader).updatePositionConditions(positionId, closeConditions);

      const expectUpdatePositionConditions = {
        positionId: positionId,
        trader: trader.address,
        closeConditions: closeConditions,
      };
      eventValidation("UpdatePositionConditions", await tx.wait(), expectUpdatePositionConditions);
    });

    it("Should be able to change stopLossPrice takeProfitPrice to 0", async function () {
      // here a position should have some values before update
      await positionManager.connect(trader).updatePositionConditions(positionId, []);

      const closeConditionsFromContract = await positionManager.getCloseConditions(positionId);
      const { takeProfitPriceDecoded: takeProfitPrice, stopLossPriceDecoded: stopLossPrice } = decodeStopLossTakeProfit(
        closeConditionsFromContract,
        0,
      );
      expect(stopLossPrice).to.be.equal(0);
      expect(takeProfitPrice).to.be.equal(0);
    });

    it("Should revert increaseDeposit when caller is on the blacklist", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        positionManager.connect(mockContract).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert when increaseDeposit caller is not trader", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await expect(
        positionManager.connect(lender).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_TRADER");
    });

    it("Should emit event after increaseDeposit", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      const { scaledDebtAmount } = await positionManager.getPosition(0);
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      const tx = await positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0);

      const variableBorrowIndex = await bucket.variableBorrowIndex();
      const decreaseDebt = rayDiv(depositIncrease.toString(), variableBorrowIndex.toString()).toString();

      await expect(tx)
        .to.emit(positionManager, "IncreaseDeposit")
        .withArgs(positionId, trader.address, depositIncrease, scaledDebtAmount.sub(decreaseDebt));
    });

    it("Should increaseDeposit in borrowAsset from wallet", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0),
      ).to.changeTokenBalances(testTokenA, [trader, bucket], [depositIncrease.mul(NegativeOne), depositIncrease]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(depositIncrease));
    });

    it("Should not revert if increaseDeposit in borrowedAsset and amountOutMin > depositAmountInBorrowed", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], depositIncrease.add(1)),
      ).to.changeTokenBalances(testTokenA, [trader, bucket], [depositIncrease.mul(NegativeOne), depositIncrease]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(depositIncrease));
    });

    it("Should increaseDeposit in borrowAsset from vault", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await testTokenA.connect(trader).approve(traderBalanceVault.address, depositIncrease);
      await traderBalanceVault.connect(trader).deposit(testTokenA.address, depositIncrease);
      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, false, [], 0),
      ).to.changeTokenBalances(testTokenA, [traderBalanceVault, bucket], [depositIncrease.mul(NegativeOne), depositIncrease]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(depositIncrease));
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableAfter).to.equal(availableBefore.sub(depositIncrease));
    });

    it("Should increaseDeposit in other asset from wallet", async function () {
      const depositIncrease = parseUnits("1", decimalsB);
      await testTokenB.mint(trader.address, depositIncrease);
      const amountBInBorrowed = await getAmountsOut(dex, depositIncrease, [testTokenB.address, testTokenA.address]);
      await testTokenB.connect(trader).approve(positionManager.address, depositIncrease);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenB.address, true, megaRoutesForClose, 0),
      ).to.changeTokenBalances(testTokenA, [bucket], [amountBInBorrowed]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(amountBInBorrowed));
    });

    it("Should revert when depositAmountInBorrowed is less than amountOutMin", async function () {
      const depositIncrease = parseUnits("1", decimalsB);
      await testTokenB.mint(trader.address, depositIncrease);
      const amountBInBorrowed = await getAmountsOut(dex, depositIncrease, [testTokenB.address, testTokenA.address]);
      const amountOutMin = amountBInBorrowed.add(10);
      await testTokenB.connect(trader).approve(positionManager.address, depositIncrease);

      await expect(
        positionManager
          .connect(trader)
          .increaseDeposit(positionId, depositIncrease, testTokenB.address, true, megaRoutesForClose, amountOutMin),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SLIPPAGE_TOLERANCE_EXCEEDED");
    });

    it("Should increaseDeposit in other asset from vault", async function () {
      const depositIncrease = parseUnits("1", decimalsB);
      await testTokenB.mint(trader.address, depositIncrease);
      await testTokenB.connect(trader).approve(traderBalanceVault.address, depositIncrease);
      await traderBalanceVault.connect(trader).deposit(testTokenB.address, depositIncrease);
      const amountBInBorrowed = await getAmountsOut(dex, depositIncrease, [testTokenB.address, testTokenA.address]);
      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenB.address);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenB.address, false, megaRoutesForClose, 0),
      ).to.changeTokenBalances(testTokenA, [bucket], [amountBInBorrowed]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(amountBInBorrowed));
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenB.address);
      expect(availableAfter).to.equal(availableBefore.sub(depositIncrease));
    });

    it("Should be able to cover all debt with increaseDeposit", async function () {
      const depositIncrease = (await positionManager.getPositionDebt(positionId)).add(parseUnits("1", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      const { scaledDebtAmount } = await positionManager.getPosition(0);
      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), scaledDebtAmount.toString()).toString();

      await positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0);

      // expect correct position.depositAmountInSoldAsset calculation
      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(positionDebt)); // position.scaledDebtAmount

      expect(position.scaledDebtAmount).to.be.equal(0);
      expect(await positionManager.getPositionDebt(positionId)).to.equal(0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should correctly count debt tokens after deposit increase", async function () {
      const depositIncrease = parseUnits("1", decimalsA);
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      await positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0);
      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should update available balance in traderBalanceVault when increase deposit over debt", async function () {
      const depositIncrease = (await positionManager.getPositionDebt(positionId)).add(parseUnits("1", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);

      const { scaledDebtAmount } = await positionManager.getPosition(0);
      const borrowIndex = await bucket.variableBorrowIndex();
      const BAR = await bucket.bar();
      const lastUpdBlockTimestamp = await bucket.lastUpdatedBlockTimestamp();
      const txBlockTimestamp = lastUpdBlockTimestamp.add(100);
      await network.provider.send("evm_setNextBlockTimestamp", [txBlockTimestamp.toNumber()]);
      const compoundInterest = calculateCompoundInterest(BAR, lastUpdBlockTimestamp, txBlockTimestamp);
      const cumulated = rayMul(compoundInterest.toString(), borrowIndex.toString());
      const positionDebt = rayMul(cumulated.toString(), scaledDebtAmount.toString()).toString();

      const amountOverDebt = depositIncrease.sub(positionDebt);

      const { availableBalance: availableABefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        positionManager.connect(trader).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0),
      ).changeTokenBalance(testTokenA, traderBalanceVault, amountOverDebt);

      const { availableBalance: availableAAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableAAfter.sub(availableABefore)).to.equal(amountOverDebt);

      // expect correct position.depositAmountInSoldAsset calculation
      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.add(positionDebt));

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should increase deposit when previous position was closed", async function () {
      const secondPositionId = await positionManager.positionsId();
      const secondDepositAmount = parseUnits("1", decimalsA);
      const secondBorrowedAmount = parseUnits("0.1", decimalsA);

      const secondSwapSize = secondDepositAmount.add(secondBorrowedAmount);
      await testTokenA.connect(lender).approve(positionManager.address, secondDepositAmount);

      const swap = secondSwapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, secondSwapSize, [testTokenA.address, testTokenB.address]);
      const amountB = amountOut.mul(multiplierB);
      const price = wadDiv(amountB.toString(), swap.toString()).toString();
      const newLimitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, newLimitPrice);

      OpenPositionParams.marginParams.borrowedAmount = secondBorrowedAmount;
      OpenPositionParams.depositAmount = secondDepositAmount;
      await positionManager.connect(lender).openPosition(OpenPositionParams);

      const positionToClose = await positionManager.getPosition(positionId);
      const positionAmountInWadDecimals = positionToClose.positionAmount.mul(multiplierB);

      const amountAOut = await getAmountsOut(dex, positionToClose.positionAmount, [testTokenB.address, testTokenA.address]);
      const amountAOutInWadDecimals = amountAOut.mul(multiplierA);
      const rate = wadDiv(amountAOutInWadDecimals.toString(), positionAmountInWadDecimals.toString()).toString();
      const dexExchangeRate = BigNumber.from(rate).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);
      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );
      const depositIncrease = parseUnits("0.01", decimalsA);
      await testTokenA.connect(lender).approve(positionManager.address, depositIncrease);
      await positionManager.connect(lender).increaseDeposit(positionId, depositIncrease, testTokenA.address, true, [], 0);
      const position = await positionManager.getPosition(secondPositionId);
      expect(position.depositAmountInSoldAsset).to.be.equal(secondDepositAmount.add(depositIncrease));
    });
    it("Should revert decreaseDeposit when the positionManager is paused", async function () {
      await positionManager.pause();
      const depositDecrease = parseUnits("1", decimalsA);
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWith("Pausable: paused");
    });
    it("Should revert decreaseDeposit when bucket is not active", async function () {
      await PrimexDNS.freezeBucket(await bucket.name());
      const depositDecrease = parseUnits("1", decimalsA);
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "BUCKET_IS_NOT_ACTIVE");
    });
    it("Should revert decreaseDeposit when caller is on the blacklist", async function () {
      const depositDecrease = parseUnits("1", decimalsA);
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        positionManager
          .connect(mockContract)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert when decreaseDeposit caller is not trader", async function () {
      const depositDecrease = parseUnits("1", decimalsA);
      await expect(
        positionManager
          .connect(lender)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_TRADER");
    });

    it("Should revert when decreaseDeposit amount is more than deposit", async function () {
      const depositDecrease = depositAmount.add(1);
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_MORE_THAN_DEPOSIT");
    });
    it("Should revert when decreaseDeposit when amount is zero", async function () {
      const depositDecrease = 0;
      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "DECREASE_AMOUNT_IS_ZERO");
    });

    it("Should revert when after decreaseDeposit position becomes risky", async function () {
      const depositDecrease = depositAmount.sub(parseUnits("1", decimalsA));

      await expect(
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_DEPOSIT_SIZE");
    });

    it("Should emit event after depositDecrease", async function () {
      const { scaledDebtAmount } = await positionManager.getPosition(0);

      const depositDecrease = parseUnits("1", decimalsA);
      const tx = await positionManager
        .connect(trader)
        .decreaseDeposit(
          positionId,
          depositDecrease,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const variableBorrowIndex = await bucket.variableBorrowIndex();
      const decreaseDebt = rayDiv(depositDecrease.toString(), variableBorrowIndex.toString()).toString();

      await expect(tx)
        .to.emit(positionManager, "DecreaseDeposit")
        .withArgs(positionId, trader.address, depositDecrease, scaledDebtAmount.add(decreaseDebt));
    });

    it("Should update pyth oracle via decreaseDeposit function", async function () {
      const depositDecrease = parseUnits("1", decimalsA);
      const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
      const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
      const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
      const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
      const pyth = await getContract("MockPyth");

      await priceOracle.updatePythPairId(
        [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
        [tokenAID, tokenBID, nativeID, PMXID],
      );
      // price in 10**8
      const expo = -8;
      const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

      const timeStamp = (await provider.getBlock("latest")).timestamp;
      const updateDataTokenA = await pyth.createPriceFeedUpdateData(
        tokenAID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataTokenB = await pyth.createPriceFeedUpdateData(
        tokenBID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataNative = await pyth.createPriceFeedUpdateData(
        nativeID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataPmx = await pyth.createPriceFeedUpdateData(
        PMXID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );

      await positionManager
        .connect(trader)
        .decreaseDeposit(
          positionId,
          depositDecrease,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]],
          [UpdatePullOracle.Pyth],
          { value: 4 },
        );
      const priceTokenA = await pyth.getPrice(tokenAID);
      const priceTokenB = await pyth.getPrice(tokenBID);
      const priceNative = await pyth.getPrice(nativeID);
      const pricePmx = await pyth.getPrice(PMXID);

      expect(priceTokenA.publishTime)
        .to.be.equal(priceTokenB.publishTime)
        .to.be.equal(priceNative.publishTime)
        .to.be.equal(pricePmx.publishTime)
        .to.be.equal(timeStamp);
      expect(priceTokenA.price)
        .to.be.equal(priceTokenB.price)
        .to.be.equal(priceNative.price)
        .to.be.equal(pricePmx.price)
        .to.be.equal(price);
    });

    it("Should decreaseDeposit", async function () {
      const depositDecrease = parseUnits("1", decimalsA);
      const { availableBalance: availableBefore } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        positionManager
          .connect(trader)
          .decreaseDeposit(
            positionId,
            depositDecrease,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalances(testTokenA, [bucket, traderBalanceVault], [depositDecrease.mul(NegativeOne), depositDecrease]);

      const position = await positionManager.getPosition(0);
      expect(position.depositAmountInSoldAsset).to.be.equal(depositAmount.sub(depositDecrease));
      const { availableBalance: availableAfter } = await traderBalanceVault.balances(trader.address, testTokenA.address);
      expect(availableAfter).to.equal(availableBefore.add(depositDecrease));
    });

    it("Should correctly count debt tokens after deposit decrease", async function () {
      const depositDecrease = parseUnits("1", decimalsA);

      await positionManager
        .connect(trader)
        .decreaseDeposit(
          positionId,
          depositDecrease,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should decrease deposit when previous position was closed", async function () {
      const secondPositionId = await positionManager.positionsId();
      const secondDepositAmount = parseUnits("1", decimalsA);
      const secondBorrowedAmount = parseUnits("0.1", decimalsA);

      const secondSwapSize = secondDepositAmount.add(secondBorrowedAmount);

      await testTokenA.connect(lender).approve(positionManager.address, secondDepositAmount);

      const swap = secondSwapSize.mul(multiplierA);
      const amountOut = await getAmountsOut(dex, secondSwapSize, [testTokenA.address, testTokenB.address]);
      let amountB = amountOut.mul(multiplierB);
      let price = wadDiv(amountB.toString(), swap.toString()).toString();
      const newLimitPrice = BigNumber.from(price).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, newLimitPrice);

      OpenPositionParams.marginParams.borrowedAmount = secondBorrowedAmount;
      OpenPositionParams.depositAmount = secondDepositAmount;
      await positionManager.connect(lender).openPosition(OpenPositionParams);

      const positionToClose = await positionManager.getPosition(positionId);
      const positionAmount = positionToClose.positionAmount;
      amountB = positionAmount.mul(multiplierB);

      const amountAOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountA = amountAOut.mul(multiplierA);

      price = wadDiv(amountA.toString(), amountB.toString()).toString();
      const dexExchangeRate = BigNumber.from(price).div(USD_MULTIPLIER);

      await setOraclePrice(testTokenB, testTokenA, dexExchangeRate);

      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          0,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );

      await swapExactTokensForTokens({
        dex: dex,
        amountIn: amountAOut.toString(),
        path: [testTokenA.address, testTokenB.address],
      });
      const depositDecrease = parseUnits("0.01", decimalsA);
      await positionManager
        .connect(lender)
        .decreaseDeposit(
          secondPositionId,
          depositDecrease,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const position = await positionManager.getPosition(secondPositionId);
      expect(position.depositAmountInSoldAsset).to.be.equal(secondDepositAmount.sub(depositDecrease));
    });
  });

  describe("partiallyClosePosition", function () {
    let snapshotId, positionId, minPositionSize;
    before(async function () {
      minPositionSize = 0;

      positionId = await positionManager.positionsId();

      await positionManager.connect(trader).openPosition(OpenPositionParams);
    });
    after(async function () {
      await network.provider.request({
        method: "evm_revert",
        params: [snapshotIdBase],
      });
      snapshotIdBase = await network.provider.request({
        method: "evm_snapshot",
        params: [],
      });
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

    it("Should revert when caller is on the blacklist", async function () {
      const amount = parseUnits("0.1", decimalsB);
      await whiteBlackList.addAddressToBlacklist(mockContract.address);
      await expect(
        positionManager
          .connect(mockContract)
          .partiallyClosePosition(
            positionId,
            amount,
            lender.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "SENDER_IS_BLACKLISTED");
    });
    it("Should revert when called not by trader", async function () {
      const amount = parseUnits("0.1", decimalsB);
      await expect(
        positionManager
          .connect(lender)
          .partiallyClosePosition(
            positionId,
            amount,
            lender.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "CALLER_IS_NOT_TRADER");
    });

    it("Should revert when called with wrong position id", async function () {
      const amount = parseUnits("0.1", decimalsB);
      const wrongPositionId = 1000;
      await expect(
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            wrongPositionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "POSITION_DOES_NOT_EXIST");
    });

    it("Should update pyth oracle via partiallyClosePosition function", async function () {
      const amount = parseUnits("0.1", decimalsB);

      const tokenAID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b1";
      const tokenBID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b2";
      const nativeID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b3";
      const PMXID = "0x63f341689d98a12ef60a5cff1d7f85c70a9e17bf1575f0e7c0b2512d48b1c8b4";
      const pyth = await getContract("MockPyth");

      await priceOracle.updatePythPairId(
        [testTokenA.address, testTokenB.address, await priceOracle.eth(), PMXToken.address],
        [tokenAID, tokenBID, nativeID, PMXID],
      );
      // price in 10**8
      const expo = -8;
      const price = BigNumber.from("1").mul(BigNumber.from("10").pow(expo * -1));

      const timeStamp = (await provider.getBlock("latest")).timestamp;
      const updateDataTokenA = await pyth.createPriceFeedUpdateData(
        tokenAID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataTokenB = await pyth.createPriceFeedUpdateData(
        tokenBID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataNative = await pyth.createPriceFeedUpdateData(
        nativeID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );
      const updateDataPmx = await pyth.createPriceFeedUpdateData(
        PMXID,
        price,
        0,
        expo, // expo
        0,
        0,
        timeStamp,
        0,
      );

      await positionManager
        .connect(trader)
        .partiallyClosePosition(
          positionId,
          amount,
          trader.address,
          megaRoutesForClose,
          minPositionSize,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [[updateDataTokenA, updateDataTokenB, updateDataNative, updateDataPmx]],
          [UpdatePullOracle.Pyth],
          { value: 4 },
        );
      const priceTokenA = await pyth.getPrice(tokenAID);
      const priceTokenB = await pyth.getPrice(tokenBID);
      const priceNative = await pyth.getPrice(nativeID);
      const pricePmx = await pyth.getPrice(PMXID);
      expect(priceTokenA.publishTime)
        .to.be.equal(priceTokenB.publishTime)
        .to.be.equal(priceNative.publishTime)
        .to.be.equal(pricePmx.publishTime)
        .to.be.equal(timeStamp);
      expect(priceTokenA.price)
        .to.be.equal(priceTokenB.price)
        .to.be.equal(priceNative.price)
        .to.be.equal(pricePmx.price)
        .to.be.equal(price);
    });

    it("Should partially close position", async function () {
      const amount = parseUnits("0.1", decimalsB);
      const positionBefore = await positionManager.getPosition(0);
      const decreasePercent = wadDiv(amount.toString(), positionBefore.positionAmount.toString()).toString();
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      await expect(() =>
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenB, positionManager, amount.mul(NegativeOne));

      const position = await positionManager.getPosition(0);
      expect(position.positionAmount).to.be.equal(positionBefore.positionAmount.sub(amount));
      const depositDecrease = wadMul(positionBefore.depositAmountInSoldAsset.toString(), decreasePercent).toString();
      expect(position.depositAmountInSoldAsset).to.be.equal(positionBefore.depositAmountInSoldAsset.sub(depositDecrease));
      const scaledDebtAmountDecrease = wadMul(positionBefore.scaledDebtAmount.toString(), decreasePercent).toString();
      expect(position.scaledDebtAmount).to.be.equal(positionBefore.scaledDebtAmount.sub(scaledDebtAmountDecrease));

      // lockedBalance after partiallyClosePosition
      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
    });

    it("Should correctly count debt tokens after partially close position", async function () {
      const x = 0.37777779; // Some long number to force number rounding in partial position closing
      const amount = parseUnits(x.toFixed(decimalsB), decimalsB);
      const amountInWad = amount.mul(multiplierB);

      let amountOut = await getAmountsOut(dex, amount, [testTokenB.address, testTokenA.address]);
      const amountOutInWad = amountOut.mul(multiplierA);

      let limitPrice = wadDiv(amountInWad.toString(), amountOutInWad.toString()).toString();
      const limitPriceInUsdDecimals = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, limitPriceInUsdDecimals);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      await positionManager
        .connect(trader)
        .partiallyClosePosition(
          positionId,
          amount,
          trader.address,
          megaRoutesForClose,
          minPositionSize,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );
      const { positionAmount } = await positionManager.getPosition(0);
      amountOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountAinWadDecimals = amountOut.mul(multiplierA);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierB);

      limitPrice = wadDiv(positionAmountInWadDecimals.toString(), amountAinWadDecimals.toString()).toString();
      const limitPriceInAdecimals2 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenB, testTokenA, limitPriceInAdecimals2);
      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          minPositionSize,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);
    });

    it("Should correctly count debt tokens after multiple partial closing", async function () {
      const x = 0.77777777; // Some long number to force number rounding in partial position closing
      const amount = parseUnits(x.toFixed(decimalsB), decimalsB);
      let amountOut, limitPrice;

      for (let i = 0; i < 10; i++) {
        amountOut = await getAmountsOut(dex, amount, [testTokenB.address, testTokenA.address]);
        const amountAinWadDecimals = amountOut.mul(multiplierA);
        const amountBinWadDecimals = amount.mul(multiplierB);

        limitPrice = wadDiv(amountBinWadDecimals.toString(), amountAinWadDecimals.toString()).toString();
        const limitPriceInAdecimals = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
        await setOraclePrice(testTokenA, testTokenB, limitPriceInAdecimals);

        await positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          );

        expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);
      }

      const { positionAmount } = await positionManager.getPosition(0);
      amountOut = await getAmountsOut(dex, positionAmount, [testTokenB.address, testTokenA.address]);
      const amountAinWadDecimals2 = amountOut.mul(multiplierA);
      const positionAmountInWadDecimals = positionAmount.mul(multiplierB);
      limitPrice = wadDiv(positionAmountInWadDecimals.toString(), amountAinWadDecimals2.toString()).toString();
      const limitPriceInAdecimals2 = BigNumber.from(limitPrice).div(USD_MULTIPLIER);
      await setOraclePrice(testTokenA, testTokenB, limitPriceInAdecimals2);

      await positionManager
        .connect(trader)
        .closePosition(
          positionId,
          trader.address,
          megaRoutesForClose,
          minPositionSize,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          [],
          [],
        );
      expect(await debtTokenA.scaledBalanceOf(trader.address)).to.equal(0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(0);
    });

    it("Should partially close position and emit event", async function () {
      const amount = parseUnits("1", decimalsB);
      const positionBefore = await positionManager.getPosition(0);

      const decreasePercent = wadDiv(amount.toString(), positionBefore.positionAmount.toString()).toString();
      const scaledDebtAmountDecrease = wadMul(positionBefore.scaledDebtAmount.toString(), decreasePercent).toString();
      const amountAOut = await getAmountsOut(dex, amount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amountAOut,
        FeeRateType.MarginPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );
      const depositDecrease = wadMul(positionBefore.depositAmountInSoldAsset.toString(), decreasePercent).toString();

      const tx = await positionManager
        .connect(trader)
        .partiallyClosePosition(
          positionId,
          amount,
          trader.address,
          megaRoutesForClose,
          minPositionSize,
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenB),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          getEncodedChainlinkRouteViaUsd(testTokenA),
          [],
          [],
        );

      const variableBorrowIndex = await bucket.variableBorrowIndex();

      const debt = rayMul(scaledDebtAmountDecrease, variableBorrowIndex.toString()).toString();

      const profit = amountAOut.sub(debt).sub(depositDecrease).sub(feeInPaymentAsset);

      const expectedArguments = {
        positionId: 0,
        trader: trader.address,
        bucketAddress: bucket.address,
        soldAsset: testTokenA.address,
        positionAsset: testTokenB.address,
        decreasePositionAmount: amount,
        depositAmount: positionBefore.depositAmountInSoldAsset.sub(depositDecrease),
        scaledDebtAmount: positionBefore.scaledDebtAmount.sub(scaledDebtAmountDecrease),
        profit: profit,
        positionDebt: debt,
        amountOut: amountAOut.sub(feeInPaymentAsset),
      };

      const expectedPaidProtocolFee = {
        positionId: 0,
        trader: trader.address,
        paymentAsset: testTokenA.address,
        feeRateType: FeeRateType.MarginPositionClosedByTrader,
        feeInPaymentAsset: feeInPaymentAsset,
        feeInPmx: 0,
      };

      eventValidation("PartialClosePosition", await tx.wait(), expectedArguments);
      eventValidation(
        "PaidProtocolFee",
        await tx.wait(),
        expectedPaidProtocolFee,
        await getContractAt("PositionLibrary", positionManager.address),
      );
    });

    it("Should revert when amount >= positionAmount", async function () {
      const { positionAmount } = await positionManager.getPosition(0);
      await expect(
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            positionAmount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "AMOUNT_IS_MORE_THAN_POSITION_AMOUNT");
    });

    it("Should partially close position without debt and a bucket is not removed", async function () {
      const depositIncrease = borrowedAmount.add(parseUnits("1", decimalsA));
      await testTokenA.connect(trader).approve(positionManager.address, depositIncrease);
      const positionBefore = await positionManager.getPosition(0);

      expect(await positionManager.getTraderPositionsLength(trader.address)).to.equal(1);

      // This will cover all debt of the position
      await positionManager.connect(trader).increaseDeposit(0, depositIncrease, testTokenA.address, true, [], 0);
      const amount = parseUnits("1", decimalsB);
      const amountInBorrowed = await getAmountsOut(dex, amount, [testTokenB.address, testTokenA.address]);
      const feeInPaymentAsset = await calculateFeeInPaymentAsset(
        testTokenA.address,
        amountInBorrowed,
        FeeRateType.SpotPositionClosedByTrader,
        0,
        false,
        getEncodedChainlinkRouteViaUsd(testTokenA),
      );

      const { availableBalance: availableAfterIncreaseDeposit } = await traderBalanceVault.balances(trader.address, testTokenA.address);

      await expect(() =>
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.changeTokenBalance(testTokenA, traderBalanceVault, amountInBorrowed.sub(feeInPaymentAsset));

      const { availableBalance: availableAfterPartiallyClosePosition } = await traderBalanceVault.balances(
        trader.address,
        testTokenA.address,
      );
      expect(availableAfterPartiallyClosePosition.add(feeInPaymentAsset)).to.equal(availableAfterIncreaseDeposit.add(amountInBorrowed));

      // check the bucket is not removed
      const positionAfter = await positionManager.getPosition(0);
      expect(positionAfter.bucket).to.equal(positionBefore.bucket);
    });

    it("Should revert when position is too small after partially close position", async function () {
      const positionToClose = await positionManager.getPosition(0);
      const amount = positionToClose.positionAmount.sub(1);

      await expect(
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.revertedWithCustomError(ErrorsLibrary, "INSUFFICIENT_POSITION_SIZE");
    });

    it("Should revert when closing amount is too small", async function () {
      // making the price of testTokenB very low
      await swapExactTokensForTokens({
        dex: dex,
        amountIn: parseUnits("100", decimalsB).toString(),
        path: [testTokenB.address, testTokenA.address],
      });
      const amount = BigNumber.from(1);
      await expect(
        positionManager
          .connect(trader)
          .partiallyClosePosition(
            positionId,
            amount,
            trader.address,
            megaRoutesForClose,
            minPositionSize,
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenB),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            getEncodedChainlinkRouteViaUsd(testTokenA),
            [],
            [],
          ),
      ).to.be.reverted;
    });
  });
  describe("pause & unpause", function () {
    it("Should revert if not EMERGENCY_ADMIN call pause", async function () {
      await expect(positionManager.connect(caller).pause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
    it("Should revert if not SMALL_TIMELOCK_ADMIN call unpause", async function () {
      await expect(positionManager.connect(caller).unpause()).to.be.revertedWithCustomError(ErrorsLibrary, "FORBIDDEN");
    });
  });
});
