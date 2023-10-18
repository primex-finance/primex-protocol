// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  process.env.POLYGONZKTESTNET = true;
  await run("setup:deployEnv", {
    deployUniswap: true,
  });
};
