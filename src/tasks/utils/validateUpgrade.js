// SPDX-License-Identifier: BUSL-1.1
const { validateUpgradeSafety } = require("../../node_modules/@openzeppelin/upgrades-core");
const fs = require("fs");
module.exports = async function ({ _ }, { artifacts }) {
  // 1) Configure hardhat.config.js to include storage layout in the output selection
  // 2) Сompile artifacts for new and old version
  // 3) Specify two paths for old and new version artifacts below

  // The build-info folders must also have different names.
  const newBuildInfoDir = "artifacts_new/build-info_new";
  const referenceBuildInfoDir = "artifacts/build-info";

  const validateOptions = {
    unsafeAllowLinkedLibraries: true,
  };

  let allNames = await artifacts.getAllFullyQualifiedNames();
  allNames = allNames.filter(name => name.startsWith("contracts"));
  const reports = {};
  const errors = {};

  for (const i in allNames) {
    const abi = await artifacts.readArtifactSync(allNames[i]);
    if (abi.abi.some(el => el.name === "initialize") && abi.bytecode !== "0x") {
      try {
        const report = await validateUpgradeSafety(
          newBuildInfoDir,
          abi.contractName,
          `${referenceBuildInfoDir.split("/")[1]}:${abi.contractName}`,
          validateOptions,
          [referenceBuildInfoDir],
        );
        reports[abi.contractName] = report.explain(false);
        // console.log(report.explain(true))
      } catch (e) {
        errors[abi.contractName] = e;
      }
    }
  }
  if (Object.keys(reports).length !== 0) {
    fs.writeFileSync("./validate-reports.json", JSON.stringify(reports, null, 2));
  }
  if (Object.keys(errors).length !== 0) {
    fs.writeFileSync("./validate-errors.json", JSON.stringify(errors, null, 2));
  }
};
