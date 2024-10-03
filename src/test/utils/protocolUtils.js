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

async function calculateFeeInPositionAsset(
  positionAsset,
  positionSize,
  feeRateType,
  gasSpent,
  isFeeOnlyInPositionAsset,
  nativePositionOracleData,
  keeperRD,
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

    const protocolFeeRate = await primexDNS.protocolFeeRates(feeRateType);
    const maxProtocolFee = await primexDNS.maxProtocolFee();
    let feeInPositionAsset = BigNumber.from(wadMul(positionSize.toString(), protocolFeeRate.toString()).toString());
    let maxProtocolFeeInPositionAsset;

    if (maxProtocolFee.toString() === MaxUint256.toString()) {
      maxProtocolFeeInPositionAsset = maxProtocolFee;
    } else {
      maxProtocolFeeInPositionAsset = await primexPricingLibrary.callStatic.getOracleAmountsOut(
        NATIVE_CURRENCY,
        positionAsset,
        maxProtocolFee,
        priceOracle.address,
        nativePositionOracleData,
      );
      console.log(maxProtocolFeeInPositionAsset.toString(), "maxProtocolFeeInPositionAsset");
    }
    // The minProtocolFee is applied only if the order/position is processed by Keepers
    if (
      feeRateType === FeeRateType.MarginPositionClosedByTrader ||
      feeRateType === FeeRateType.SpotPositionClosedByTrader ||
      feeRateType === FeeRateType.SwapMarketOrder
    ) {
      feeInPositionAsset = feeInPositionAsset.lt(maxProtocolFeeInPositionAsset) ? feeInPositionAsset : maxProtocolFeeInPositionAsset;
    } else {
      const minProtocolFeeInPositionAsset = await calculateMinProtocolFee(
        gasSpent,
        positionAsset,
        feeRateType,
        isFeeOnlyInPositionAsset,
        keeperRD,
        nativePositionOracleData,
      );

      if (minProtocolFeeInPositionAsset.gt(positionSize)) {
        throw new Error("MIN_PROTOCOL_FEE_IS_GREATER_THAN_POSITION_SIZE");
      }
      feeInPositionAsset = feeInPositionAsset.gt(minProtocolFeeInPositionAsset) ? feeInPositionAsset : minProtocolFeeInPositionAsset;
      feeInPositionAsset = feeInPositionAsset.lt(maxProtocolFeeInPositionAsset) ? feeInPositionAsset : maxProtocolFeeInPositionAsset;
    }
    return BigNumber.from(feeInPositionAsset.toString());
  } catch (error) {
    console.error("Error in calculateFeeInPositionAsset:", error);
    throw error;
  }
}

async function calculateMinProtocolFee(
  restrictedGasSpent,
  positionAsset,
  feeRateType,
  isFeeOnlyInPositionAsset,
  keeperRD,
  nativePositionOracleData,
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
    if (isFeeOnlyInPositionAsset) {
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

    const minProtocolFeeInPositionAsset = await primexPricingLibrary.callStatic.getOracleAmountsOut(
      NATIVE_CURRENCY,
      positionAsset,
      minProtocolFeeInNativeAsset,
      priceOracle.address,
      nativePositionOracleData,
    );
    return minProtocolFeeInPositionAsset;
  } catch (error) {
    console.error("Error in calculateMinProtocolFee:", error);
    throw error;
  }
}

async function calculateMinPositionSize(tradingOrderType, asset, nativePositionOracleData, keeperRD, gasPrice = 0) {
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
    const baseLength = await primexDNS.getArbitrumBaseLengthForTradingOrderType(tradingOrderType);

    const l1CostWei = paymentModel === PaymentModel.ARBITRUM ? l1GasPrice * 16 * (baseLength.toNumber() + 140) : Zero;

    const minPositionSizeInNativeAsset = wadMul(
      averageGasPerAction.mul(restrictedGasPrice).add(l1CostWei).toString(),
      gasPriceBuffer.toString(),
    );

    const minPositionSize = await primexPricingLibrary.callStatic.getOracleAmountsOut(
      NATIVE_CURRENCY,
      asset,
      minPositionSizeInNativeAsset.toString(),
      priceOracle.address,
      nativePositionOracleData,
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

async function calculateFeeAmountInPmx(positionAsset, pmx, feeInPositonAssetWithDiscount, positionPmxOracleData) {
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
      positionAsset,
      pmx,
      feeInPositonAssetWithDiscount.toString(),
      priceOracle.address,
      positionPmxOracleData,
    );
    return feeAmountInPmx;
  } catch (error) {
    console.error("Error in calculateFeeAmountInPmx:", error);
    throw error;
  }
}

module.exports = {
  calculateFeeInPositionAsset,
  calculateMinProtocolFee,
  calculateMinPositionSize,
  calculateRestrictedGasPrice,
  calculateFeeAmountInPmx,
};
