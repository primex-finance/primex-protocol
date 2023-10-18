// SPDX-License-Identifier: BUSL-1.1
const { execSync } = require("node:child_process");
const path = require("path");
const fs = require("fs");

module.exports = async function ({ _ }, { run, network }) {
  await run("deployEnv:devnode1");
  const pathToNetworkDeployments = path.join(__dirname, "..", "..", "deployments", network.name);
  // check that deployment directory exists
  fs.stat(pathToNetworkDeployments, function (err) {
    if (err) throw err;
  });
  // delete the folder with the deployments to check that the script below takes the addresses only from the config file
  execSync(`rm -rf ${pathToNetworkDeployments}`);
  await run("deployCoreAndTestnetServices", { noCompile: true });
};
