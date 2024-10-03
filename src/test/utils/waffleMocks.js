// SPDX-License-Identifier: BUSL-1.1
const {
  deployments,
  ethers: {
    utils: { parseEther },
  },
} = require("hardhat");
const { deployMockContract } = require("@ethereum-waffle/mock-contract");

async function abi(contract) {
  const artifact = await deployments.getArtifact(contract);
  return artifact.abi;
}

async function deployMockReserve(deployer) {
  const mockReserve = await deployMockContract(deployer, await abi("Reserve"));
  await mockReserve.mock.supportsInterface.returns(true);
  return mockReserve;
}

async function deployMockPToken(deployer) {
  const mockPtoken = await deployMockContract(deployer, await abi("PToken"));
  await mockPtoken.mock.supportsInterface.returns(true);
  await mockPtoken.mock.transferFrom.returns(true);
  await mockPtoken.mock.burn.returns(0);
  await mockPtoken.mock.setBucket.returns();
  await mockPtoken.mock.mintToReserve.returns();
  return mockPtoken;
}
async function deployMockPMXToken(deployer) {
  const mockPmxtoken = await deployMockContract(deployer, await abi("PMXToken"));
  await mockPmxtoken.mock.supportsInterface.returns(true);
  await mockPmxtoken.mock.approve.returns(true);
  await mockPmxtoken.mock.transferFrom.returns(true);
  await mockPmxtoken.mock.transfer.returns(true);
  await mockPmxtoken.mock.decimals.returns("18");
  return mockPmxtoken;
}

async function deployMockPtokensFactory(deployer) {
  const mockPtokensFactory = await deployMockContract(deployer, await abi("PTokensFactory"));
  await mockPtokensFactory.mock.supportsInterface.returns(true);
  return mockPtokensFactory;
}

async function deployMockBucketsFactory(deployer) {
  const mockBucketsFactory = await deployMockContract(deployer, await abi("BucketsFactory"));
  await mockBucketsFactory.mock.supportsInterface.returns(true);
  return mockBucketsFactory;
}

async function deployMockDebtToken(deployer) {
  const mockDebtToken = await deployMockContract(deployer, await abi("DebtToken"));
  await mockDebtToken.mock.supportsInterface.returns(true);
  await mockDebtToken.mock.burn.returns();
  await mockDebtToken.mock.scaledTotalSupply.returns(100);
  await mockDebtToken.mock.totalSupply.returns(1000);
  await mockDebtToken.mock.setBucket.returns();
  return mockDebtToken;
}

async function deployMockDebtTokensFactory(deployer) {
  const mockDebtTokensFactory = await deployMockContract(deployer, await abi("DebtTokensFactory"));
  await mockDebtTokensFactory.mock.supportsInterface.returns(true);
  return mockDebtTokensFactory;
}

async function deployMockPositionManager(deployer) {
  const mockPositionManager = await deployMockContract(deployer, await abi("PositionManager"));
  await mockPositionManager.mock.supportsInterface.returns(true);
  return mockPositionManager;
}

async function deployMockLimitOrderManager(deployer) {
  const mockLimitOrderManager = await deployMockContract(deployer, await abi("LimitOrderManager"));
  await mockLimitOrderManager.mock.supportsInterface.returns(true);
  return mockLimitOrderManager;
}

async function deployMockBestDexLens(deployer) {
  const mockBestDexLens = await deployMockContract(deployer, await abi("BestDexLens"));
  await mockBestDexLens.mock.supportsInterface.returns(true);
  return mockBestDexLens;
}

async function deployMockPrimexLens(deployer) {
  const mockPrimexLens = await deployMockContract(deployer, await abi("PrimexLens"));
  await mockPrimexLens.mock.supportsInterface.returns(true);
  return mockPrimexLens;
}

async function deployMockPrimexDNS(deployer) {
  const mockPrimexDns = await deployMockContract(deployer, await abi("PrimexDNS"));
  await mockPrimexDns.mock.supportsInterface.returns(true);
  return mockPrimexDns;
}

async function deployMockAccessControl(deployer) {
  const mockAccessControl = await deployMockContract(deployer, await abi("AccessControl"));
  await mockAccessControl.mock.supportsInterface.returns(true);
  await mockAccessControl.mock.hasRole.returns(true);
  return mockAccessControl;
}

async function deployMockAccessControlUpgradeable(deployer) {
  const mockAccessControlUpgradeable = await deployMockContract(deployer, await abi("AccessControlUpgradeable"));
  await mockAccessControlUpgradeable.mock.supportsInterface.returns(true);
  await mockAccessControlUpgradeable.mock.hasRole.returns(true);
  return mockAccessControlUpgradeable;
}

