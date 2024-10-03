// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");

module.exports = async ({
  run,
  ethers: {
    getContract,
    getContractAt,
    utils: { parseUnits },
  },
}) => {
  const registry = await getContract("Registry");
  const primexDNS = await getContract("PrimexDNS");
  const traderBalanceVault = await getContract("TraderBalanceVault");
  const priceOracle = await getContract("PriceOracle");
  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const positionLibrary = await getContract("PositionLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const keeperRewardDistributor = await getContract("KeeperRewardDistributor");
  const whiteBlackList = await getContract("WhiteBlackList");
  const errorsLibrary = await getContract("Errors");
  const positionManagerExtension = await getContract("PositionManagerExtension");

  const { PositionManagerConfig } = getConfigByName("generalConfig.json");

  const defaultOracleTolerableLimit = parseUnits(PositionManagerConfig.defaultOracleTolerableLimit, 18);
  const oracleTolerableLimitMultiplier = parseUnits(PositionManagerConfig.oracleTolerableLimitMultiplier, 18);
  const maintenanceBuffer = parseUnits(PositionManagerConfig.maintenanceBuffer, 18);
  const securityBuffer = parseUnits(PositionManagerConfig.securityBuffer, 18);

  await run("deploy:PositionManager", {
    registry: registry.address,
    primexDNS: primexDNS.address,
    traderBalanceVault: traderBalanceVault.address,
    priceOracle: priceOracle.address,
    primexPricingLibrary: primexPricingLibrary.address,
    whiteBlackList: whiteBlackList.address,
    positionLibrary: positionLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    positionManagerExtension: positionManagerExtension.address,
    keeperRewardDistributor: keeperRewardDistributor.address,
    errorsLibrary: errorsLibrary.address,
    defaultOracleTolerableLimit: defaultOracleTolerableLimit.toString(),
    oracleTolerableLimitMultiplier: oracleTolerableLimitMultiplier.toString(),
    maintenanceBuffer: maintenanceBuffer.toString(),
    securityBuffer: securityBuffer.toString(),
  });
};
module.exports.tags = ["PositionManager", "Test", "PrimexCore"];
module.exports.dependencies = [
  "PrimexDNS",
  "Registry",
  "WhiteBlackList",
  "TraderBalanceVault",
  "PriceOracle",
  "PrimexPricingLibrary",
  "PositionLibrary",
  "TokenTransfersLibrary",
  "KeeperRewardDistributor",
  "Errors",
  "PrimexProxyAdmin",
  "PositionManagerExtension",
];
