// SPDX-License-Identifier: BUSL-1.1
module.exports = async ({ run }) => {
  if (process.env.TEST) {
    await run("deploy:WETHMock");
  }
};
module.exports.tags = ["Test", "MockWETH"];