async function deployMockWhiteBlackList(deployer) {
  const mockWhiteBlackList = await deployMockContract(deployer, await abi("WhiteBlackList"));
  await mockWhiteBlackList.mock.supportsInterface.returns(true);
  await mockWhiteBlackList.mock.isBlackListed.returns(false);
  await mockWhiteBlackList.mock.addAddressToWhitelist.returns();
  await mockWhiteBlackList.mock.addAddressesToWhitelist.returns();
  return mockWhiteBlackList;
}

async function deployMockPositionManagerExtension(deployer) {
  const mockPositionManagerExtension = await deployMockContract(deployer, await abi("WhiteBlackList"));
  await mockPositionManagerExtension.mock.supportsInterface.returns(true);
  return mockPositionManagerExtension;
}

async function deployMockWhiteBlackListReferral(deployer) {
  const mockWhiteBlackList = await deployMockContract(deployer, await abi("WhiteBlackListRefferal"));
  await mockWhiteBlackList.mock.supportsInterface.returns(true);
  await mockWhiteBlackList.mock.addAddressToWhitelist.returns();
  return mockWhiteBlackList;
}

async function deployMockERC20(deployer, decimals = 18) {
  const mockErc20 = await deployMockContract(deployer, await abi("@openzeppelin/contracts/token/ERC20/ERC20.sol:ERC20"));
  await mockErc20.mock.approve.returns(true);
  await mockErc20.mock.balanceOf.returns(10);
  await mockErc20.mock.transfer.returns(true);
  await mockErc20.mock.transferFrom.returns(true);
  await mockErc20.mock.decimals.returns(decimals);
  await mockErc20.mock.symbol.returns("symbol");
  await mockErc20.mock.name.returns("name");

  return mockErc20;
}

async function deployMockERC165(deployer) {
  const mockErc165 = await deployMockContract(deployer, await abi("ERC165"));
  await mockErc165.mock.supportsInterface.returns(true);
  return mockErc165;
}

async function deployMockBucket(deployer) {
  const mockBucket = await deployMockContract(deployer, await abi("Bucket"));
  await mockBucket.mock.paybackPermanentLoss.returns();
  await mockBucket.mock.supportsInterface.returns(true);
  return mockBucket;
}

async function deployMockPriceOracle(deployer) {
  const mockPriceOracle = await deployMockContract(deployer, await abi("PriceOracle"));
  await mockPriceOracle.mock.supportsInterface.returns(true);
  const defaultExchangeRate = parseEther("10");
  await mockPriceOracle.mock.getExchangeRate.returns(defaultExchangeRate);
  return [mockPriceOracle, defaultExchangeRate];
}

async function deployMockTraderBalanceVault(deployer) {
  const mockTraderBalanceVault = await deployMockContract(deployer, await abi("TraderBalanceVault"));
  await mockTraderBalanceVault.mock.supportsInterface.returns(true);
  return mockTraderBalanceVault;
}

async function deployMockDexAdapter(deployer) {
  const mockDexAdapter = await deployMockContract(deployer, await abi("DexAdapter"));
  await mockDexAdapter.mock.supportsInterface.returns(true);
  return mockDexAdapter;
}

async function deployMockTreasury(deployer) {
  const mockTreasury = await deployMockContract(deployer, await abi("Treasury"));
  await mockTreasury.mock.supportsInterface.returns(true);
  return mockTreasury;
}

async function deployMockSwapManager(deployer) {
  const mockSwapManager = await deployMockContract(deployer, await abi("SwapManager"));
  await mockSwapManager.mock.supportsInterface.returns(true);
  return mockSwapManager;
}

async function deployMockIQuoterV3Uniswap(deployer) {
  const mockIQuoterV3Uniswap = await deployMockContract(
    deployer,
    await abi("@uniswap/v3-periphery/contracts/interfaces/IQuoter.sol:IQuoter"),
  );
  return mockIQuoterV3Uniswap;
}

async function deployMockTokenTransfersLibrary(deployer) {
  const mockTokenTransfersLibrary = await deployMockContract(deployer, await abi("TokenTransfersLibrary"));
  await mockTokenTransfersLibrary.mock.doTransferOut.returns();
  return mockTokenTransfersLibrary;
}

async function deployMockPrimexPricingLibrary(deployer) {
  const mockPrimexPricingLibrary = await deployMockContract(deployer, await abi("PrimexPricingLibrary"));
  await mockPrimexPricingLibrary.mock.getOracleAmountsOut.returns(15);
  return mockPrimexPricingLibrary;
}

