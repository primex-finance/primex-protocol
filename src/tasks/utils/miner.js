// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ _ }, { network }) {
  function sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
  while (true) {
    const pendingBlock = await network.provider.send("eth_getBlockByNumber", ["pending", false]);
    if (pendingBlock.transactions.length !== 0) {
      await network.provider.send("evm_mine");
      console.log("block mined");
    }

    await sleep(7000);
  }
};
