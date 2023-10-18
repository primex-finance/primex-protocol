// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("setup:MintTokens", "Mint TestTokenA to deployer, trader and TestTokenB to deployer", require("./tokenERC20Mint.js"));

task("setup:LimitedMint", "Enable limited mint on test tokens", require("./tokenERC20AddLimit.js")).addFlag(
  "disable",
  "Disable limited token minting",
);

task("setup:Buckets", "Create Buckets for trading", require("./setupBuckets.js"))
  .addOptionalParam("bucketsConfig", "Name of file with buckets config in config/network folder")
  .addFlag("isExecute", "Flag to indicate if it is a proposal or execution");

task("setup:addLiquidity", "Create new liquidity pool and add liquidity", require("./addLiquidityAB.js"));

task("setup:addLiquidityUniswapV3", "Create new liquidity pool and add liquidity", require("./addLiquidityABUniswapV3.js"));

task("setup:addLiquidityQuickswapV3", "Create new liquidity pool and add liquidity", require("./addLiquidityABQuickswapV3.js"));

task("setup:addLiquidityCurve", "Create new liquidity pool and add liquidity on Curve DEX", require("./addLiquidityABCurve.js"));

task("setup:addLiquidityBalancer", "Create new liquidity pool and add liquidity on Balancer DEX", require("./addLiquidityABBalancer.js"));

task("setup:addLiquidityMeshswap", "Creates pools and adds liquidity to them for Meshswap dex", require("./addLiquidityABMeshswap.js"));

task("setup:PriceFeeds", "Setup self deployed price oracle feeds", require("./PriceFeedsSetup.js"));

task("deploy:Pricefeeds", "Deploy price oracle feeds", require("./Pricefeeds.deploy.js"));

task(
  "setup:chainLinkSetup",
  "Set keepers and register upkeeps in KeeperRegistry. Payees is matched to the keepers. Payees and keepers count must match and be greater than 2. Default values are the first two addresses in hardhat",
  require("./chainLinkSetup.js"),
)
  .addOptionalParam("keepers", "The list of keepers addresses")
  .addOptionalParam("payees", "The list of payees addresses");

task(
  "setup:earlyRewardsInBuckets",
  "setup early rewards in all deployed buckets for LENDER and TRADER roles with predefined values",
  require("./setupEarlyRewardsInBuckets.js"),
);

task("setup:SpotTradingRewardDistributor", "Set reward per period and top up pmx balance", require("./setupSpotTradingRewards"));

task("setup:pairsConfig", "Setup pair priceDrops, maxSize and OracleTorelableLimit", require("./setupPairsConfig.js"))
  .addOptionalParam("positionManager", "The address of the PositionManager contract")
  .addOptionalParam("priceOracle", "The address of the PriceOracle contract");

task("setup:addAccessToConfigAdmins", "Add admin access in PrimexProtocol to admin from config", require("./addAccessToConfigAdmins.js"));
task("setup:revokeDeployerAccess", "Setup pair priceDrops, maxSize and OracleTorelableLimit", require("./revokeDeployerAccess.js"));
task("setFinalParamsOnPolygonMainnet", "Set final params on Polygon Mainnet", require("./setFinalParamsOnPolygonMainnet"));

task("setup:setRolesForContractsOnly", "Set which roles are intended only for contracts", require("./setRolesForContractsOnly.js"));
