// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("deploy:CurveStableOracle", "Deploy PriceOracle contract", require("./curveStableOracle.deploy"))
  .addParam("registry", "The address of the PrimexRegistry")
  .addParam("priceOracle", "The address of the PrimexOracle")
  .addParam("curveAddressProvider", "The address of the Curve address provider");
