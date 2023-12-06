// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName } = require("../../config/configUtils");
const { PaymentModel, KeeperActionType, DecreasingReason, KeeperCallingMethod } = require("../../test/utils/constants");

module.exports = async function ({
  run,
  ethers: {
    getContract,
    utils: { parseUnits, parseEther },
  },
}) {
  const registry = await getContract("Registry");
  const oracle = await getContract("PriceOracle");
  const treasury = await getContract("Treasury");
  const pmx = await getContract("EPMXToken");
  const whiteBlackList = await getContract("WhiteBlackList");

  const keeperRewardConfig = getConfigByName("generalConfig.json").KeeperRewardConfig;

  const pmxPartInReward = parseUnits(keeperRewardConfig.pmxPartInReward, 18).toString();
  const nativePartInReward = parseUnits(keeperRewardConfig.nativePartInReward, 18).toString();
  const positionSizeCoefficientA = parseUnits(keeperRewardConfig.positionSizeCoefficientA, 18).toString();
  const positionSizeCoefficientB = parseUnits(keeperRewardConfig.positionSizeCoefficientB, 18).toString();
  const defaultMaxGasPrice = parseUnits(keeperRewardConfig.defaultMaxGasPriceGwei, 9).toString();
  const oracleGasPriceTolerance = parseUnits(keeperRewardConfig.oracleGasPriceTolerance, 18).toString();
  const paymentModel = PaymentModel[keeperRewardConfig.paymentModel];

  const maxGasPerPositionParams = [];
  const decreasingGasByReasonParams = [];

  for (const actionType in KeeperActionType) {
    maxGasPerPositionParams.push({
      actionType: KeeperActionType[actionType],
      config: keeperRewardConfig.maxGasPerPositionParams[actionType],
    });
  }

  for (const reason in DecreasingReason) {
    decreasingGasByReasonParams.push({
      reason: DecreasingReason[reason],
      amount: keeperRewardConfig.decreasingGasByReasonParams[reason],
    });
  }

  const primexPricingLibrary = await getContract("PrimexPricingLibrary");
  const tokenTransfersLibrary = await getContract("TokenTransfersLibrary");
  const errorsLibrary = await getContract("Errors");

  await run("deploy:KeeperRewardDistributor", {
    pmxPartInReward: pmxPartInReward,
    nativePartInReward: nativePartInReward,
    positionSizeCoefficientA: positionSizeCoefficientA,
    positionSizeCoefficientB: positionSizeCoefficientB,
    additionalGas: keeperRewardConfig.additionalGas,
    maxGasPerPositionParams: JSON.stringify(maxGasPerPositionParams),
    decreasingGasByReasonParams: JSON.stringify(decreasingGasByReasonParams),
    defaultMaxGasPrice: defaultMaxGasPrice,
    oracleGasPriceTolerance: oracleGasPriceTolerance,
    minPositionSizeMultiplier: parseEther(keeperRewardConfig.minPositionSizeMultiplier).toString(),
    paymentModel: paymentModel,
    pmx: pmx.address,
    registry: registry.address,
    priceOracle: oracle.address,
    treasury: treasury.address,
    whiteBlackList: whiteBlackList.address,
    primexPricingLibrary: primexPricingLibrary.address,
    tokenTransfersLibrary: tokenTransfersLibrary.address,
    errorsLibrary: errorsLibrary.address,
  });

  if (paymentModel === PaymentModel.ARBITRUM) {
    const keeperRDcontract = await getContract("KeeperRewardDistributor");
    for (const callingMethod in KeeperCallingMethod) {
      const method = KeeperCallingMethod[callingMethod];
      const { maxRoutesLength, baseLength } = keeperRewardConfig.dataLengthRestrictions[callingMethod];
      const tx = await keeperRDcontract.setDataLengthRestrictions(method, maxRoutesLength, baseLength);
      await tx.wait();
    }
  }
};

module.exports.tags = ["KeeperRewardDistributor", "PrimexCore"];
module.exports.dependencies = [
  "Registry",
  "WhiteBlackList",
  "PrimexPricingLibrary",
  "PriceOracle",
  "EPMXToken",
  "TokenTransfersLibrary",
  "Errors",
  "Treasury",
  "PrimexProxyAdmin",
];
