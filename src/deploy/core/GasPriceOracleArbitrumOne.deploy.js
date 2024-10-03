// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:GasPriceOracleArbitrumOne", {});
};

module.exports.tags = ["GasPriceOracleArbitrumOne"];
module.exports.dependencies = [];
