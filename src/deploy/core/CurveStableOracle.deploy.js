// SPDX-License-Identifier: BUSL-1.1
const { getConfig } = require("../../config/configUtils");
const { CurveOracleKind } = require("../../test/utils/constants");

module.exports = async ({ run, ethers: { getContract, getContractAt } }) => {
  const registry = await getContract("Registry");
  const priceOracle = await getContract("PriceOracle");
  const { curveAddressProvider, curveLP } = getConfig();

  const CurveStableOracle = await run("deploy:CurveStableOracle", {
    registry: registry.address,
    priceOracle: priceOracle.address,
    curveAddressProvider: curveAddressProvider,
  });

  if (CurveStableOracle.newlyDeployed) {
    const CurveStableOracleContract = await getContractAt("CurveStableOracle", CurveStableOracle.address);
    let tx;
    tx = await priceOracle.updateCurveTypeOracle([CurveOracleKind.STABLE], [CurveStableOracle.address]);
    await tx.wait();

    if (curveLP) {
      for (const lp in curveLP) {
        const token = curveLP[lp];
        if (token.oracleType === CurveOracleKind.STABLE) {
          tx = await CurveStableOracleContract.registerCurveLp(token.lpTokenAddress, token.registry, token.registryIndex);
          await tx.wait();
        }
      }
    }
  }
};
module.exports.tags = ["CurveStableOracle", "PrimexCore"];
module.exports.dependencies = ["Registry", "PriceOracle"];
