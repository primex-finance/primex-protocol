// SPDX-License-Identifier: BUSL-1.1

// example
// yarn hardhat run scripts/extraLenderRewards.js --no-compile --network polygon
const {
  network,
  ethers: {
    BigNumber,
    utils: { formatUnits, formatEther, parseUnits, isAddress },
    provider,
    getContractAt,
    getContract,
  },
} = require("hardhat");
const fs = require("fs");
const path = require("path");

const { USD } = require("../test/utils/constants.js");
const SECONDS_PER_YEAR = 365 * 24 * 60 * 60;

const { bucketAddress, percent } = require("./extraLRconfig.json");

const pathToConfig = path.join(__dirname, "extraLRconfig.json");
if (!isAddress(bucketAddress)) throw new Error(`"bucketAddress" in ${pathToConfig} is not address`);

async function getBlockByTimestamp(desiredTimestamp, blockFrom = 0, blockTo) {
  const latestBlock = await provider.getBlock(blockTo === undefined ? "latest" : blockTo);
  if (latestBlock.timestamp < desiredTimestamp) {
    throw new Error(`required timestamp(${desiredTimestamp}) has not occurred`);
  }

  blockTo = latestBlock.number;
  while (true) {
    const middleBlock = Math.floor((blockTo + blockFrom) / 2);
    const timestamp = (await provider.getBlock(middleBlock)).timestamp;
    if (desiredTimestamp > timestamp) {
      blockFrom = middleBlock;
    } else {
      blockTo = middleBlock;
    }
    if (blockTo === blockFrom || blockTo - blockFrom === 1) {
      return blockTo;
    }
  }
}

let priceOracle;
async function getPriceInBlock(asset, blockNumber) {
  if (priceOracle === undefined) priceOracle = await getContract("PriceOracle");
  const [price] = await priceOracle.getExchangeRate(asset, USD, { blockTag: blockNumber });
  return price;
}

async function main() {
  console.log("Bucket address - ", bucketAddress);
  console.log("Percent - ", percent);
  const LMdistributor = await getContract("LiquidityMiningRewardDistributor");

  const bucket = await getContractAt("Bucket", bucketAddress);

  const borrowedAsset = await bucket.borrowedAsset();
  const borrowedAssetContract = await getContractAt("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20", borrowedAsset);
  const decimals = await borrowedAssetContract.decimals();

  const bucketName = await bucket.name();

  const blockOfLaunch = (await bucket.queryFilter("BucketLaunched"))[0].blockNumber;

  const stabilizationEndTimestamp = (await bucket.getLiquidityMiningParams()).stabilizationEndTimestamp.toNumber();
  const stabilizationEndBlock = await getBlockByTimestamp(stabilizationEndTimestamp, blockOfLaunch);

  const blockOfLaunchPrice = await getPriceInBlock(borrowedAsset, blockOfLaunch);
  const stabilizationEndBlockPrice = await getPriceInBlock(borrowedAsset, stabilizationEndBlock);

  const lenders = await bucket.queryFilter("Deposit", 0, blockOfLaunch);
  const uniqueLenders = {};

  let totalReward = BigNumber.from(0);
  let blockNumber = 0;
  for (const lender of lenders) {
    // additional check of the order of events
    if (lender.blockNumber < blockNumber) throw new Error("The order of events is violated");
    blockNumber = lender.blockNumber;
    const lenderAddress = lender.args.pTokenReceiver;
    if (uniqueLenders[lenderAddress] === undefined) {
      const LMamount = await LMdistributor.getLenderAmountInMining(bucketName, lenderAddress, {
        blockTag: blockOfLaunch,
      });
      if (LMamount.isZero()) continue;
      uniqueLenders[lenderAddress] = {};
      uniqueLenders[lenderAddress].firstDepositBlock = lender.blockNumber;
      uniqueLenders[lenderAddress].lockDuration = stabilizationEndTimestamp - (await lender.getBlock(lender.blockNumber)).timestamp;
      uniqueLenders[lenderAddress].LMamount = Number(formatUnits(LMamount, decimals));

      const lenderFirstDepositPrice = await getPriceInBlock(borrowedAsset, lender.blockNumber);
      uniqueLenders[lenderAddress].averagePrice = Number(
        formatEther(blockOfLaunchPrice.add(stabilizationEndBlockPrice).add(lenderFirstDepositPrice).div(3)),
      );

      // calculation taking into account simple interest
      const rewardInUSD =
        uniqueLenders[lenderAddress].LMamount *
        uniqueLenders[lenderAddress].averagePrice *
        (((percent / 100) * uniqueLenders[lenderAddress].lockDuration) / SECONDS_PER_YEAR);
      uniqueLenders[lenderAddress].rewardInUSD = Number(rewardInUSD.toFixed(6)); // 6 is decimals of reward token

      // convert to BigNumber to get the exact number
      totalReward = totalReward.add(parseUnits(uniqueLenders[lenderAddress].rewardInUSD.toString(), 6));
    }
  }

  const pathToConfig = path.join(__dirname, `${network.name}-${bucketName.replaceAll(" ", "")}-extraLenderRewards.json`);
  fs.writeFileSync(pathToConfig, JSON.stringify(uniqueLenders, null, 2));
  console.log("Lenders count", Object.keys(uniqueLenders).length);
  console.log("Total amount of remuneration in USD is ", Number(formatUnits(totalReward, 6)));
}

main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