async function deployMockAggregatorV3Interface(deployer) {
  const mockAggregatorInterface = await deployMockContract(deployer, await abi("AggregatorV3Interface"));
  return mockAggregatorInterface;
}

async function deployBonusExecutor(deployer) {
  const mockBonusExecutor = await deployMockContract(deployer, await abi("InterestIncreaser"));
  return mockBonusExecutor;
}

async function deployBonusNft(deployer) {
  const mockBonusNft = await deployMockContract(deployer, await abi("PMXBonusNFT"));
  return mockBonusNft;
}

async function deployMockInterestRateStrategy(deployer) {
  const mockInterestRateStrategy = await deployMockContract(deployer, await abi("InterestRateStrategy"));
  await mockInterestRateStrategy.mock.supportsInterface.returns(true);
  await mockInterestRateStrategy.mock.setBarCalculationParams.returns();
  return mockInterestRateStrategy;
}

async function deployLMRewardDistributor(deployer) {
  const lmRD = await deployMockContract(deployer, await abi("LiquidityMiningRewardDistributor"));
  return lmRD;
}

async function deployMockKeeperRewardDistributor(deployer) {
  const mockKeeperRewardDistributor = await deployMockContract(deployer, await abi("KeeperRewardDistributor"));
  await mockKeeperRewardDistributor.mock.supportsInterface.returns(true);
  return mockKeeperRewardDistributor;
}

async function deployMockSpotTradingRewardDistributor(deployer) {
  const mockSpotTradingRewardDistributor = await deployMockContract(deployer, await abi("SpotTradingRewardDistributor"));
  await mockSpotTradingRewardDistributor.mock.supportsInterface.returns(true);
  return mockSpotTradingRewardDistributor;
}

async function deployMockConditionalManager(deployer) {
  const mockConditionalManager = await deployMockContract(deployer, await abi("LimitPriceCOM"));
  await mockConditionalManager.mock.supportsInterface.returns(true);
  return mockConditionalManager;
}
async function deployMockProxy(deployer) {
  const mockProxy = await deployMockContract(deployer, await abi("ITransparentUpgradeableProxy"));
  await mockProxy.mock.changeAdmin.returns();
  await mockProxy.mock.upgradeTo.returns();
  await mockProxy.mock.upgradeToAndCall.returns();

  return mockProxy;
}

async function deployUpgradeableBeacon(deployer) {
  const mockProxy = await deployMockContract(deployer, await abi("UpgradeableBeacon"));
  await mockProxy.mock.transferOwnership.returns();
  await mockProxy.mock.upgradeTo.returns();
  return mockProxy;
}

async function deployMockUniswapPriceFeed(deployer) {
  const mock = await deployMockContract(deployer, await abi("UniswapPriceFeed"));
  await mock.mock.supportsInterface.returns(true);
  return mock;
}
async function deployMockPyth(deployer) {
  const mock = await deployMockContract(deployer, await abi("IPyth"));
  await mock.mock.getUpdateFee.returns(1);
  await mock.mock.updatePriceFeeds.returns();
  await mock.mock.getPrice.returns([0, 0, 0, 0]);
  return mock;
}

module.exports = {
  deployMockReserve,
  deployMockPToken,
  deployMockPMXToken,
  deployMockPtokensFactory,
  deployMockBucketsFactory,
  deployMockDebtToken,
  deployMockDebtTokensFactory,
  deployMockUniswapPriceFeed,
  deployMockPositionManager,
  deployMockPrimexDNS,
  deployMockAccessControl,
  deployMockAccessControlUpgradeable,
  deployMockERC20,
  deployMockBucket,
  deployMockPriceOracle,
  deployMockDexAdapter,
  deployMockIQuoterV3Uniswap,
  deployMockERC165,
  deployMockTraderBalanceVault,
  deployMockLimitOrderManager,
  deployMockBestDexLens,
  deployMockPrimexLens,
  deployMockWhiteBlackList,
  deployMockPositionManagerExtension,
  deployMockWhiteBlackListReferral,
  deployMockTokenTransfersLibrary,
  deployMockPrimexPricingLibrary,
  deployMockAggregatorV3Interface,
  deployBonusExecutor,
  deployBonusNft,
  deployMockTreasury,
  deployMockInterestRateStrategy,
  deployLMRewardDistributor,
  deployMockKeeperRewardDistributor,
  deployMockSpotTradingRewardDistributor,
  deployMockConditionalManager,
  deployMockProxy,
  deployUpgradeableBeacon,
  deployMockSwapManager,
  deployMockPyth,
};
