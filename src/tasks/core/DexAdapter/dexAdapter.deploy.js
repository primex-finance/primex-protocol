// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { registry, routers, contractName, name, dexTypes, primexDNS, quoters, errorsLibrary, addDexesToDns },
  { run, getNamedAccounts, ethers: { getContract, getContractAt }, deployments: { deploy } },
) {
  const { deployer } = await getNamedAccounts();

  if (!primexDNS) {
    primexDNS = (await getContract("PrimexDNS")).address;
  }

  if (!errorsLibrary) {
    errorsLibrary = (await getContract("Errors")).address;
  }

  const dexAdapter = await deploy(contractName ?? "DexAdapter", {
    from: deployer,
    args: [registry],
    log: true,
    libraries: {
      Errors: errorsLibrary,
    },
  });

  if (dexAdapter.newlyDeployed) {
    const primexDNScontract = await getContractAt("PrimexDNS", primexDNS);
    const whiteBlackList = await getContract("WhiteBlackList");
    let tx = await whiteBlackList.addAddressToWhitelist(dexAdapter.address);
    await tx.wait();

    tx = await primexDNScontract.setDexAdapter(dexAdapter.address);
    await tx.wait();
    name = JSON.parse(name);
    routers = JSON.parse(routers);
    dexTypes = JSON.parse(dexTypes);
    quoters = JSON.parse(quoters);
    if (name.length !== routers.length) throw new Error("length of router addresses and the length of the names do not match");
    if (dexTypes.length !== routers.length) throw new Error("length of router addresses and the length of the dex types do not match");
    for (let i = 0; i < name.length; i++) {
      if (addDexesToDns) {
        await run("PrimexDNS:addDEX", { name: name[i], routerAddress: routers[i], primexDNS: primexDNS });
      }
      await run("DexAdapter:setDexType", { dexType: dexTypes[i], router: routers[i], dexAdapter: dexAdapter.address });
    }
    if (quoters) {
      for (const key in quoters) {
        const dexAdapterContract = await getContract(contractName ?? "DexAdapter");
        const txAddQoter = await dexAdapterContract.setQuoter(routers[key], quoters[key]);
        await txAddQoter.wait();
      }
    }
  }
  return dexAdapter;
};
