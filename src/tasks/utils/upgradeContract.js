// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { address, oldImplName, primexProxyAdmin, newImplName, isBeacon, oldFactoryLibraries, newFactoryLibraries },
  { ethers: { getContractFactory, getContract, getContractAt }, upgrades },
) {
  if (oldFactoryLibraries) {
    oldFactoryLibraries = JSON.parse(oldFactoryLibraries);
  }
  if (newFactoryLibraries) {
    newFactoryLibraries = JSON.parse(newFactoryLibraries);
  }
  if (!primexProxyAdmin) {
    primexProxyAdmin = (await getContract("PrimexProxyAdmin")).address;
  }

  // In case information is missing (on first upgrade)
  let oldImplFactory;
  if (oldImplName) {
    oldImplFactory = await getContractFactory(
      oldImplName,
      oldFactoryLibraries
        ? {
          libraries: oldFactoryLibraries,
        }
        : {},
    );
  }

  const newImplFactory = await getContractFactory(
    newImplName,
    newFactoryLibraries
      ? {
        libraries: newFactoryLibraries,
      }
      : {},
  );

  if (isBeacon) {
    const PrimexProxyAdmin = await getContractAt("PrimexProxyAdmin", primexProxyAdmin);
    await upgrades.forceImport(address, oldImplFactory, { kind: "beacon" });
    await upgrades.validateUpgrade(address, newImplFactory, { unsafeAllow: ["delegatecall", "constructor", "external-library-linking"] });
    const impl = await upgrades.deployImplementation(newImplFactory, {
      unsafeAllow: ["delegatecall", "constructor", "external-library-linking"],
    });
    await PrimexProxyAdmin.upgradeBeacon(address, impl);
  } else {
    await upgrades.forceImport(address, oldImplFactory);
    await upgrades.upgradeProxy(address, newImplFactory, { unsafeAllow: ["constructor", "external-library-linking", "delegatecall"] });
  }
};
