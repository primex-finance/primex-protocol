// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    utils: { defaultAbiCoder },
  },
} = require("hardhat");

function getLimitPriceParams(limitPrice) {
  return defaultAbiCoder.encode(["tuple(uint256)"], [[limitPrice]]);
}

function getLimitPriceAdditionalParams(firstAssetMegaRoutes, depositInThirdAssetMegaRoutes) {
  return defaultAbiCoder.encode(
    [
      "tuple(tuple(uint256 shares, tuple(address to, tuple(string dexName, uint256 shares, bytes payload)[] paths)[] routes)[] firstAssetMegaRoutes,tuple(uint256 shares, tuple(address to, tuple(string dexName, uint256 shares, bytes payload)[] paths)[] routes)[] depositInThirdAssetMegaRoutes)",
    ],
    [[firstAssetMegaRoutes, depositInThirdAssetMegaRoutes]],
  );
}

function getTakeProfitStopLossParams(takeProfitPrice, stopLossPrice) {
  return defaultAbiCoder.encode(["tuple(uint256, uint256)"], [[takeProfitPrice, stopLossPrice]]);
}

function getTakeProfitStopLossAdditionalParams(megaRoutes, positionSoldAssetOracleData) {
  return defaultAbiCoder.encode(
    [
      "tuple(tuple(uint256 shares, tuple(address to, tuple(string dexName, uint256 shares, bytes payload)[] paths)[] routes)[] megaRoutes, bytes positionSoldAssetOracleData)",
    ],
    [[megaRoutes, positionSoldAssetOracleData]],
  );
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
