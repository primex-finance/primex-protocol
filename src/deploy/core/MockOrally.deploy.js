// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:MockOrally");
};
module.exports.tags = ["MockOrally", "Test"];
