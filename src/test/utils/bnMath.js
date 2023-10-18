// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: { BigNumber },
} = require("hardhat");

const WAD = BigNumber.from("10").pow("18");
const HALF_WAD = WAD.div("2");
const RAY = BigNumber.from("10").pow("27");
const HALF_RAY = RAY.div("2");
const WAD_RAY_RATIO = BigNumber.from("10").pow("9");
const MAX_TOKEN_DECIMALITY = BigNumber.from("18");

function wadMul(a, b) {
  return HALF_WAD.add(BigNumber.from(a).mul(b)).div(WAD);
}

function wadDiv(a, b) {
  const halfB = BigNumber.from(b).div(2);
  return halfB.add(BigNumber.from(a).mul(WAD)).div(b);
}

function sqrt(y) {
  let z;
  if (y.gt(WAD)) {
    z = y;
    let x = y.div(2).add(1);
    let delta = WAD;
    while (delta.gt(WAD.div("1000"))) {
      z = x;
      x = wadDiv(y, x).add(x).div(2);
      if (z.gt(x)) {
        delta = z.sub(x);
      } else {
        delta = x.sub(z);
      }
    }
  } else if (!y.eq(0)) {
    z = WAD;
  }
  return z;
}

function fractionPower(x, y, n) {
  if (BigNumber.isBigNumber(y)) y = y.toNumber();
  if (BigNumber.isBigNumber(n)) n = n.toNumber();

  if (y > 2 ** n) {
    throw new Error("y > 2^n");
  }
  // 2^n - 1
  let bitmask = (1 << n) - 1;
  let z = WAD;
  while (y > 0) {
    if (((y >> n) & 1) === 1) {
      z = wadMul(z, x);
    }
    x = sqrt(x);
    y &= bitmask;
    bitmask >>= 1;
    if (n > 0) n--;
  }
  return z;
}

module.exports = { wadMul, wadDiv, WAD, HALF_WAD, RAY, HALF_RAY, MAX_TOKEN_DECIMALITY, WAD_RAY_RATIO, sqrt, fractionPower };
