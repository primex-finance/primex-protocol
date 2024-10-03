// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { FeeRateType, TradingOrderType, CallingMethod } = require("../../test/utils/constants");
module.exports = async ({
  run,
  ethers: {
    getContract,
    utils: { parseEther },
    constants: { MaxUint256 },
  },
}) => {
  const PMXToken = await getContract("EPMXToken");
  const registry = await getContract("Registry");
  const Treasury = await getContract("Treasury");
  const errorsLibrary = await getContract("Errors");

  const SECONDS_PER_DAY = 24 * 60 * 60;
  const { PrimexDNSconfig } = getConfigByName("generalConfig.json");

  const delistingDelay = PrimexDNSconfig.delistingDelayInDays * SECONDS_PER_DAY;
  const adminWithdrawalDelay = PrimexDNSconfig.adminWithdrawalDelayInDays * SECONDS_PER_DAY;

  const feeRateParams = [];
  const averageGasPerActionParams = [];
  const restrictions = [];

  for (const feeRateType in FeeRateType) {
    feeRateParams.push({
      feeRateType: FeeRateType[feeRateType],
      feeRate: parseEther(PrimexDNSconfig.feeRates[feeRateType]).toString(),
    });
  }

  for (const tradingOrderType in TradingOrderType) {
    averageGasPerActionParams.push({
      tradingOrderType: TradingOrderType[tradingOrderType],
      averageGasPerAction: PrimexDNSconfig.averageGasPerAction[tradingOrderType].toString(),
    });
  }
  let maxProtocolFee = PrimexDNSconfig.maxProtocolFee;
  maxProtocolFee = (maxProtocolFee === "MaxUint256" ? MaxUint256 : parseEther(maxProtocolFee)).toString();
  const liquidationGasAmount = PrimexDNSconfig.liquidationGasAmount.toString();
  const protocolFeeCoefficient = PrimexDNSconfig.protocolFeeCoefficient.toString();
  const additionalGasSpent = PrimexDNSconfig.additionalGasSpent.toString();
  const pmxDiscountMultiplier = parseEther(PrimexDNSconfig.pmxDiscountMultiplier).toString();
  const gasPriceBuffer = parseEther(PrimexDNSconfig.gasPriceBuffer).toString();

  for (const callingMethod in CallingMethod) {
    const maxGasAmount = PrimexDNSconfig.minFeeRestrictions[callingMethod].maxGasAmount;
    const baseLength = PrimexDNSconfig.minFeeRestrictions[callingMethod].baseLength;
    const minFeeRestrictions = {
      maxGasAmount: maxGasAmount === "MaxUint256" ? MaxUint256 : maxGasAmount.toString(),
      baseLength: baseLength === "MaxUint256" ? MaxUint256 : baseLength.toString(),
    };
    restrictions.push({ callingMethod: CallingMethod[callingMethod], minFeeRestrictions: minFeeRestrictions });
  }

  await run("deploy:PrimexDNS", {
    registry: registry.address,
    pmx: PMXToken.address,
    treasury: Treasury.address,
    delistingDelay: delistingDelay.toString(),
    adminWithdrawalDelay: adminWithdrawalDelay.toString(),
    feeRateParams: JSON.stringify(feeRateParams),
    averageGasPerActionParams: JSON.stringify(averageGasPerActionParams),
    maxProtocolFee: maxProtocolFee,
    liquidationGasAmount: liquidationGasAmount,
    protocolFeeCoefficient: protocolFeeCoefficient,
    additionalGasSpent: additionalGasSpent,
    pmxDiscountMultiplier: pmxDiscountMultiplier,
    gasPriceBuffer: gasPriceBuffer,
    errorsLibrary: errorsLibrary.address,
    restrictions: JSON.stringify(restrictions),
  });
};
module.exports.tags = ["PrimexDNS", "Test", "PrimexCore"];
module.exports.dependencies = ["Registry", "EPMXToken", "Treasury", "Errors", "PrimexProxyAdmin"];
