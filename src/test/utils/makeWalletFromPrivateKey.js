// SPDX-License-Identifier: BUSL-1.1
const ethUtil = require("ethereumjs-util");
const ethWallet = require("ethereumjs-wallet");

module.exports = privateKeyString => {
  const privateKeyBuffer = ethUtil.toBuffer(privateKeyString);
  return ethWallet.fromPrivateKey(privateKeyBuffer);
};
