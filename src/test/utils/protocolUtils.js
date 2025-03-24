const {
  network,
  ethers: {
    getContract,
    getContractAt,
    getContractFactory,
    constants: { MaxUint256, Zero },
    BigNumber,
  },
  deployments: { getArtifact },
} = require("hardhat");
const { wadMul } = require("./math");
const { NATIVE_CURRENCY, FeeRateType, WAD, CallingMethod, PaymentModel, ArbGasInfo } = require("./constants");

async function calculateFeeInPaymentAsset(
  paymentAsset,
  paymentAmount,
  feeRateType,
  gasSpent,
  isFeeProhibitedInPmx,
  nativePaymentOracleData,
  keeperRD,
  tier = 0,
) {
  try {
    const primexDNS = await getContract("PrimexDNS");
    const priceOracle = await getContract("PriceOracle");
    let primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibrary = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibrary.deployed();

    const protocolFeeRate = await primexDNS.getProtocolFeeRateByTier(feeRateType, tier);
    const maxProtocolFee = await primexDNS.maxProtocolFee();
    let feeInPaymentAsset = BigNumber.from(wadMul(paymentAmount.toString(), protocolFeeRate.toString()).toString());
    let maxProtocolFeeInPaymentAsset;

    if (maxProtocolFee.toString() === MaxUint256.toString()) {
      maxProtocolFeeInPaymentAsset = maxProtocolFee;
    } else {
      maxProtocolFeeInPaymentAsset = await primexPricingLibrary.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        paymentAsset,
        maxProtocolFee,
        priceOracle.address,
        nativePaymentOracleData,
      );
    }
    // The minProtocolFee is applied only if the order/position is processed by Keepers
    if (
      feeRateType === FeeRateType.MarginPositionClosedByTrader ||
      feeRateType === FeeRateType.SpotPositionClosedByTrader ||
      feeRateType === FeeRateType.SwapMarketOrder
    ) {
      feeInPaymentAsset = feeInPaymentAsset.lt(maxProtocolFeeInPaymentAsset) ? feeInPaymentAsset : maxProtocolFeeInPaymentAsset;
    } else {
      const minProtocolFeeInPaymentAsset = await calculateMinProtocolFee(
        gasSpent,
        paymentAsset,
        feeRateType,
        isFeeProhibitedInPmx,
        keeperRD,
        nativePaymentOracleData,
      );
      if (minProtocolFeeInPaymentAsset.gt(paymentAmount)) {
        throw new Error("MIN_PROTOCOL_FEE_IS_GREATER_THAN_POSITION_SIZE");
      }
      feeInPaymentAsset = feeInPaymentAsset.gt(minProtocolFeeInPaymentAsset) ? feeInPaymentAsset : minProtocolFeeInPaymentAsset;
      feeInPaymentAsset = feeInPaymentAsset.lt(maxProtocolFeeInPaymentAsset) ? feeInPaymentAsset : maxProtocolFeeInPaymentAsset;
    }
    return BigNumber.from(feeInPaymentAsset.toString());
  } catch (error) {
    console.error("Error in calculateFeeInPaymentAsset:", error);
    throw error;
  }
}

async function calculateMinProtocolFee(
  restrictedGasSpent,
  paymentAsset,
  feeRateType,
  isFeeProhibitedInPmx,
  keeperRD,
  nativePaymentOracleData,
) {
  try {
    const primexDNS = await getContract("PrimexDNS");
    const priceOracle = await getContract("PriceOracle");
    let primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibrary = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibrary.deployed();
    const keeperRewardDistributor =
      keeperRD === undefined ? await getContract("KeeperRewardDistributor") : await getContractAt("KeeperRewardDistributor", keeperRD);

    const [restrictedGasPrice] = await calculateRestrictedGasPrice(0, keeperRD);
    let callingMethod;
    if (feeRateType === FeeRateType.MarginPositionClosedByKeeper || feeRateType === FeeRateType.SpotPositionClosedByKeeper) {
      callingMethod = CallingMethod.ClosePositionByCondition;
    } else {
      callingMethod = CallingMethod.OpenPositionByOrder;
    }

    const [liquidationGasAmount, protocolFeeCoefficient, additionalGasSpent, maxGasAmount, baseLength] =
      await primexDNS.getParamsForMinProtocolFee(callingMethod);
    const paymentModel = (await keeperRewardDistributor.paymentModel()).toString();
    const l1GasPrice = 30e9;
    const l1CostWei = paymentModel === PaymentModel.ARBITRUM ? l1GasPrice * 16 * (baseLength.toNumber() + 140) : Zero;

    let minProtocolFeeInNativeAsset;
    if (isFeeProhibitedInPmx) {
      minProtocolFeeInNativeAsset = liquidationGasAmount.mul(restrictedGasPrice).add(l1CostWei).add(protocolFeeCoefficient);
    } else {
      if (callingMethod === CallingMethod.ClosePositionByCondition) {
        minProtocolFeeInNativeAsset = BigNumber.from(maxGasAmount.toString())
          .mul(restrictedGasPrice)
          .add(l1CostWei)
          .add(protocolFeeCoefficient);
      } else {
        let totalGasSpent = BigNumber.from(restrictedGasSpent).add(additionalGasSpent);
        totalGasSpent = totalGasSpent.gt(maxGasAmount) ? maxGasAmount : totalGasSpent;

        minProtocolFeeInNativeAsset = totalGasSpent.mul(restrictedGasPrice).add(l1CostWei).add(protocolFeeCoefficient);
      }
    }

    const minProtocolFeeInPaymentAsset = await primexPricingLibrary.callStatic.getOracleAmountsOut(
      NATIVE_CURRENCY,
      paymentAsset,
      minProtocolFeeInNativeAsset,
      priceOracle.address,
      nativePaymentOracleData,
    );
    return minProtocolFeeInPaymentAsset;
  } catch (error) {
    console.error("Error in calculateMinProtocolFee:", error);
    throw error;
  }
}

