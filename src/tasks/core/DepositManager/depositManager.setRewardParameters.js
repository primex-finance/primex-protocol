// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { __ },
  {
    ethers: {
      getContract,
      utils: { parseEther, parseUnits },
    },
  },
) {
  const { getConfigByName } = require("../../../config/configUtils.js");
  const { SECONDS_PER_DAY } = require("../../../Constants.js");
  const { DepositManagerConfig } = getConfigByName("generalConfig.json");

  const depositManager = await getContract("DepositManager");
  const primexDNS = await getContract("PrimexDNS");

  if (depositManager.newlyDeployed) {
    const rewardParameters = [];

    // Iterate over each bucket in the configuration
    for (const bucket of DepositManagerConfig.buckets) {
      const bucketAddress = await primexDNS.getBucketAddress(bucket.bucketName);
      const Bucket = await getContract("Bucket", bucketAddress);

      const bucketRewardTokens = [];
      const bucketDurations = [];
      const bucketNewInterestRates = [];

      // Iterate over each reward token for the current bucket
      for (const rewardToken of bucket.rewardTokens) {
        const tokenDurations = [];
        const tokenNewInterestRates = [];
        // Iterate over each duration for the current reward token
        for (const duration of rewardToken.durations) {
          tokenDurations.push(duration.durationInDays * SECONDS_PER_DAY);
          tokenNewInterestRates.push(parseEther(duration.newInterestRate).toString());
        }
        bucketRewardTokens.push(rewardToken.rewardTokenAddress);
        bucketDurations.push(tokenDurations);
        bucketNewInterestRates.push(tokenNewInterestRates);
      }
      const borrowedAsset = await Bucket.borrowedAsset();

      rewardParameters.push({
        bucket: bucket.bucketAddress,
        rewardTokens: bucketRewardTokens,
        durations: bucketDurations,
        newInterestRates: bucketNewInterestRates,
        maxTotalDeposit: parseUnits(bucket.maxTotalDeposit, await borrowedAsset.decimals()),
      });
    }

    // Call setRewardParameters with the prepared data
    await depositManager.setRewardParameters(rewardParameters);
    console.log("Reward paramaters are setted in DepositManager");
  }
};
