// SPDX-License-Identifier: BUSL-1.1
const { task } = require("hardhat/config");

task("setup:phase-1", "Deploy full Primex protocol", require("./phase-1-initial-deploy.js"));

task("setup:phase-2-proposal", "Proposal to turn on rewards for spot trading", require("./phase-2-proposal-spot-trading-rewards.js"));

task(
  "setup:phase-2-execution",
  "Execution of proposal to turn on rewards for spot trading",
  require("./phase-2-execution-spot-trading-rewards.js"),
);

task("setup:phase-3-proposal", "Proposal to turn on rewards for early lenders", require("./phase-3-proposal-early-lenders-rewards.js"));

task(
  "setup:phase-3-execution",
  "Execution of proposal to turn on rewards for early lenders",
  require("./phase-3-execution-early-lenders-rewards.js"),
);

task("setup:phase-4-proposal", "Proposal to turn on rewards for  early traders", require("./phase-4-proposal-early-traders-rewards.js"));

task(
  "setup:phase-4-execution",
  "Execution of proposal to turn on rewards for  early traders",
  require("./phase-4-execution-early-traders-rewards.js"),
);

task("setup:phase-5-proposal", "Proposal to turn on bonuses for NFTs", require("./phase-5-proposal-enable-nft.js"));

task("setup:phase-5-execution", "Execution of proposal to turn on bonuses for NFTs", require("./phase-5-execution-enable-nft.js"));

task("setup:phase-6-proposal", "Proposal to migrate from ePMX to PMX", require("./phase-6-proposal-migrate-epmx-to-pmx.js"));

task("setup:phase-6-execution", "Execution of proposal to migrate from ePMX to PMX", require("./phase-6-execution-migrate-epmx-to-pmx.js"));
