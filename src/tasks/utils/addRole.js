// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { role, registryAddress, account },
  {
    ethers: {
      getContract,
      getContractAt,
      utils: { toUtf8Bytes, keccak256 },
      constants: { HashZero },
    },
  },
) {
  let roleHash;
  if (role === "DEFAULT_ADMIN_ROLE") {
    roleHash = HashZero;
  } else {
    roleHash = keccak256(toUtf8Bytes(role));
  }

  if (!registryAddress) {
    registryAddress = (await getContract("PrimexRegistry")).address;
  }

  const Registry = await getContractAt("PrimexRegistry", registryAddress);

  const tx = await Registry.grantRole(roleHash, account);
  if (process.env.TEST === undefined) {
    console.log("tx hash", tx.hash);
  }
  await tx.wait();
  if (process.env.TEST === undefined) {
    console.log(`${account} hasRole ${role} - ${await Registry.hasRole(roleHash, account)}`);
  }
};
