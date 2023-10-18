// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run }) => {
  await run("deploy:Errors");
};
module.exports.tags = ["Errors", "Test","PrimexCore"];
