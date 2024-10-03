// SPDX-License-Identifier: BUSL-1.1
const { BigNumber: BN } = require("bignumber.js");
const { BigNumber } = require("ethers");

const WAD = Math.pow(10, 18).toString();
const HALF_WAD = new BN(WAD).multipliedBy(0.5).toString();
const RAY = new BN(10).exponentiatedBy(27).toFixed();
const HALF_RAY = new BN(RAY).multipliedBy(0.5).toFixed();
const WAD_RAY_RATIO = Math.pow(10, 9).toString();
const MAX_TOKEN_DECIMALITY = BigNumber.from("18");
const NATIVE_CURRENCY = "0x99ec76235f8a5A52611b0DA5F0C6B09e1dCD2C9e"; // address(uint160(bytes20(keccak256("NATIVE_CURRENCY"))))
const NATIVE_CURRENCY_DECIMALS = 18;
const USD = "0x0000000000000000000000000000000000000348";
const USD_DECIMALS = 8;
const USD_MULTIPLIER = BigNumber.from("10").pow(18 - 8);

const ETH = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const ArbGasInfo = "0x000000000000000000000000000000000000006C";

const PaymentModel = Object.freeze({
  DEFAULT: "0",
  ARBITRUM: "1",
});

const CloseReason = Object.freeze({
  CLOSE_BY_TRADER: 0,
  RISKY_POSITION: 1,
  BUCKET_DELISTED: 2,
  LIMIT_CONDITION: 3,
  BATCH_LIQUIDATION: 4,
  BATCH_STOP_LOSS: 5,
  BATCH_TAKE_PROFIT: 6,
});

const FeeRateType = Object.freeze({
  MarginPositionClosedByTrader: 0,
  SpotPositionClosedByTrader: 1,
  MarginPositionClosedByKeeper: 2,
  SpotPositionClosedByKeeper: 3,
  MarginLimitOrderExecuted: 4,
  SpotLimitOrderExecuted: 5,
  SwapLimitOrderExecuted: 6,
  SwapMarketOrder: 7,
});

const TradingOrderType = Object.freeze({
  MarginMarketOrder: 0,
  SpotMarketOrder: 1,
  MarginLimitOrder: 2,
  MarginLimitOrderDepositInThirdAsset: 3,
  SpotLimitOrder: 4,
  SwapLimitOrder: 5,
});

const CallingMethod = Object.freeze({
  OpenPositionByOrder: 0,
  ClosePositionByCondition: 1,
});

const OracleType = Object.freeze({
  Pyth: 0,
  Chainlink: 1,
  Uniswapv3: 2,
});

const ORDER_INFO_DECODE = [
  "uint256",
  "uint256",
  "tuple(uint256,uint256,bytes,tuple(uint256,tuple(address,tuple(string,uint256,bytes)[])[])[],tuple(uint256,tuple(address,tuple(string,uint256,bytes)[])[])[])[]",
];

const POSITION_INFO_DECODE = [
  "uint256",
  "uint256",
  "tuple(uint256,uint256,bytes,tuple(uint256,tuple(address,tuple(string,uint256,bytes)[])[])[],uint8)[]",
];

const BAR_CALC_PARAMS_DECODE = ["(uint256,uint256,uint256,uint256,int256)"];

const LIMIT_PRICE_CM_TYPE = 1;
const TAKE_PROFIT_STOP_LOSS_CM_TYPE = 2;
const TRAILING_STOP_CM_TYPE = 3;

const KeeperActionType = Object.freeze({
  OpenByOrder: 0,
  StopLoss: 1,
  TakeProfit: 2,
  Liquidation: 3,
  BucketDelisted: 4,
});

const DecreasingReason = Object.freeze({
  NonExistentIdForLiquidation: 0,
  NonExistentIdForSLOrTP: 1,
  IncorrectConditionForLiquidation: 2,
  IncorrectConditionForSL: 3,
  ClosePostionInTheSameBlock: 4,
});

const KeeperCallingMethod = Object.freeze({
  ClosePositionByCondition: 0,
  OpenPositionByOrder: 1,
  CloseBatchPositions: 2,
});

module.exports = {
  WAD,
  HALF_WAD,
  RAY,
  HALF_RAY,
  WAD_RAY_RATIO,
  MAX_TOKEN_DECIMALITY,
  NATIVE_CURRENCY,
  NATIVE_CURRENCY_DECIMALS,
  USD,
  USD_DECIMALS,
  USD_MULTIPLIER,
  ETH,
  ArbGasInfo,
  PaymentModel,
  CloseReason,
  FeeRateType,
  TradingOrderType,
  ORDER_INFO_DECODE,
  POSITION_INFO_DECODE,
  BAR_CALC_PARAMS_DECODE,
  LIMIT_PRICE_CM_TYPE,
  TAKE_PROFIT_STOP_LOSS_CM_TYPE,
  TRAILING_STOP_CM_TYPE,
  KeeperActionType,
  DecreasingReason,
  KeeperCallingMethod,
  CallingMethod,
  OracleType,
};
