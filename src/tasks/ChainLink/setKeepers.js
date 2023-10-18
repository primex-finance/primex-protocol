// SPDX-License-Identifier: BUSL-1.1
module.exports = async function (
  { payees, keepers, keeperRegistryAddress },
  {
    ethers: {
      getNamedSigners,
      utils: { parseEther },
      provider: { getBalance },
      getContractAt,
    },
  },
) {
  const { deployer } = await getNamedSigners();

  const KeeperRegistryContract = await getContractAt("KeeperRegistry", keeperRegistryAddress);
  payees = JSON.parse(payees);
  keepers = JSON.parse(keepers);
  if (payees.length !== keepers.length) throw new Error("length of payees addresses and the length of the keepers addresses do not match");
  if (payees.length < 2) throw new Error("length of payees and keepers addresses can't be less than two");
  if ((await KeeperRegistryContract.owner()) !== deployer.address) throw new Error("only KeeperRegistry owner can execute setKeepers");

  const tx = await KeeperRegistryContract.setKeepers(keepers, payees);
  await tx.wait();

  const accounts = new Set(payees.concat(keepers));
  for (const acc of accounts) {
    // getBalance does not work in Obscuro
    if (process.env.OBSCURO || (await getBalance(acc)).lte(parseEther("10.0"))) {
      const tx = await deployer.sendTransaction({
        to: acc,
        value: parseEther("80.0"),
      });
      await tx.wait();
    }
  }
};