async function calculateMinPositionSize(tradingOrderType, asset, nativePaymentOracleData, keeperRD, gasPrice = 0) {
  try {
    const primexDNS = await getContract("PrimexDNS");
    const priceOracle = await getContract("PriceOracle");
    let primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibrary = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibrary.deployed();

    const keeperRewardDistributor =
      keeperRD === undefined ? await getContract("KeeperRewardDistributor") : await getContractAt("KeeperRewardDistributor", keeperRD);

    const l1GasPrice = 30e9;
    const arbGasInfoArtifact = await getArtifact("ArbGasInfoMock");
    await network.provider.send("hardhat_setCode", [ArbGasInfo, arbGasInfoArtifact.deployedBytecode]);
    const arbGasInfo = await getContractAt("ArbGasInfoMock", ArbGasInfo);
    await arbGasInfo.setL1BaseFeeEstimate(l1GasPrice);

    const averageGasPerAction = await primexDNS.averageGasPerAction(tradingOrderType);
    const gasPriceBuffer = await primexDNS.gasPriceBuffer();

    const [restrictedGasPrice] = await calculateRestrictedGasPrice(gasPrice, keeperRD);
    const paymentModel = (await keeperRewardDistributor.paymentModel()).toString();
    const baseLength = await primexDNS.getL1BaseLengthForTradingOrderType(tradingOrderType);

    const l1CostWei = paymentModel === PaymentModel.ARBITRUM ? l1GasPrice * 16 * (baseLength.toNumber() + 140) : Zero;

    const protocolFeeCoefficient = await primexDNS.protocolFeeCoefficient();

    const minPositionSizeInNativeAsset = wadMul(
      averageGasPerAction.mul(restrictedGasPrice).add(l1CostWei).add(protocolFeeCoefficient).toString(),
      gasPriceBuffer.toString(),
    );

    const minPositionSize = await primexPricingLibrary.callStatic.getOracleAmountsOut(
      NATIVE_CURRENCY,
      asset,
      minPositionSizeInNativeAsset.toString(),
      priceOracle.address,
      nativePaymentOracleData,
    );
    return minPositionSize;
  } catch (error) {
    console.error("Error in calculateMinPositionSize:", error);
    throw error;
  }
}

async function calculateRestrictedGasPrice(gasPrice = 0, keeperRD = undefined) {
  try {
    const priceOracle = await getContract("PriceOracle");
    const keeperRewardDistributor =
      keeperRD === undefined ? await getContract("KeeperRewardDistributor") : await getContractAt("KeeperRewardDistributor", keeperRD);
    const l1GasPrice = 30e9;
    const arbGasInfoArtifact = await getArtifact("ArbGasInfoMock");
    await network.provider.send("hardhat_setCode", [ArbGasInfo, arbGasInfoArtifact.deployedBytecode]);
    const arbGasInfo = await getContractAt("ArbGasInfoMock", ArbGasInfo);
    const tx = await arbGasInfo.setL1BaseFeeEstimate(l1GasPrice);

    const receipt = await tx.wait();

    let restrictedGasPrice = gasPrice > 0 ? gasPrice : receipt.effectiveGasPrice;

    const oracleGasPrice = await priceOracle.getGasPrice();

    const [oracleGasPriceTolerance, defaultMaxGasPrice] = await keeperRewardDistributor.getGasCalculationParams();

    const maxGasPrice = oracleGasPrice > 0 ? wadMul(oracleGasPrice.toString(), WAD.add(oracleGasPriceTolerance)) : defaultMaxGasPrice;

    restrictedGasPrice = restrictedGasPrice.gt(maxGasPrice) ? maxGasPrice : restrictedGasPrice;

    return [restrictedGasPrice];
  } catch (error) {
    console.error("Error in calculateRestrictedGasPrice:", error);
    throw error;
  }
}

async function calculateFeeAmountInPmx(paymentAsset, pmx, feeInPaymentAssetWithDiscount, paymentPmxOracleData) {
  try {
    let primexPricingLibrary = await getContract("PrimexPricingLibrary");
    const PrimexPricingLibraryMockFactory = await getContractFactory("PrimexPricingLibraryMock", {
      libraries: {
        PrimexPricingLibrary: primexPricingLibrary.address,
      },
    });
    primexPricingLibrary = await PrimexPricingLibraryMockFactory.deploy();
    await primexPricingLibrary.deployed();

    const priceOracle = await getContract("PriceOracle");
    const feeAmountInPmx = await primexPricingLibrary.callStatic.getOracleAmountsOut(
      paymentAsset,
      pmx,
      feeInPaymentAssetWithDiscount.toString(),
      priceOracle.address,
      paymentPmxOracleData,
    );
    return feeAmountInPmx;
  } catch (error) {
    console.error("Error in calculateFeeAmountInPmx:", error);
    throw error;
  }
}

module.exports = {
  calculateFeeInPaymentAsset,
  calculateMinProtocolFee,
  calculateMinPositionSize,
  calculateRestrictedGasPrice,
  calculateFeeAmountInPmx,
};
