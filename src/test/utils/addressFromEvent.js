// SPDX-License-Identifier: BUSL-1.1
const {
  ethers: {
    utils: { getAddress },
  },
} = require("hardhat");

function addressFromEvent(eventName, txReceipt) {
  for (let i = 0; i < txReceipt.events.length; i++) {
    if (txReceipt.events[i].event === eventName) {
      const newBucketAddress = getAddress("0x" + txReceipt.events[i].data.slice(26));
      return newBucketAddress;
    }
  }
}

module.exports = { addressFromEvent };
