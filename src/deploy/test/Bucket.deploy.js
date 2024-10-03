const { barCalcParams } = require("../../test/utils/defaultBarCalcParams");

// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({
  run,
  ethers: {
    getContract,
    getNamedSigners,
    getContractFactory,
    constants: { MaxUint256 },
  },
}) => {
  if (process.env.TEST) {
    const { deployer } = await getNamedSigners();
    const TokenA = await getContract("TestTokenA");
    const TokenB = await getContract("TestTokenB");
    const priceOracle = await getContract("PriceOracle");
    const pairPriceDrop = "100000000000000000"; // 0.1 in wad
    await priceOracle.setPairPriceDrop(TokenB.address, TokenA.address, pairPriceDrop);
    const PrimexAggregatorV3TestServiceFactory = await getContractFactory("PrimexAggregatorV3TestService");
    const priceFeedTTAUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTA_USD", deployer.address);
    const priceFeedTTBUSD = await PrimexAggregatorV3TestServiceFactory.deploy("TTB_USD", deployer.address);
    const priceFeeds = { tokens: [TokenA.address, TokenB.address], feeds: [priceFeedTTAUSD.address, priceFeedTTBUSD.address] };
    await run("priceOracle:updateChainlinkPriceFeedsUsd", {
      priceOracle: priceOracle.address,
      updatePriceFeeds: JSON.stringify(priceFeeds),
    });

    await run("deploy:Bucket", {
      nameBucket: "bucket1",
      assets: `["${TokenB.address}"]`,
      feeBuffer: "1000100000000000000", // 1.0001
      withdrawalFeeRate: "5000000000000000", // 0.005 - 0.5%
      reserveRate: "100000000000000000", // 0.1 - 10%,
      underlyingAsset: TokenA.address,
      liquidityMiningAmount: "0",
      estimatedBar: "100000000000000000000000000", // 0.1 in ray
      estimatedLar: "70000000000000000000000000", // 0.07 in ray
      barCalcParams: JSON.stringify(barCalcParams),
      maxTotalDeposit: MaxUint256.toString(),
    });
  }
};

module.exports.tags = ["Bucket", "Test"];
module.exports.dependencies = [
  "Registry",
  "PrimexDNS",
  "WhiteBlackList",
  "BucketsFactory",
  "TestTokens",
  "PriceOracle",
  "Reserve",
  "InterestRateStrategy",
  "ActivityRewardDistributor",
  "PrimexAggregatorV3TestService",
  "BucketExtension",
];
