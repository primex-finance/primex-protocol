// SPDX-License-Identifier: BUSL-1.1
const { getConfigByName, getAddress, getDecimals } = require("../../../config/configUtils.js");

module.exports = async function (
  { reserve },
  {
    run,
    ethers: {
      getContract,
      getContractAt,
      utils: { parseUnits },
    },
  },
) {
  if (!reserve) {
    reserve = (await getContract("Reserve")).address;
  }
  const { ReserveConfig } = getConfigByName("generalConfig.json");

  const params = await Promise.all(
    ReserveConfig.setTransferRestrictions.map(async param => {
      const scaledParam = [];
      scaledParam.push(await getAddress(param.PToken));
      const decimals = await getDecimals(scaledParam[0]);
      param.transferRestrictions.minAmountToBeLeft = parseUnits(param.transferRestrictions.minAmountToBeLeft.toString(), decimals);
      param.transferRestrictions.minPercentOfTotalSupplyToBeLeft = parseUnits(
        param.transferRestrictions.minPercentOfTotalSupplyToBeLeft.toString(),
        18,
      );
      scaledParam.push(param.transferRestrictions);
      return scaledParam;
    }),
  );

  reserve = await getContractAt("Reserve", reserve);

  for (const param of params) {
    const tx = await reserve.setTransferRestrictions(...param);
    await tx.wait();
  }
  console.log("Reserve transferRestrictions are set up by config!");
};
