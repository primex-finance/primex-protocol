// SPDX-License-Identifier: BUSL-1.1

module.exports = async ({ run }) => {
  await run("deploy:MockPyth", {
    validTimePeriod: "60",
    singleUpdateFeeInWei: "1",
  });
};
module.exports.tags = ["MockPyth", "Test"];
