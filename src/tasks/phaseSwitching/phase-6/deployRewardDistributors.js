// SPDX-License-Identifier: BUSL-1.1
const { PaymentModel, KeeperActionType, DecreasingReason } = require("../../../test/utils/constants");
module.exports = async function (
  { _ },
  {
    ethers: {
      getContract,
      utils: { parseEther, parseUnits },
    },
  },
) {
  const pmx = await getContract("PMXToken");

  const pmxPartInReward = parseUnits("0.2", 18).toString();
  const nativePartInReward = parseUnits("0.8", 18).toString();
  const positionSizeCoefficientA = parseUnits("0.09", 18).toString();
  const positionSizeCoefficientB = "1";
  const additionalGas = "10000";
  const defaultMaxGasPrice = parseUnits("1000", 9).toString();
  const oracleGasPriceTolerance = parseUnits("0.1", 18).toString();
  const MaxGasPerPositionParams = [
    {
      actionType: KeeperActionType.Liquidation,
      config: {
        baseMaxGas1: "1000000",
        baseMaxGas2: "0",
        multiplier1: "1000000",
        multiplier2: "0",
        inflectionPoint: "0",
      },
    },
  ];
  const DecreasingGasByReasonParams = [
    {
      reason: DecreasingReason.NonExistentIdForLiquidation,
      amount: "18755",
    },
  ];

  await run("deploy:KeeperRewardDistributor", {
    pmx: pmx.address,
    pmxPartInReward: pmxPartInReward,
    nativePartInReward: nativePartInReward,
    positionSizeCoefficientA: positionSizeCoefficientA,
    positionSizeCoefficientB: positionSizeCoefficientB,
    additionalGas: additionalGas,
    defaultMaxGasPrice: defaultMaxGasPrice,
    oracleGasPriceTolerance: oracleGasPriceTolerance,
    paymentModel: PaymentModel.DEFAULT,
    maxGasPerPositionParams: JSON.stringify(MaxGasPerPositionParams),
    decreasingGasByReasonParams: JSON.stringify(DecreasingGasByReasonParams),
  });

  await run("deploy:ActivityRewardDistributor", {
    pmx: pmx.address,
  });

  const reinvestmentRate = parseEther("0.1").toString(); // 10%
  const reinvestmentDuration = (30 * 24 * 60 * 60).toString(); // 30 days
  await run("deploy:LiquidityMiningRewardDistributor", {
    reinvestmentRate: reinvestmentRate,
    reinvestmentDuration: reinvestmentDuration,
    pmx: pmx.address,
  });

  await run("deploy:SpotTradingRewardDistributor", {
    pmx: pmx.address,
  });

  console.log("Reward Distributors deployed");
};
