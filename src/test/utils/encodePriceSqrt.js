// SPDX-License-Identifier: BUSL-1.1
const { BigNumber: BN } = require("bignumber.js");
const { BigNumber } = require("ethers");

BN.config({ EXPONENTIAL_AT: 999999, DECIMAL_PLACES: 40 });

// returns the sqrt price as a 64x96
function encodePriceSqrt(reserve1, reserve0) {
  if (reserve0.toString() === "0" && reserve1.toString() === "0") {
    return BigNumber.from("0");
  }

  return BigNumber.from(
    new BN(reserve1.toString()).div(reserve0.toString()).sqrt().multipliedBy(new BN(2).pow(96)).integerValue(3).toString(),
  );
}

module.exports = { encodePriceSqrt };
