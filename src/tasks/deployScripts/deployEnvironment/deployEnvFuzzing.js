// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { run }) {
  const readYamlFile = require("read-yaml-file");
  const config = await readYamlFile("contracts/test/default.yaml");
  console.log(config.contractAddr);
  process.env.FUZZING_CONTRACT_ADDRESS = config.contractAddr;
  process.env.FUZZING = true;
  await run("setup:deployEnv", {
    deployUniswap: true,
    deployUniswapv3: true,
    deployQuickswapv3: true,
    deployCurve: false,
    deployBalancer: true,
    deployMeshswap: true,
    deployUniswapMulticall: true,
  });
};
