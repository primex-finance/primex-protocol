// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:GasPriceOracleOptimism", {});
};

module.exports.tags = ["GasPriceOracleOptimism"];
module.exports.dependencies = [];
