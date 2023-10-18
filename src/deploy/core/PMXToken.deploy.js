// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    constants: { AddressZero },
  },
} = require("hardhat");

module.exports = async ({ run }) => {
  await run("deploy:PMXToken", {
    recipient: AddressZero,
  });
};

module.exports.tags = ["PMXToken", "Test"];
