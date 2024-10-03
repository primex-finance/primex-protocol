// SPDX-License-Identifier: BUSL-1.1
const { BigNumber } = require("bignumber.js");
const { WAD, HALF_WAD, RAY, HALF_RAY, WAD_RAY_RATIO } = require("./constants");
const secondsPerYear = new BigNumber("31536000");

function wadMul(a, b) {
  return BigNumber(HALF_WAD).plus(BigNumber(a).multipliedBy(b)).div(WAD).decimalPlaces(0, BigNumber.ROUND_DOWN);
}

function wadDiv(a, b) {
  const halfB = BigNumber(b).div(2).decimalPlaces(0, BigNumber.ROUND_DOWN);
  return halfB.plus(BigNumber(a).multipliedBy(WAD)).div(b).decimalPlaces(0, BigNumber.ROUND_DOWN);
}

function rayMul(a, b) {
  return BigNumber(HALF_RAY).plus(BigNumber(a).multipliedBy(b)).div(RAY).decimalPlaces(0, BigNumber.ROUND_DOWN);
}

function rayDiv(a, b) {
  const halfB = BigNumber(b).div(2).decimalPlaces(0, BigNumber.ROUND_DOWN);
  return halfB.plus(BigNumber(a).multipliedBy(RAY)).div(b).decimalPlaces(0, BigNumber.ROUND_DOWN);
}

function wadToRay(a) {
  return BigNumber(a).multipliedBy(WAD_RAY_RATIO).decimalPlaces(0);
}

function rayPow(a, p) {
  let x = BigNumber(a);
  let n = BigNumber(p);
  let z = !n.modulo(2).eq(0) ? x : BigNumber(RAY);

  for (n = n.div(2); n.gt(0.99); n = n.div(2)) {
    x = rayMul(x, x);

    if (!n.modulo(2).eq(0)) {
      z = rayMul(z, x);
    }
  }
  return z;
}

function calculateCompoundInterest(rate, lastUpdBlockTimestamp, currentBlockTimestamp) {
  const exp = currentBlockTimestamp - lastUpdBlockTimestamp;
  if (exp === 0) {
    return RAY;
  }
  const expMinusOne = exp - 1;
  const expMinusTwo = exp > 2 ? exp - 2 : 0;

  const ratePow2 = rayMul(rate.toString(), rate.toString());
  const secondsPerYearPow2 = secondsPerYear.multipliedBy(secondsPerYear);

  const basePowerTwo = BigNumber(ratePow2).div(secondsPerYearPow2.toString()).decimalPlaces(0, BigNumber.ROUND_DOWN);

  const ratePow3 = rayMul(ratePow2.toString(), rate.toString());
  const secondsPerYearPow3 = BigNumber(secondsPerYearPow2).multipliedBy(secondsPerYear);

  const basePowerThree = BigNumber(ratePow3).div(secondsPerYearPow3.toString()).decimalPlaces(0, BigNumber.ROUND_DOWN);

  const secondTerm = BigNumber(basePowerTwo).multipliedBy(exp).multipliedBy(expMinusOne).div(2).decimalPlaces(0, BigNumber.ROUND_DOWN);
  const thirdTerm = BigNumber(basePowerThree)
    .multipliedBy(exp)
    .multipliedBy(expMinusOne)
    .multipliedBy(expMinusTwo)
    .div(6)
    .decimalPlaces(0, BigNumber.ROUND_DOWN);

  return BigNumber(RAY)
    .plus(BigNumber(rate.toString()).multipliedBy(exp).div(secondsPerYear.toString()))
    .plus(secondTerm)
    .plus(thirdTerm)
    .decimalPlaces(0, BigNumber.ROUND_DOWN);
}

function calculateLinearInterest(rate, lastUpdBlockTimestamp, currentBlockTimestamp) {
  const exp = currentBlockTimestamp - lastUpdBlockTimestamp;
  return new BigNumber(rate).multipliedBy(exp).div(secondsPerYear).plus(RAY);
}

function calculateMaxAssetLeverage(
  feeBuffer,
  maintenanceBuffer,
  securityBuffer,
  pairPriceDropBA,
  oracleTolerableLimitAB,
  oracleTolerableLimitBA,
  feeRate,
) {
  const bnWAD = BigNumber(WAD);
  const numerator = wadMul(bnWAD.plus(maintenanceBuffer.toString()).toString(), feeBuffer.toString());
  const denominator = wadMul(bnWAD.plus(maintenanceBuffer.toString()).toString(), feeBuffer.toString())
    .minus(
      wadMul(
        bnWAD.minus(securityBuffer.toString()).toString(),
        wadMul(
          bnWAD.minus(pairPriceDropBA.toString()).toString(),
          wadMul(bnWAD.minus(oracleTolerableLimitAB.toString()).toString(), bnWAD.minus(oracleTolerableLimitBA.toString()).toString()),
        ),
      ),
    )
    .plus(feeRate.toString())
    .toString();
  return wadDiv(numerator, denominator);
}

function calculateBar(ur, barCalcParams) {
  let newBAR;

  if (BigNumber(ur.toString()).isLessThanOrEqualTo(BigNumber(barCalcParams.urOptimal.toString()))) {
    newBAR = BigNumber(rayMul(barCalcParams.k0.toString(), ur.toString()).toString()).plus(BigNumber(barCalcParams.b0.toString()));
  } else {
    const k1modified = BigNumber(rayMul(barCalcParams.k1.toString(), ur.toString()).toString());
    if (BigNumber(barCalcParams.b1.toString()).isNegative()) {
      const b1modified = BigNumber(barCalcParams.b1.toString()).negated();
      newBAR = k1modified.minus(b1modified);
      if (newBAR < 0) throw new Error("newBar overflow");
    } else {
      newBAR = k1modified.plus(BigNumber(barCalcParams.b1.toString()));
    }
  }
  return newBAR;
}

module.exports = {
  wadMul,
  wadDiv,
  rayMul,
  rayDiv,
  rayPow,
  wadToRay,
  calculateCompoundInterest,
  calculateLinearInterest,
  calculateMaxAssetLeverage,
  calculateBar,
};
