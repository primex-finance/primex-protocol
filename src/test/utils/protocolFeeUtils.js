const {
  ethers: { getContract },
} = require("hardhat");
const { wadMul, wadDiv } = require("./math");
const { NATIVE_CURRENCY } = require("./constants");

async function calculateMinMaxFeeInFeeToken(orderType, feeToken) {
  const PrimexDNS = await getContract("PrimexDNS");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");

  const nativeRate = await PrimexDNS.feeRates(orderType, NATIVE_CURRENCY);
  const feeTokenRate = await PrimexDNS.feeRates(orderType, feeToken);
  const discountMultiplier = wadDiv(feeTokenRate.toString(), nativeRate.toString()).toString();

  const restrictions = await PrimexDNS.feeRestrictions(orderType);
  const minProtocolFee = wadMul(restrictions.minProtocolFee.toString(), discountMultiplier).toString();
  const maxProtocolFee = wadMul(restrictions.maxProtocolFee.toString(), discountMultiplier).toString();

  const minFeeInFeeToken = await primexPricingLibrary.getOracleAmountsOut(NATIVE_CURRENCY, feeToken, minProtocolFee, priceOracle.address);
  const maxFeeInFeeToken = await primexPricingLibrary.getOracleAmountsOut(NATIVE_CURRENCY, feeToken, maxProtocolFee, priceOracle.address);

  return { minFeeInFeeToken, maxFeeInFeeToken };
}

module.exports = { calculateMinMaxFeeInFeeToken };
