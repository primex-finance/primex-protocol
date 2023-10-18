// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ router, dexAdapter, dexType }, { ethers: { getContractAt } }) {
  const dexAdapterContract = await getContractAt("DexAdapter", dexAdapter);
  const txSetDexType = await dexAdapterContract.setDexType(router, dexType);
  await txSetDexType.wait();
  if (!process.env.TEST) {
    console.log(`\nDexAdapter(${dexAdapter}) call function \nsetDexType(${router},${dexType})\ntx - ${txSetDexType.hash}\n`);
  }
};
