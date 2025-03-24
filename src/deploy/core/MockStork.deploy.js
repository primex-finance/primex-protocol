// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:MockStork");
};
module.exports.tags = ["MockStork", "Test"];
