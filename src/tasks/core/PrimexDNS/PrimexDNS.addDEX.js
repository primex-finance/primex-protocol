// SPDX-License-Identifier: BUSL-1.1
module.exports = async function ({ name, routerAddress, primexDNS }, { ethers: { getContractAt } }) {
  const contractPrimexDNS = await getContractAt("PrimexDNS", primexDNS);

  const txAddDex = await contractPrimexDNS.addDEX(name, routerAddress);
  await txAddDex.wait();
  if (!process.env.TEST) {
    console.log(`\nPrimexDNS(${primexDNS}) call function \naddDEX(${name},${routerAddress})\ntx - ${txAddDex.hash}\n`);
  }
};
