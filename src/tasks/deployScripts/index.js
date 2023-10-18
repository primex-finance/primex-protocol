// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

require("./deployEnvironment");
require("./phaseSwitching");

task("deployCore", "Deploy core of Primex protocol", require("./deployCore.js")).addFlag("noCompile", "disable pre compilation");

task(
  "deployCoreAndTestnetServices",
  "Deploy core of Primex protocol and testnet services. Setup services",
  require("./deployCoreAndTestnetServices.js"),
).addFlag("noCompile", "disable pre compilation");

task("deployCore:obscuro", "Deploy core of Primex protocol on Obscuro testnet", require("./deployObscuro.js"));

task(
  "deployFull:devnode1",
  "Deploy full Primex protocol on dev node1 (only in order to raise the test environment locally or to test scripts via ci)",
  require("./deployFullDevnode1.js"),
);
task("deployFull:fuzzing", "Deploy full Primex protocol on localhost for fuzzing testing purposes", require("./deployFullFuzzing.js"));
