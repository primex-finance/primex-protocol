// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    utils: { defaultAbiCoder },
  },
} = require("hardhat");

function getLimitPriceParams(limitPrice) {
  return defaultAbiCoder.encode(["tuple(uint256)"], [[limitPrice]]);
}

function getLimitPriceAdditionalParams(firstAssetRoutes, depositInThirdAssetRoutes) {
  return defaultAbiCoder.encode(
    [
      `tuple(tuple(uint256 shares, tuple(string dexName, bytes encodedPath)[] paths)[] firstAssetRoutes, 
    tuple(uint256 shares, tuple(string dexName, bytes encodedPath)[] paths)[] depositInThirdAssetRoutes)`,
    ],
    [[firstAssetRoutes, depositInThirdAssetRoutes]],
  );
}

function getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice) {
  return defaultAbiCoder.encode(["tuple(uint256, uint256)"], [[takeProfitPrice, stopLossPrice]]);
}

function getTakeProfitStopLossAdditionalParams(routes) {
  return defaultAbiCoder.encode(["tuple(tuple(uint256 shares, tuple(string dexName, bytes encodedPath)[] paths)[]) routes"], [[routes]]);
}

function getTrailingStopParams(activationPrice, trailingDelta) {
  return defaultAbiCoder.encode(["tuple(uint256, uint256)"], [[activationPrice, trailingDelta]]);
}

function getTrailingStopAdditionalParams(highPriceRoundNumbers, lowPriceRoundNumbers) {
  return defaultAbiCoder.encode(["tuple(uint80[2], uint80[2])"], [[highPriceRoundNumbers, lowPriceRoundNumbers]]);
}

function getCondition(managerType, params) {
  return { managerType, params };
}

function decodeStopLossTakeProfit(closeConditionsFromContract, index) {
  let takeProfitPriceDecoded = 0;
  let stopLossPriceDecoded = 0;
  if (closeConditionsFromContract.length === 0) return { takeProfitPriceDecoded, stopLossPriceDecoded };

  const decodedParams = defaultAbiCoder.decode(["uint256", "uint256"], closeConditionsFromContract[index].params);
  takeProfitPriceDecoded = decodedParams[0];
  stopLossPriceDecoded = decodedParams[1];
  return { takeProfitPriceDecoded, stopLossPriceDecoded };
}

module.exports = {
  getLimitPriceParams,
  getTakeProfitStopLossParams,
  getLimitPriceAdditionalParams,
  getTakeProfitStopLossAdditionalParams,
  getTrailingStopParams,
  getTrailingStopAdditionalParams,
  getCondition,
  decodeStopLossTakeProfit,
};
