// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:MockFlashLoanReceiver", {});
};
module.exports.tags = ["MockFlashLoanReceiver", "Test"];
