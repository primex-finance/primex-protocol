// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName, getAddress, getDecimals } = require("../../../config/configUtils.js");

module.exports = async function (
  { treasury },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits },
      constants: { MaxUint256 },
    },
  },
) {
  if (!treasury) {
    treasury = (await getContract("Treasury")).address;
  }
  const { TreasuryConfig } = getConfigByName("generalConfig.json");
  const HOUR = 60 * 60;

  const params = await Promise.all(
    TreasuryConfig.setMaxSpendingLimit.map(async param => {
      const scaledParam = [];
      scaledParam.push(await getAddress(param.spender));
      scaledParam.push(await getAddress(param.asset));
      const decimals = await getDecimals(scaledParam[1]);

      let maxTotalAmount, maxAmountPerTransfer, maxAmountDuringTimeframe;
      if (param.spendingLimits.maxTotalAmount === "MaxUint256") {
        maxTotalAmount = MaxUint256;
      } else {
        maxTotalAmount = parseUnits(param.spendingLimits.maxTotalAmount.toString(), decimals);
      }

      if (param.spendingLimits.maxAmountPerTransfer === "MaxUint256") {
        maxAmountPerTransfer = MaxUint256;
      } else {
        maxAmountPerTransfer = parseUnits(param.spendingLimits.maxAmountPerTransfer.toString(), decimals);
      }

      if (param.spendingLimits.maxAmountDuringTimeframe === "MaxUint256") {
        maxAmountDuringTimeframe = MaxUint256;
      } else {
        maxAmountDuringTimeframe = parseUnits(param.spendingLimits.maxAmountDuringTimeframe.toString(), decimals);
      }
      param.spendingLimits.maxTotalAmount = maxTotalAmount;
      param.spendingLimits.maxAmountPerTransfer = maxAmountPerTransfer;
      param.spendingLimits.maxPercentPerTransfer = parseUnits(param.spendingLimits.maxPercentPerTransfer.toString(), 18);
      param.spendingLimits.minTimeBetweenTransfers = param.spendingLimits.minTimeBetweenTransfersSeconds;
      param.spendingLimits.timeframeDuration = param.spendingLimits.timeframeDurationHours * HOUR;
      param.spendingLimits.maxAmountDuringTimeframe = maxAmountDuringTimeframe;

      scaledParam.push(param.spendingLimits);
      return scaledParam;
    }),
  );

  treasury = await getContractAt("Treasury", treasury);
  for (const param of params) {
    const tx = await treasury.setMaxSpendingLimit(...param);
    await tx.wait();
  }
  console.log("Treasury spenders are set up by config!");
};
